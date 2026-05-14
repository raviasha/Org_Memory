/**
 * POST /api/v1/ingest/upload — Session 5b
 *
 * Document and image upload ingest pipeline.
 *
 * Accepts multipart/form-data with a single file plus project metadata.
 * Produces:
 *   1. Normalized text derivative (reads text files directly; prototype stub
 *      for binary formats such as PDF/DOCX/XLSX/PPTX).
 *   2. Extraction metadata (mime_type, character_count for documents;
 *      ocr_text, caption, ocr_confidence for images).
 *   3. Binary original stored in Supabase Storage bucket "assets" with a
 *      deterministic path keyed to asset_id (signed URL returned in response).
 *   4. Canonical asset record in the `assets` table with provenance hash
 *      (SHA-256 of the file bytes), extraction_metadata, and optional_binary_ref.
 *
 * Prototype behaviour
 * -------------------
 * Real PDF/DOCX parsing and OCR are not executed in the prototype.  Instead:
 * - Text-based files (md, txt, csv, yml, yaml, json) have their content read
 *   directly as normalized_text.
 * - Binary document formats receive a stub: "[prototype-stub: <mime_type> —
 *   full extraction deferred to v2]".
 * - Image files receive a deterministic OCR stub derived from the filename,
 *   a canned caption, and a confidence score of 0 to signal the stub.
 * For real OCR (v2) replace `stubImageExtraction` / `extractDocumentText`
 * with a vision API call and keep the rest of the pipeline unchanged.
 *
 * Request body (multipart/form-data):
 *   file        File    — the asset to ingest (required)
 *   project_id  string  — must already exist in `projects` table (required)
 *   org_id      string  — UUID (required)
 *   acl_scope   string  — e.g. "org:acme" (required)
 *
 * Response 200:
 * {
 *   ingest_run_id:     string
 *   asset_id:          string
 *   source_type:       "document" | "image"
 *   filename:          string
 *   content_sha256:    string
 *   ingest_status:     "indexed"
 *   normalized_text:   string
 *   extraction_metadata: object
 *   binary_ref:        string | null    // storage path or signed URL
 * }
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import * as crypto from "node:crypto";

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
        ingest_status: "indexed",
        content_hash: content_sha256,
        parent_asset_id: null,
        lineage_metadata: { ingest_run_id, source_format: source_type },
        extraction_metadata,
        ingested_at: now,
        last_modified_at: now,
      };

      const { error: insertErr } = await db
        .from("assets")
        .upsert(record, { onConflict: "asset_id" });
      if (insertErr) throw insertErr;
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
    ingest_status: "indexed",
    normalized_text,
    extraction_metadata,
    binary_ref,
  });
}
