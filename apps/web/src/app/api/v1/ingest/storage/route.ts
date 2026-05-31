/**
 * POST /api/v1/ingest/storage — Session 7
 *
 * Storage connector MVP.  Ingests one or more objects from an object-store or
 * shared-folder source and produces project-assigned asset records.
 *
 * Supported source types (v1):
 *   - "s3"          — AWS S3 or S3-compatible bucket (e.g. MinIO)
 *   - "supabase"    — Supabase Storage bucket (same project)
 *   - "local_path"  — local filesystem path (prototype / CI use only)
 *
 * For each ingested object the connector:
 *   1. Produces a normalized text derivative (text files read directly;
 *      binary formats receive a prototype stub).
 *   2. Creates a canonical asset record in the `assets` table with
 *      source_type "storage_object", provenance hash (SHA-256), and
 *      extraction_metadata.
 *   3. Returns the full list of ingested asset records.
 *
 * Prototype behaviour
 * -------------------
 * Real cloud SDK calls (AWS S3, Supabase Storage) are not executed in the
 * prototype.  Callers may supply `stub_objects` in the request body — an
 * array of { key, content } pairs — to provide pre-fetched content.  The
 * pipeline runs extraction on the stub content so the API contract is fully
 * testable without cloud credentials.
 *
 * For real storage ingest (v2) replace `resolveObjectContent` with the
 * relevant SDK call and keep the rest of the pipeline unchanged.
 *
 * Request body (JSON):
 * {
 *   source_type:    "s3" | "supabase" | "local_path"   // required
 *   source_uri:     string   // bucket/path URI, e.g. "s3://my-bucket/prefix/"
 *   project_id:     string   // must already exist in `projects` table
 *   org_id:         string   // UUID
 *   acl_scope:      string   // e.g. "org:acme"
 *   stub_objects?:  { key: string; content: string }[]
 *                   // pre-fetched objects for prototype / CI use
 * }
 *
 * Response 200:
 * {
 *   ingest_run_id:    string
 *   source_type:      string
 *   source_uri:       string
 *   project_id:       string
 *   asset_count:      number
 *   assets: {
 *     asset_id:            string
 *     key:                 string   // object key / relative path
 *     ingest_status:       "indexed"
 *     content_sha256:      string
 *     normalized_text:     string
 *     extraction_metadata: object
 *   }[]
 * }
 *
 * Error responses:
 *   400  missing_field / invalid_source_type / no_objects
 *   401  missing_bearer_token / invalid_token
 *   404  project_not_found
 *   500  db_error
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import * as crypto from "node:crypto";
import {
  buildTrustGovernanceMetadata,
  evaluateSourceTrust,
} from "../../../../../lib/source-trust";

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
// Supported source types
// ---------------------------------------------------------------------------

const SUPPORTED_SOURCE_TYPES = ["s3", "supabase", "local_path"] as const;
type StorageSourceType = (typeof SUPPORTED_SOURCE_TYPES)[number];

// ---------------------------------------------------------------------------
// MIME / text detection helpers
// ---------------------------------------------------------------------------

const TEXT_EXTENSIONS = new Set([
  "txt", "md", "csv", "json", "yaml", "yml", "xml",
  "html", "htm", "js", "ts", "py", "sh", "log", "ini", "toml", "env",
]);

function isTextContent(key: string, content: string): boolean {
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  if (TEXT_EXTENSIONS.has(ext)) return true;
  // Heuristic: if < 5 % of the first 1024 bytes are non-printable → treat as text
  const sample = content.slice(0, 1024);
  const nonPrintable = (sample.match(/[^\x09\x0a\x0d\x20-\x7e]/g) ?? []).length;
  return nonPrintable / sample.length < 0.05;
}

function mimeFromKey(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    txt: "text/plain",
    md: "text/markdown",
    csv: "text/csv",
    json: "application/json",
    yaml: "application/yaml",
    yml: "application/yaml",
    xml: "application/xml",
    html: "text/html",
    htm: "text/html",
    pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    tiff: "image/tiff",
    webp: "image/webp",
  };
  return map[ext] ?? "application/octet-stream";
}

function isImageMime(mime: string): boolean {
  return mime.startsWith("image/");
}

// ---------------------------------------------------------------------------
// Extraction helpers (same prototype stubs as upload route)
// ---------------------------------------------------------------------------

interface ExtractionMetadata {
  mime_type: string;
  source_type_class: "document" | "image" | "other";
  [key: string]: unknown;
}

function extractDocumentText(key: string, content: string, mime: string): string {
  // Text-readable formats — use content directly.
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  if (isTextContent(key, content)) return content;
  // Binary format — prototype stub.
  return `[prototype-stub: ${mime} — full extraction deferred to v2]`;
}

function stubImageExtraction(key: string): {
  ocr_text: string;
  caption: string;
  ocr_confidence: number;
} {
  const stem = key.split("/").pop()?.split(".").slice(0, -1).join("-") ?? key;
  return {
    ocr_text: `[prototype-stub OCR for ${stem}]`,
    caption: `Image asset: ${stem}`,
    ocr_confidence: 0,
  };
}

function buildExtractionMetadata(
  key: string,
  content: string,
  mime: string,
): { metadata: ExtractionMetadata; normalizedText: string } {
  if (isImageMime(mime)) {
    const { ocr_text, caption, ocr_confidence } = stubImageExtraction(key);
    return {
      metadata: {
        mime_type: mime,
        source_type_class: "image",
        ocr_text,
        caption,
        ocr_confidence,
      },
      normalizedText: ocr_text,
    };
  }

  const normalizedText = extractDocumentText(key, content, mime);
  return {
    metadata: {
      mime_type: mime,
      source_type_class: "document",
      character_count: normalizedText.length,
    },
    normalizedText,
  };
}

// ---------------------------------------------------------------------------
// Deterministic UUID v5 helper (same as git / url connectors)
// ---------------------------------------------------------------------------

const STORAGE_NAMESPACE = "6ba7b816-9dad-11d1-80b4-00c04fd430c8";

function uuidv5(namespace: string, name: string): string {
  const nsBytes = namespace
    .replace(/-/g, "")
    .match(/.{2}/g)!
    .map((h) => parseInt(h, 16));
  const nameBytes = Buffer.from(name, "utf-8");
  const hash = crypto.createHash("sha1");
  hash.update(Buffer.from(nsBytes));
  hash.update(nameBytes);
  const digest = hash.digest();
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = digest.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

// ---------------------------------------------------------------------------
// Request body type
// ---------------------------------------------------------------------------

interface StubObject {
  key: string;
  content: string;
}

interface IngestStorageBody {
  source_type: StorageSourceType;
  source_uri: string;
  project_id: string;
  org_id: string;
  acl_scope: string;
  stub_objects?: StubObject[];
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  // Auth check
  const auth = await verifyAuth(request);
  if (!auth.ok) return auth.response;

  // Parse body
  let body: IngestStorageBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body", code: "invalid_body" },
      { status: 400 },
    );
  }

  // Validate required fields
  const requiredFields = ["source_type", "source_uri", "project_id", "org_id", "acl_scope"] as const;
  for (const field of requiredFields) {
    if (!body[field]) {
      return NextResponse.json(
        { error: `Missing required field: ${field}`, code: "missing_field" },
        { status: 400 },
      );
    }
  }

  // Validate source_type
  if (!(SUPPORTED_SOURCE_TYPES as readonly string[]).includes(body.source_type)) {
    return NextResponse.json(
      {
        error: `Unsupported source_type: ${body.source_type}. Supported: ${SUPPORTED_SOURCE_TYPES.join(", ")}`,
        code: "invalid_source_type",
      },
      { status: 400 },
    );
  }

  const { source_type, source_uri, project_id, org_id, acl_scope } = body;

  // Resolve objects to ingest — prototype uses stub_objects.
  // v2 would call the cloud SDK here based on source_type / source_uri.
  const stubObjects: StubObject[] = body.stub_objects ?? [];

  if (stubObjects.length === 0) {
    return NextResponse.json(
      {
        error:
          "No objects to ingest. In the prototype, supply stub_objects in the request body. " +
          "Real cloud SDK reads are deferred to v2.",
        code: "no_objects",
      },
      { status: 400 },
    );
  }

  const ingest_run_id = crypto.randomUUID();
  const now = new Date().toISOString();

  // Build asset records for each object
  const assetRecords = stubObjects.map((obj) => {
    const mime = mimeFromKey(obj.key);
    const { metadata, normalizedText } = buildExtractionMetadata(obj.key, obj.content, mime);
    const trustPolicy = evaluateSourceTrust({
      sourceType: "object_store",
      fileNameOrUrl: `${source_uri}/${obj.key}`,
      normalizedText,
    });
    const contentHash = crypto.createHash("sha256").update(obj.content).digest("hex");

    // Deterministic asset_id — stable across idempotent re-ingests
    const assetId = uuidv5(
      STORAGE_NAMESPACE,
      `${org_id}:${project_id}:${source_uri}:${obj.key}`,
    );

    return {
      asset_id: assetId,
      org_id,
      project_id,
      source_type: "storage_object" as const,
      file_path_or_url: `${source_uri}/${obj.key}`,
      normalized_text: normalizedText,
      optional_binary_ref: null,
      acl_scope,
      ingest_status: trustPolicy.quarantined ? "failed" as const : "indexed" as const,
      content_hash: contentHash,
      parent_asset_id: null,
      lineage_metadata: {
        storage_source_type: source_type,
        source_uri,
        object_key: obj.key,
        ingest_run_id,
        trust_governance: buildTrustGovernanceMetadata(trustPolicy, now),
      },
      extraction_metadata: metadata,
      ingested_at: now,
      last_modified_at: now,
    };
  });

  // ---------------------------------------------------------------------------
  // Persist to Supabase (if configured)
  // ---------------------------------------------------------------------------

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (supabaseUrl && supabaseServiceKey) {
    try {
      const { createClient } = await import("@supabase/supabase-js");
      const db = createClient(supabaseUrl, supabaseServiceKey, {
        auth: { persistSession: false },
      });

      // Verify project exists
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

      // Upsert each asset record
      for (const rec of assetRecords) {
        const { error: upsertErr } = await db
          .from("assets")
          .upsert(rec, { onConflict: "asset_id" });
        if (upsertErr) throw upsertErr;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { error: "Database error during ingest", code: "db_error", details: msg },
        { status: 500 },
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Response
  // ---------------------------------------------------------------------------

  return NextResponse.json(
    {
      ingest_run_id,
      source_type,
      source_uri,
      project_id,
      asset_count: assetRecords.length,
      assets: assetRecords.map((r) => ({
        asset_id: r.asset_id,
        key: r.lineage_metadata.object_key,
        ingest_status: r.ingest_status,
        content_sha256: r.content_hash,
        normalized_text: r.normalized_text,
        extraction_metadata: r.extraction_metadata,
      })),
    },
    { status: 200 },
  );
}
