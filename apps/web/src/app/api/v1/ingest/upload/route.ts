/**
 * POST /api/v1/ingest/upload — Sessions 5b / 8d
 *
 * Document and image upload ingest pipeline with Managed Agents memory write.
 *
 * Pipeline steps (Session 8d additions marked ★):
 *   1. Normalize file bytes → text + extraction_metadata.
 *   2. Store canonical asset record in Supabase assets table.
 *   3. ★ Get or create project memory store (Anthropic or stub).
 *   4. ★ Write canonical asset memory at /assets/{asset_id}.md with
 *        required provenance fields. Retry up to MAX_MEMORY_RETRIES times
 *        with exponential back-off. On exhaustion set ingest_status to
 *        "blocked_on_memory_write" (asset record preserved, no data loss).
 *   5. ★ Emit structured run_events for every memory operation attempt.
 *   6. ★ Update wiki pages: create asset summary page, update root/index
 *        and root/log.
 *
 * Request body (multipart/form-data):
 *   file        File    — the asset to ingest (required)
 *   project_id  string  — must already exist in `projects` table (required)
 *   org_id      string  — UUID (required)
 *   acl_scope   string  — e.g. "org:acme" (required)
 *
 * Response 200:
 * {
 *   ingest_run_id:        string
 *   asset_id:             string
 *   source_type:          "document" | "image"
 *   filename:             string
 *   content_sha256:       string
 *   ingest_status:        "indexed" | "blocked_on_memory_write"
 *   normalized_text:      string
 *   extraction_metadata:  object
 *   binary_ref:           string | null
 *   memory_store_id:      string | null   ★
 *   memory_version_id:    string | null   ★
 *   schema_version:       string          ★
 * }
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import * as crypto from "node:crypto";
import {
  getOrCreateProjectStore,
  writeAssetMemory,
  emitMemoryEvent,
} from "../../../../../lib/managed-memory";
import { getSchemaVersion } from "../../../../../lib/schema-injection";
import {
  buildTrustGovernanceMetadata,
  evaluateSourceTrust,
} from "../../../../../lib/source-trust";

// ---------------------------------------------------------------------------
// Memory write constants
// ---------------------------------------------------------------------------

/** Maximum number of memory write attempts before giving up */
const MAX_MEMORY_RETRIES = 3;
/** Base delay in ms for exponential back-off between memory write retries */
const MEMORY_RETRY_BASE_MS = 300;

// ---------------------------------------------------------------------------
// Auth helper (same pattern as other ingest routes)
// ---------------------------------------------------------------------------

async function verifyAuth(
  request: NextRequest,
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Unauthorized", code: "missing_bearer_token" },
        { status: 401 },
      ),
    };
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (supabaseUrl && supabaseAnonKey) {
    try {
      const { createClient } = await import("@supabase/supabase-js");
      const client = createClient(supabaseUrl, supabaseAnonKey);
      const token = authHeader.slice("Bearer ".length);
      const { error } = await client.auth.getUser(token);
      if (error) {
        return {
          ok: false,
          response: NextResponse.json(
            { error: "Unauthorized", code: "invalid_token" },
            { status: 401 },
          ),
        };
      }
    } catch {
      // Supabase unreachable — allow through in development.
    }
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// MIME type helpers
// ---------------------------------------------------------------------------

/** Supported document MIME types mapped to a short format label. */
const DOCUMENT_MIME_MAP: Record<string, string> = {
  "text/plain": "txt",
  "text/markdown": "md",
  "text/csv": "csv",
  "text/x-csv": "csv",
  "application/csv": "csv",
  "text/yaml": "yaml",
  "application/x-yaml": "yaml",
  "application/json": "json",
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "pptx",
  "application/msword": "doc",
  "application/vnd.ms-excel": "xls",
  "application/vnd.ms-powerpoint": "ppt",
};

/** Supported image MIME types. */
const IMAGE_MIME_SET = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/tiff",
  "image/webp",
  "image/gif",
]);

/** Text-native MIME types whose bytes can be decoded directly as UTF-8. */
const TEXT_NATIVE_MIME_SET = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/x-csv",
  "application/csv",
  "text/yaml",
  "application/x-yaml",
  "application/json",
]);

function guessSourceType(
  mime: string,
  filename: string,
): "document" | "image" | null {
  if (IMAGE_MIME_SET.has(mime)) return "image";
  if (mime in DOCUMENT_MIME_MAP) return "document";
  // Fallback: infer from extension when MIME is generic.
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "tiff", "webp", "gif"].includes(ext))
    return "image";
  if (
    [
      "pdf",
      "docx",
      "xlsx",
      "pptx",
      "doc",
      "xls",
      "ppt",
      "txt",
      "md",
      "csv",
      "yml",
      "yaml",
      "json",
    ].includes(ext)
  )
    return "document";
  return null;
}

// ---------------------------------------------------------------------------
// Text extraction helpers  (prototype-grade)
// ---------------------------------------------------------------------------

/**
 * Attempt to decode file bytes as UTF-8 text.
 * Returns the decoded string for text-native formats; returns a prototype stub
 * for binary formats that require parser libraries (PDF, DOCX, XLSX, PPTX).
 */
function extractDocumentText(
  bytes: Uint8Array,
  mime: string,
  filename: string,
): { normalized_text: string; extraction_metadata: Record<string, unknown> } {
  const format = DOCUMENT_MIME_MAP[mime] ?? filename.split(".").pop() ?? "unknown";

  if (TEXT_NATIVE_MIME_SET.has(mime)) {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    return {
      normalized_text: text,
      extraction_metadata: {
        source_format: format,
        mime_type: mime,
        character_count: text.length,
      },
    };
  }

  // Binary document: prototype stub.
  // v2: replace with pdf-parse / mammoth / SheetJS / pptx-parser call.
  const stub = `[prototype-stub: ${mime} (${format}) — full text extraction deferred to v2. Filename: ${filename}]`;
  return {
    normalized_text: stub,
    extraction_metadata: {
      source_format: format,
      mime_type: mime,
      character_count: stub.length,
      extraction_note: "prototype_stub",
    },
  };
}

/**
 * Produce minimal OCR + caption for an image.
 * Prototype: returns a deterministic stub (confidence=0 signals stub to callers).
 * v2: replace with a vision API call (e.g. Claude or GPT-4o).
 */
function stubImageExtraction(
  filename: string,
  mime: string,
): { normalized_text: string; extraction_metadata: Record<string, unknown> } {
  const stem = filename.replace(/\.[^.]+$/, "");
  // Deterministic OCR stub derived from filename stem.
  const ocrText = `[prototype-ocr: image content from ${stem}]`;
  const caption = `Image asset: ${stem} (${mime}) — caption extraction deferred to v2.`;
  return {
    normalized_text: ocrText,
    extraction_metadata: {
      ocr_text: ocrText,
      caption,
      ocr_confidence: 0,
      mime_type: mime,
      extraction_note: "prototype_stub",
    },
  };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  // Auth check
  const auth = await verifyAuth(request);
  if (!auth.ok) return auth.response;

  // Parse multipart form
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected multipart/form-data body", code: "invalid_body" },
      { status: 400 },
    );
  }

  const file = formData.get("file");
  const project_id = formData.get("project_id");
  const org_id = formData.get("org_id");
  const acl_scope = formData.get("acl_scope");

  if (!file || !(file instanceof File)) {
    return NextResponse.json(
      { error: "Missing required form field: file", code: "missing_field" },
      { status: 400 },
    );
  }
  if (!project_id || typeof project_id !== "string") {
    return NextResponse.json(
      {
        error: "Missing required form field: project_id",
        code: "missing_field",
      },
      { status: 400 },
    );
  }
  if (!org_id || typeof org_id !== "string") {
    return NextResponse.json(
      { error: "Missing required form field: org_id", code: "missing_field" },
      { status: 400 },
    );
  }
  if (!acl_scope || typeof acl_scope !== "string") {
    return NextResponse.json(
      {
        error: "Missing required form field: acl_scope",
        code: "missing_field",
      },
      { status: 400 },
    );
  }

  const filename = file.name;
  const mime = file.type || "application/octet-stream";
  const source_type = guessSourceType(mime, filename);

  if (!source_type) {
    return NextResponse.json(
      {
        error: `Unsupported file type: ${mime} (${filename})`,
        code: "unsupported_file_type",
      },
      { status: 422 },
    );
  }

  // Read file bytes and compute SHA-256 hash.
  const bytes = new Uint8Array(await file.arrayBuffer());
  const content_sha256 = crypto
    .createHash("sha256")
    .update(bytes)
    .digest("hex");

  // Normalize text and produce extraction metadata.
  const { normalized_text, extraction_metadata } =
    source_type === "image"
      ? stubImageExtraction(filename, mime)
      : extractDocumentText(bytes, mime, filename);

  const trustPolicy = evaluateSourceTrust({
    sourceType: source_type,
    fileNameOrUrl: filename,
    normalizedText: normalized_text,
  });

  const ingest_run_id = crypto.randomUUID();
  const asset_id = crypto.randomUUID();
  const now = new Date().toISOString();
  const storage_path = `${project_id}/${asset_id}/${filename}`;

  // ---------------------------------------------------------------------------
  // Supabase path (when configured)
  // ---------------------------------------------------------------------------

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  let binary_ref: string | null = null;
  let memory_store_id: string | null = null;
  let memory_version_id: string | null = null;
  const schema_version = getSchemaVersion();
  let final_ingest_status = trustPolicy.quarantined ? "failed" : "indexed";

  if (supabaseUrl && supabaseServiceKey) {
    try {
      const { createClient } = await import("@supabase/supabase-js");
      const db = createClient(supabaseUrl, supabaseServiceKey, {
        auth: { persistSession: false },
      });

      // Verify project exists.
      const { data: proj, error: projErr } = await db
        .from("projects")
        .select("project_id")
        .eq("project_id", project_id)
        .maybeSingle();

      if (projErr) throw projErr;
      if (!proj) {
        return NextResponse.json(
          {
            error: `Project not found: ${project_id}`,
            code: "project_not_found",
          },
          { status: 404 },
        );
      }

      // Upload binary original to Supabase Storage.
      const { error: storageErr } = await db.storage
        .from("assets")
        .upload(storage_path, bytes, {
          contentType: mime,
          upsert: true,
        });

      if (storageErr) {
        // Storage may not be configured in local dev — note but continue.
        console.warn(
          "Storage upload failed (continuing without binary_ref):",
          storageErr.message,
        );
      } else {
        binary_ref = storage_path;
      }

      // Insert asset record.
      const record = {
        asset_id,
        org_id,
        project_id,
        source_type,
        file_path_or_url: filename,
        normalized_text,
        optional_binary_ref: binary_ref,
        acl_scope,
        ingest_status: final_ingest_status,
        content_hash: content_sha256,
        parent_asset_id: null,
        lineage_metadata: {
          ingest_run_id,
          source_format: source_type,
          trust_governance: buildTrustGovernanceMetadata(trustPolicy, now),
        },
        extraction_metadata,
        ingest_run_id,
        ingested_at: now,
        last_modified_at: now,
      };

      const { error: insertErr } = await db
        .from("assets")
        .upsert(record, { onConflict: "asset_id" });
      if (insertErr) throw insertErr;

      // Session 17b quarantine gate: do not allow suspicious assets to
      // influence memory or wiki shaping until operator override.
      if (trustPolicy.quarantined) {
        return NextResponse.json({
          ingest_run_id,
          asset_id,
          source_type,
          filename,
          content_sha256,
          ingest_status: final_ingest_status,
          normalized_text,
          extraction_metadata,
          binary_ref,
          memory_store_id,
          memory_version_id,
          schema_version,
          trust_governance: buildTrustGovernanceMetadata(trustPolicy, now),
          quarantine_reason_codes: trustPolicy.reasonCodes,
        });
      }

      // -----------------------------------------------------------------------
      // Session 8d: Managed Agents memory write
      // -----------------------------------------------------------------------

      // Step 1: Get or create the project memory store.
      let storeResult: { local_store_id: string; anthropic_store_id: string } | null = null;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        storeResult = await getOrCreateProjectStore({
          project_id,
          org_id,
          name: `Project memory — ${project_id}`,
          description: `Canonical asset memories for project ${project_id}`,
          acl_scope,
          db: db as never,
        });
        memory_store_id = storeResult.local_store_id;
      } catch (storeErr) {
        // If we can't create/find a store, we still return the asset record
        // but note the memory write did not happen.
        console.warn("Memory store create/retrieve failed:", storeErr);
      }

      // Step 2: Write canonical asset memory with retry/back-off.
      if (storeResult) {
        const memoryPath = `/assets/${asset_id}.md`;

        // Emit started event
        await emitMemoryEvent({
          event_type: "memory_write_started",
          run_id: ingest_run_id,
          asset_id,
          local_store_id: storeResult.local_store_id,
          anthropic_store_id: storeResult.anthropic_store_id,
          path: memoryPath,
          attempt: 1,
          db: db as never,
        });

        let writeSucceeded = false;
        for (let attempt = 1; attempt <= MAX_MEMORY_RETRIES; attempt++) {
          try {
            const writeResult = await writeAssetMemory({
              local_store_id: storeResult.local_store_id,
              anthropic_store_id: storeResult.anthropic_store_id,
              asset_id,
              project_id,
              source_uri: filename,
              acl_scope,
              ingest_run_id,
              normalized_text,
              schema_version,
              db: db as never,
            });

            memory_version_id = writeResult.memory_version_id;

            // Update asset row with memory_version_id
            await db
              .from("assets")
              .update({ memory_version_id: writeResult.memory_version_id })
              .eq("asset_id", asset_id);

            writeSucceeded = true;
            break;
          } catch (writeErr) {
            const errMsg = writeErr instanceof Error ? writeErr.message : String(writeErr);
            console.warn(`Memory write attempt ${attempt}/${MAX_MEMORY_RETRIES} failed:`, errMsg);

            if (attempt < MAX_MEMORY_RETRIES) {
              await emitMemoryEvent({
                event_type: "memory_write_retry",
                run_id: ingest_run_id,
                asset_id,
                local_store_id: storeResult.local_store_id,
                anthropic_store_id: storeResult.anthropic_store_id,
                path: memoryPath,
                attempt: attempt + 1,
                error: errMsg,
                db: db as never,
              });
              // Exponential back-off: 300ms, 600ms, 1200ms
              await new Promise((r) => setTimeout(r, MEMORY_RETRY_BASE_MS * Math.pow(2, attempt - 1)));
            } else {
              // Retry exhaustion — preserve asset record, mark as blocked
              await emitMemoryEvent({
                event_type: "memory_write_exhausted",
                run_id: ingest_run_id,
                asset_id,
                local_store_id: storeResult.local_store_id,
                anthropic_store_id: storeResult.anthropic_store_id,
                path: memoryPath,
                attempt,
                error: errMsg,
                db: db as never,
              });
              await db
                .from("assets")
                .update({ ingest_status: "blocked_on_memory_write" })
                .eq("asset_id", asset_id);
              final_ingest_status = "blocked_on_memory_write";
            }
          }
        }

        // Step 3: Update wiki pages if memory write succeeded.
        if (writeSucceeded) {
          await updateWikiPagesAfterIngest({
            db: db as never,
            asset_id,
            filename,
            project_id,
            acl_scope,
            ingest_run_id,
            memory_version_id: memory_version_id!,
          });
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        {
          error: "Database error during ingest",
          code: "db_error",
          details: msg,
        },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({
    ingest_run_id,
    asset_id,
    source_type,
    filename,
    content_sha256,
    ingest_status: final_ingest_status,
    normalized_text,
    extraction_metadata,
    binary_ref,
    memory_store_id,
    memory_version_id,
    schema_version,
    trust_governance: buildTrustGovernanceMetadata(trustPolicy, now),
    quarantine_reason_codes: trustPolicy.reasonCodes,
  });
}

// ---------------------------------------------------------------------------
// Wiki update helper — Session 8d
// ---------------------------------------------------------------------------

interface WikiUpdateParams {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  asset_id: string;
  filename: string;
  project_id: string;
  acl_scope: string;
  ingest_run_id: string;
  memory_version_id: string;
}

async function updateWikiPagesAfterIngest(params: WikiUpdateParams): Promise<void> {
  const { db, asset_id, filename, project_id, acl_scope, ingest_run_id, memory_version_id } = params;
  const now = new Date().toISOString();
  const pageSlug = `assets/${asset_id}/summary`;

  try {
    // 1. Create or update the asset summary wiki page.
    const summaryContent = `# Asset Summary — ${filename}

**Asset ID:** ${asset_id}
**Project:** ${project_id}
**Ingested:** ${now}
**ACL scope:** ${acl_scope}
**Ingest run:** ${ingest_run_id}
**Memory version:** ${memory_version_id}

## Summary
This page is the compiled summary for asset \`${asset_id}\` (file: \`${filename}\`).
It was auto-generated at ingest time by the Session 8d memory pipeline.

## Source
- File path: \`${filename}\`
- Memory path: \`/assets/${asset_id}.md\`
`;

    await db.from("wiki_pages").upsert(
      {
        slug: pageSlug,
        title: `Asset Summary — ${filename}`,
        page_type: "summary",
        content_md: summaryContent,
        source_asset_ids: [asset_id],
        acl_scope,
        shaping_job_id: ingest_run_id,
      },
      { onConflict: "slug" },
    );

    // 2. Update root/index to reference the new page.
    const { data: indexRows } = await db
      .from("wiki_pages")
      .select("page_id, content_md")
      .eq("slug", "root/index");

    const indexRow = (indexRows as Array<{ page_id: string; content_md: string }>)?.[0];
    if (indexRow) {
      const refLine = `| [[${pageSlug}]] | Asset Summary — ${filename} | summary | Auto-generated summary for ${asset_id} |`;
      const updatedIndex = indexRow.content_md.includes(pageSlug)
        ? indexRow.content_md
        : indexRow.content_md + `\n${refLine}`;

      await db
        .from("wiki_pages")
        .update({ content_md: updatedIndex, shaping_job_id: ingest_run_id })
        .eq("page_id", indexRow.page_id);
    }

    // 3. Append to root/log.
    const { data: logRows } = await db
      .from("wiki_pages")
      .select("page_id, content_md")
      .eq("slug", "root/log");

    const logRow = (logRows as Array<{ page_id: string; content_md: string }>)?.[0];
    if (logRow) {
      const logEntry = `
## ${now} | ingest | ${ingest_run_id}

**Run ID:** \`${ingest_run_id}\`
**Event:** ingest
**Summary:** Asset \`${asset_id}\` (${filename}) ingested and canonical memory written.
**Assets affected:** \`${asset_id}\`
**Pages created or updated:** [[${pageSlug}]], [[root/index]]
**Memory version:** \`${memory_version_id}\`

---`;
      const updatedLog = logRow.content_md + logEntry;
      await db
        .from("wiki_pages")
        .update({ content_md: updatedLog, shaping_job_id: ingest_run_id })
        .eq("page_id", logRow.page_id);
    }
  } catch (wikiErr) {
    // Wiki update failure is non-fatal — log and continue.
    console.warn("Wiki update after ingest failed (non-fatal):", wikiErr);
  }
}
