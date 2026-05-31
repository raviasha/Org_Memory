/**
 * POST /api/v1/ingest/url — Session 6
 *
 * Web/wiki URL connector MVP.  Accepts a URL, fetches the page, extracts
 * normalized text, and stores a canonical asset record assigned to the
 * specified project.
 *
 * Produces:
 *   1. Normalized text derivative — HTML tags stripped, inline whitespace
 *      collapsed, section headings preserved as Markdown-style `## Heading`.
 *   2. Section metadata — array of {title, char_offset} entries for each
 *      heading found in the page.
 *   3. Timestamps — `fetched_at` (wall clock) and `page_last_modified` from
 *      the HTTP `Last-Modified` response header (null when absent).
 *   4. Canonical asset record in the `assets` table with source_type "url",
 *      provenance hash (SHA-256 of normalized text), and extraction_metadata.
 *
 * Prototype behaviour
 * -------------------
 * Real network fetch is attempted when the URL is reachable.  When the URL is
 * not reachable (e.g. in CI without network access) the caller may pass
 * `stub_content` in the request body to provide pre-fetched HTML or plain
 * text; the pipeline still runs extraction on the stub content.
 *
 * For a live fetch the route uses the native `fetch` API available in the
 * Next.js Edge/Node runtime.  No headless browser is used in v1.
 *
 * Request body (JSON):
 * {
 *   url:           string   — canonical URL to scrape (required)
 *   project_id:    string   — must already exist in `projects` table (required)
 *   org_id:        string   — UUID (required)
 *   acl_scope:     string   — e.g. "org:acme" (required)
 *   asset_slug?:   string   — human-readable slug for the asset, used as the
 *                             file_path_or_url display name (optional; defaults
 *                             to URL hostname + pathname stem)
 *   stub_content?: string   — pre-fetched HTML or plain text for CI/offline use
 *   fetch_timeout_ms?: number — max ms to wait for the HTTP response (default 10000)
 * }
 *
 * Response 200:
 * {
 *   ingest_run_id:       string
 *   asset_id:            string
 *   source_type:         "url"
 *   url:                 string
 *   asset_slug:          string
 *   project_id:          string
 *   content_sha256:      string
 *   ingest_status:       "indexed"
 *   normalized_text:     string
 *   extraction_metadata: {
 *     source_format:      "html" | "text"
 *     character_count:    number
 *     section_count:      number
 *     sections:           { title: string; char_offset: number }[]
 *     fetched_at:         string          // ISO-8601
 *     page_last_modified: string | null   // from HTTP Last-Modified header
 *     http_status:        number | null   // null when stub_content was used
 *     content_type:       string | null
 *   }
 * }
 *
 * Error responses:
 *   400  missing_field / invalid_url / fetch_failed
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
// HTML → plain-text extraction
// ---------------------------------------------------------------------------

interface Section {
  title: string;
  char_offset: number;
}

interface ExtractionResult {
  normalized_text: string;
  source_format: "html" | "text";
  sections: Section[];
}

/**
 * Minimal HTML-to-text converter.
 *
 * Strategy:
 * 1. Remove <script>, <style>, <noscript>, <nav>, <footer>, <header> blocks.
 * 2. Replace heading tags (h1–h6) with Markdown-style `## Title` lines so
 *    section structure is preserved in the normalized text.
 * 3. Replace <li> with "- " bullets and <br>/<p> with newlines.
 * 4. Strip all remaining tags.
 * 5. Decode common HTML entities.
 * 6. Collapse runs of whitespace and blank lines.
 * 7. Collect section offsets for metadata.
 */
function extractFromHtml(html: string): ExtractionResult {
  // Remove blocks that don't carry content.
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "");

  // Convert heading tags to Markdown headings.
  text = text.replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, (_, inner) => {
    const headingText = inner.replace(/<[^>]+>/g, "").trim();
    return `\n## ${headingText}\n`;
  });

  // Convert list items and line breaks.
  text = text
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/li>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/tr>/gi, "\n");

  // Strip all remaining tags.
  text = text.replace(/<[^>]+>/g, " ");

  // Decode common HTML entities.
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&[a-z]+;/gi, " ");

  // Collapse whitespace runs and trim.
  text = text
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // Collect section headings and their char offsets.
  const sections: Section[] = [];
  const sectionRegex = /^## (.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = sectionRegex.exec(text)) !== null) {
    sections.push({ title: match[1].trim(), char_offset: match.index });
  }

  return { normalized_text: text, source_format: "html", sections };
}

/**
 * Treat the input as plain text (no HTML parsing needed).
 * Still collect section headings from Markdown-style `## Heading` lines.
 */
function extractFromText(raw: string): ExtractionResult {
  const text = raw.trim();
  const sections: Section[] = [];
  const sectionRegex = /^##+ (.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = sectionRegex.exec(text)) !== null) {
    sections.push({ title: match[1].trim(), char_offset: match.index });
  }
  return { normalized_text: text, source_format: "text", sections };
}

// ---------------------------------------------------------------------------
// Deterministic UUID v5 helper (same as git connector)
// ---------------------------------------------------------------------------

const URL_NAMESPACE = "6ba7b814-9dad-11d1-80b4-00c04fd430c8";

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
// Derive a human-readable slug from a URL when none is supplied.
// ---------------------------------------------------------------------------

function slugFromUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const stem = u.pathname
      .replace(/\/$/, "")
      .split("/")
      .filter(Boolean)
      .join("-")
      .replace(/[^a-z0-9-]/gi, "-")
      .toLowerCase();
    const host = u.hostname.replace(/^www\./, "").replace(/\./g, "-");
    return stem ? `${host}-${stem}` : host;
  } catch {
    return "url-asset";
  }
}

// ---------------------------------------------------------------------------
// Request body type
// ---------------------------------------------------------------------------

interface IngestUrlBody {
  url: string;
  project_id: string;
  org_id: string;
  acl_scope: string;
  asset_slug?: string;
  stub_content?: string;
  fetch_timeout_ms?: number;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  // Auth check
  const auth = await verifyAuth(request);
  if (!auth.ok) return auth.response;

  // Parse body
  let body: IngestUrlBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body", code: "invalid_body" },
      { status: 400 },
    );
  }

  // Validate required fields
  const required = ["url", "project_id", "org_id", "acl_scope"] as const;
  for (const field of required) {
    if (!body[field]) {
      return NextResponse.json(
        { error: `Missing required field: ${field}`, code: "missing_field" },
        { status: 400 },
      );
    }
  }

  // Validate URL format
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(body.url);
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      throw new Error("Only http and https URLs are supported");
    }
  } catch (e) {
    return NextResponse.json(
      {
        error: `Invalid URL: ${(e as Error).message}`,
        code: "invalid_url",
      },
      { status: 400 },
    );
  }

  const { url, project_id, org_id, acl_scope } = body;
  const asset_slug = body.asset_slug ?? slugFromUrl(url);
  const fetchTimeoutMs = body.fetch_timeout_ms ?? 10_000;

  const fetched_at = new Date().toISOString();
  let httpStatus: number | null = null;
  let pageLastModified: string | null = null;
  let rawContent: string;
  let sourceFormat: "html" | "text" = "html";

  // ---------------------------------------------------------------------------
  // Fetch or use stub content
  // ---------------------------------------------------------------------------

  if (body.stub_content !== undefined) {
    // Caller supplied pre-fetched content — use it directly.
    rawContent = body.stub_content;
    // Detect whether it looks like HTML.
    sourceFormat = /<\s*[a-z]/i.test(rawContent) ? "html" : "text";
  } else {
    // Live fetch with timeout.
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), fetchTimeoutMs);
      let response: Response;
      try {
        response = await fetch(url, {
          signal: controller.signal,
          headers: {
            "User-Agent": "OrgMemoryBot/1.0 (page ingest)",
            Accept: "text/html,text/plain;q=0.9,*/*;q=0.8",
          },
        });
      } finally {
        clearTimeout(timeoutId);
      }

      httpStatus = response.status;
      pageLastModified = response.headers.get("last-modified");

      if (!response.ok) {
        return NextResponse.json(
          {
            error: `HTTP ${response.status} fetching URL`,
            code: "fetch_failed",
            http_status: response.status,
          },
          { status: 400 },
        );
      }

      const contentType = response.headers.get("content-type") ?? "";
      rawContent = await response.text();
      sourceFormat = contentType.includes("text/html") ? "html" : "text";
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json(
        {
          error: `Failed to fetch URL: ${msg}`,
          code: "fetch_failed",
        },
        { status: 400 },
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Extract normalized text and section metadata
  // ---------------------------------------------------------------------------

  const extraction =
    sourceFormat === "html"
      ? extractFromHtml(rawContent)
      : extractFromText(rawContent);

  const { normalized_text, sections } = extraction;
  const resolvedSourceFormat = extraction.source_format;

  const content_sha256 = crypto
    .createHash("sha256")
    .update(normalized_text)
    .digest("hex");

  // Deterministic asset_id — stable across idempotent re-ingests of the same URL.
  const asset_id = uuidv5(URL_NAMESPACE, `${org_id}:${project_id}:${url}`);

  const ingest_run_id = crypto.randomUUID();
  const now = new Date().toISOString();

  const extraction_metadata = {
    source_format: resolvedSourceFormat,
    character_count: normalized_text.length,
    section_count: sections.length,
    sections,
    fetched_at,
    page_last_modified: pageLastModified,
    http_status: httpStatus,
    content_type: sourceFormat === "html" ? "text/html" : "text/plain",
  };

  const trustPolicy = evaluateSourceTrust({
    sourceType: "url_scrape",
    fileNameOrUrl: url,
    normalizedText: normalized_text,
  });
  const finalIngestStatus = trustPolicy.quarantined ? "failed" : "indexed";

  const assetRecord = {
    asset_id,
    org_id,
    project_id,
    source_type: "url" as const,
    file_path_or_url: url,
    normalized_text,
    optional_binary_ref: null,
    acl_scope,
    ingest_status: finalIngestStatus,
    content_hash: content_sha256,
    parent_asset_id: null,
    lineage_metadata: {
      asset_slug,
      url,
      fetched_at,
      page_last_modified: pageLastModified,
      ingest_run_id,
      trust_governance: buildTrustGovernanceMetadata(trustPolicy, now),
    },
    extraction_metadata,
    ingested_at: now,
    last_modified_at: now,
  };

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

      // Upsert asset record (idempotent — keyed on deterministic asset_id)
      const { error: upsertErr } = await db
        .from("assets")
        .upsert(assetRecord, { onConflict: "asset_id" });
      if (upsertErr) throw upsertErr;
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
      asset_id,
      source_type: "url",
      url,
      asset_slug,
      project_id,
      content_sha256,
      ingest_status: finalIngestStatus,
      normalized_text,
      extraction_metadata,
      trust_governance: buildTrustGovernanceMetadata(trustPolicy, now),
      quarantine_reason_codes: trustPolicy.reasonCodes,
    },
    { status: 200 },
  );
}
