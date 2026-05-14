/**
 * POST /api/v1/ingest/folder — Session 5b
 *
 * Folder upload ingest pipeline.
 *
 * Accepts multipart/form-data with multiple files and project metadata.
 * Models a recursive folder ingest: every file becomes a child asset record
 * linked to a parent `folder` asset record.  Produces:
 *   1. One parent `folder` asset record for the logical folder root.
 *   2. One child asset record per file, each carrying `parent_asset_id`,
 *      `lineage_metadata`, `extraction_metadata`, and `content_hash`.
 *   3. Per-file normalized text and extraction metadata following the same
 *      pipeline as `POST /api/v1/ingest/upload`.
 *   4. Binary originals stored in Supabase Storage bucket "assets" at
 *      `<project_id>/<parent_asset_id>/<relative_path>`.
 *
 * Prototype behaviour
 * -------------------
 * Same text extraction and OCR stubs as the upload route.
 * The "relative path" of each file is taken from the form field name
 * (e.g. `files[runbooks/api-gateway-runbook.md]`) when provided, or falls
 * back to the filename.  Clients that POST via the seed script or tests can
 * supply `relative_path_<N>` fields to explicitly map each file to its path.
 *
 * Request body (multipart/form-data):
 *   files           File[]  — one or more files (field name "files", repeated)
 *   relative_paths  string  — JSON array of relative paths parallel to `files`
 *                             (optional; falls back to each file's `.name`)
 *   folder_name     string  — human-readable name for the folder (required)
 *   project_id      string  — must already exist in `projects` table (required)
 *   org_id          string  — UUID (required)
 *   acl_scope       string  — e.g. "org:acme" (required)
 *
 * Response 200:
 * {
 *   ingest_run_id:     string
 *   folder_asset_id:   string
 *   file_asset_count:  number
 *   file_assets: {
 *     asset_id, filename, relative_path, source_type,
 *     content_sha256, ingest_status, normalized_text, extraction_metadata,
 *     binary_ref
 *   }[]
 * }
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import * as crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Auth helper
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
// MIME / source type helpers (shared logic with upload route)
// ---------------------------------------------------------------------------

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

const IMAGE_MIME_SET = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/tiff",
  "image/webp",
  "image/gif",
]);

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
): "document" | "image" {
  if (IMAGE_MIME_SET.has(mime)) return "image";
  if (mime in DOCUMENT_MIME_MAP) return "document";
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "tiff", "webp", "gif"].includes(ext))
    return "image";
  // Default to document for any unrecognised type.
  return "document";
}

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

function stubImageExtraction(
  filename: string,
  mime: string,
): { normalized_text: string; extraction_metadata: Record<string, unknown> } {
  const stem = filename.replace(/\.[^.]+$/, "");
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

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected multipart/form-data body", code: "invalid_body" },
      { status: 400 },
    );
  }

  const folder_name = formData.get("folder_name");
  const project_id = formData.get("project_id");
  const org_id = formData.get("org_id");
  const acl_scope = formData.get("acl_scope");
  const relative_paths_raw = formData.get("relative_paths");

  if (!folder_name || typeof folder_name !== "string") {
    return NextResponse.json(
      {
        error: "Missing required form field: folder_name",
        code: "missing_field",
      },
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

  // Collect all files from the "files" field (multi-value).
  const rawFiles = formData.getAll("files");
  const files: File[] = rawFiles.filter((f): f is File => f instanceof File);

  if (files.length === 0) {
    return NextResponse.json(
      {
        error: 'No files found in form field "files"',
        code: "missing_field",
      },
      { status: 400 },
    );
  }

  // Parse optional relative paths override.
  let relativePaths: string[] = [];
  if (relative_paths_raw && typeof relative_paths_raw === "string") {
    try {
      const parsed = JSON.parse(relative_paths_raw);
      if (Array.isArray(parsed)) relativePaths = parsed.map(String);
    } catch {
      // Ignore parse errors; fall back to filenames.
    }
  }

  const ingest_run_id = crypto.randomUUID();
  const folder_asset_id = crypto.randomUUID();
  const now = new Date().toISOString();

  // ---------------------------------------------------------------------------
  // Process each file
  // ---------------------------------------------------------------------------

  interface FileResult {
    asset_id: string;
    filename: string;
    relative_path: string;
    source_type: "document" | "image";
    content_sha256: string;
    ingest_status: "indexed";
    normalized_text: string;
    extraction_metadata: Record<string, unknown>;
    binary_ref: string | null;
  }

  const fileResults: FileResult[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const filename = file.name;
    const relative_path = relativePaths[i] ?? filename;
    const mime = file.type || "application/octet-stream";
    const source_type = guessSourceType(mime, filename);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const content_sha256 = crypto
      .createHash("sha256")
      .update(bytes)
      .digest("hex");

    const { normalized_text, extraction_metadata } =
      source_type === "image"
        ? stubImageExtraction(filename, mime)
        : extractDocumentText(bytes, mime, filename);

    fileResults.push({
      asset_id: crypto.randomUUID(),
      filename,
      relative_path,
      source_type,
      content_sha256,
      ingest_status: "indexed",
      normalized_text,
      extraction_metadata,
      binary_ref: null,
    });
  }

  // ---------------------------------------------------------------------------
  // Supabase path (when configured)
  // ---------------------------------------------------------------------------

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

      // Insert parent folder record.
      const folderRecord = {
        asset_id: folder_asset_id,
        org_id,
        project_id,
        source_type: "folder" as const,
        file_path_or_url: folder_name,
        normalized_text: `Folder: ${folder_name}\nFiles: ${fileResults.map((f) => f.relative_path).join(", ")}`,
        optional_binary_ref: null,
        acl_scope,
        ingest_status: "indexed" as const,
        content_hash: null,
        parent_asset_id: null,
        lineage_metadata: {
          folder_name,
          ingest_run_id,
          file_count: fileResults.length,
        },
        extraction_metadata: {
          source_format: "folder",
          file_count: fileResults.length,
        },
        ingested_at: now,
        last_modified_at: now,
      };

      const { error: folderErr } = await db
        .from("assets")
        .upsert(folderRecord, { onConflict: "asset_id" });
      if (folderErr) throw folderErr;

      // Upload and insert each file.
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const result = fileResults[i];
        const bytes = new Uint8Array(await file.arrayBuffer());
        const mime = file.type || "application/octet-stream";
        const storage_path = `${project_id}/${folder_asset_id}/${result.relative_path}`;

        // Upload binary to storage.
        const { error: storageErr } = await db.storage
          .from("assets")
          .upload(storage_path, bytes, { contentType: mime, upsert: true });

        if (storageErr) {
          console.warn(
            `Storage upload failed for ${result.filename} (continuing):`,
            storageErr.message,
          );
        } else {
          result.binary_ref = storage_path;
        }

        const fileRecord = {
          asset_id: result.asset_id,
          org_id,
          project_id,
          source_type: result.source_type,
          file_path_or_url: result.relative_path,
          normalized_text: result.normalized_text,
          optional_binary_ref: result.binary_ref,
          acl_scope,
          ingest_status: "indexed" as const,
          content_hash: result.content_sha256,
          parent_asset_id: folder_asset_id,
          lineage_metadata: {
            folder_name,
            folder_path: folder_name,
            relative_path: result.relative_path,
            ingest_run_id,
          },
          extraction_metadata: result.extraction_metadata,
          ingested_at: now,
          last_modified_at: now,
        };

        const { error: insertErr } = await db
          .from("assets")
          .upsert(fileRecord, { onConflict: "asset_id" });
        if (insertErr) throw insertErr;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        {
          error: "Database error during folder ingest",
          code: "db_error",
          details: msg,
        },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({
    ingest_run_id,
    folder_asset_id,
    file_asset_count: fileResults.length,
    file_assets: fileResults.map((r) => ({
      asset_id: r.asset_id,
      filename: r.filename,
      relative_path: r.relative_path,
      source_type: r.source_type,
      content_sha256: r.content_sha256,
      ingest_status: r.ingest_status,
      normalized_text: r.normalized_text,
      extraction_metadata: r.extraction_metadata,
      binary_ref: r.binary_ref,
    })),
  });
}
