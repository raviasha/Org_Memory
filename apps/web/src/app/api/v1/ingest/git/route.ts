/**
 * POST /api/v1/ingest/git — Session 5
 *
 * Git connector MVP.  Accepts a repository URL (and optional per-file
 * override via `stub_seed_dir` for the prototype) and produces:
 *   1. A parent `git_repo` asset record for the repository itself.
 *   2. One child `document` asset record per file in the repository, each
 *      carrying `parent_asset_id` and `lineage_metadata`.
 *
 * Prototype behaviour
 * -------------------
 * Real git clone is not executed in the prototype.  Instead the connector
 * reads normalized text from a local `stub_seed_dir` that mirrors the
 * repository's file tree.  If `stub_seed_dir` is omitted the connector
 * falls back to synthetic placeholder text so the API contract remains
 * testable without a local Supabase instance.
 *
 * For real git ingest (v2) replace `resolveFileContent` with a `git clone`
 * or GitHub API call and keep the rest of the pipeline unchanged.
 *
 * Request body (JSON):
 * {
 *   repo_url:      string        // canonical GitHub / git URL
 *   repo_slug:     string        // e.g. "platform-services-repo"
 *   project_id:    string        // must already exist in `projects` table
 *   org_id:        string        // UUID
 *   acl_scope:     string        // e.g. "org:acme"
 *   branch?:       string        // default "main"
 *   stub_seed_dir?: string       // absolute fs path for prototype file reads
 *   files?:        FileSpec[]    // explicit file manifest (overrides discovery)
 * }
 *
 * FileSpec: { relative_path: string, source_type?: "document" | "image" }
 *
 * Response 200:
 * {
 *   ingest_run_id:    string
 *   repo_asset_id:    string   // UUID of the parent git_repo asset
 *   file_asset_count: number
 *   file_assets:      { asset_id, relative_path, ingest_status }[]
 * }
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Auth helper (same pattern as health endpoint)
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
// Types
// ---------------------------------------------------------------------------

interface FileSpec {
  relative_path: string;
  source_type?: "document" | "image";
}

interface IngestGitBody {
  repo_url: string;
  repo_slug: string;
  project_id: string;
  org_id: string;
  acl_scope: string;
  branch?: string;
  stub_seed_dir?: string;
  files?: FileSpec[];
}

// ---------------------------------------------------------------------------
// Default file manifest for platform-services-repo stub
// Maps `relative_path_in_repo` → `sibling_seed_file` so we can read
// normalized text from the standalone seed-data files.
// ---------------------------------------------------------------------------

const PLATFORM_SERVICES_REPO_MANIFEST: FileSpec[] = [
  { relative_path: "runbooks/api-gateway-runbook.md", source_type: "document" },
  {
    relative_path: "runbooks/database-failover-runbook.md",
    source_type: "document",
  },
  {
    relative_path: "config/alert-thresholds-config.yml",
    source_type: "document",
  },
  {
    relative_path: "postmortems/incident-postmortem-2026-03-15.md",
    source_type: "document",
  },
  {
    relative_path: "postmortems/incident-postmortem-2025-11-22.md",
    source_type: "document",
  },
];

// ---------------------------------------------------------------------------
// Resolve normalized text for a single file
// ---------------------------------------------------------------------------

function resolveFileContent(
  relPath: string,
  stubSeedDir: string | undefined,
  projectId: string,
  repoSlug: string,
): string {
  // 1. Try the exact path inside the stub seed dir.
  if (stubSeedDir) {
    const exact = path.join(stubSeedDir, relPath);
    if (fs.existsSync(exact)) {
      return fs.readFileSync(exact, "utf-8");
    }

    // 2. Fall back to the sibling seed-data directory for known files.
    //    e.g. "runbooks/api-gateway-runbook.md" → "api-gateway-runbook.md"
    const basename = path.basename(relPath);
    const siblingDir = path.join(
      path.dirname(path.dirname(stubSeedDir)),
      projectId,
    );
    const sibling = path.join(siblingDir, basename);
    if (fs.existsSync(sibling)) {
      return fs.readFileSync(sibling, "utf-8");
    }
  }

  // 3. Synthetic stub — no real file available.
  return `[git_repo stub — ${repoSlug}/${relPath}]`;
}

// ---------------------------------------------------------------------------
// Deterministic UUID v5 from a namespace + name
// Keeps asset IDs stable across idempotent re-ingests.
// ---------------------------------------------------------------------------

const GIT_NAMESPACE = "6ba7b812-9dad-11d1-80b4-00c04fd430c8"; // UUID v5 DNS

function uuidv5(namespace: string, name: string): string {
  const nsBytes = namespace.replace(/-/g, "").match(/.{2}/g)!.map((h) => parseInt(h, 16));
  const nameBytes = Buffer.from(name, "utf-8");
  const hash = crypto.createHash("sha1");
  hash.update(Buffer.from(nsBytes));
  hash.update(nameBytes);
  const digest = hash.digest();
  // Set version (v5) and variant bits
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
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  // Auth check
  const auth = await verifyAuth(request);
  if (!auth.ok) return auth.response;

  // Parse body
  let body: IngestGitBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body", code: "invalid_body" },
      { status: 400 },
    );
  }

  // Validate required fields
  const required = ["repo_url", "repo_slug", "project_id", "org_id", "acl_scope"] as const;
  for (const field of required) {
    if (!body[field]) {
      return NextResponse.json(
        { error: `Missing required field: ${field}`, code: "missing_field" },
        { status: 400 },
      );
    }
  }

  const {
    repo_url,
    repo_slug,
    project_id,
    org_id,
    acl_scope,
    branch = "main",
    stub_seed_dir,
    files,
  } = body;

  // Resolve file manifest
  const fileManifest: FileSpec[] =
    files ??
    (repo_slug === "platform-services-repo"
      ? PLATFORM_SERVICES_REPO_MANIFEST
      : []);

  if (fileManifest.length === 0) {
    return NextResponse.json(
      {
        error:
          "No file manifest provided and no built-in manifest for this repo slug. " +
          "Pass `files` in the request body.",
        code: "empty_file_manifest",
      },
      { status: 400 },
    );
  }

  const ingest_run_id = crypto.randomUUID();
  const now = new Date().toISOString();

  // Deterministic parent asset_id (stable across re-ingests)
  const parentAssetId = uuidv5(GIT_NAMESPACE, `${org_id}:${project_id}:${repo_slug}`);

  // Build parent repo record
  const parentRecord = {
    asset_id: parentAssetId,
    org_id,
    project_id,
    source_type: "git_repo" as const,
    file_path_or_url: repo_url,
    normalized_text: `Git repository: ${repo_url}\nBranch: ${branch}\nSlug: ${repo_slug}\nFiles: ${fileManifest.map((f) => f.relative_path).join(", ")}`,
    optional_binary_ref: null,
    acl_scope,
    ingest_status: "indexed" as const,
    content_hash: null,
    parent_asset_id: null,
    lineage_metadata: {
      repo_url,
      repo_slug,
      branch,
      ingest_run_id,
      file_count: fileManifest.length,
    },
    ingested_at: now,
    last_modified_at: now,
  };

  // Build per-file child records
  const fileRecords = fileManifest.map((spec) => {
    const relPath = spec.relative_path;
    const fileAssetId = uuidv5(
      GIT_NAMESPACE,
      `${org_id}:${project_id}:${repo_slug}:${relPath}`,
    );
    const normalizedText = resolveFileContent(
      relPath,
      stub_seed_dir,
      project_id,
      repo_slug,
    );
    const stem = path.basename(relPath, path.extname(relPath));
    const contentHash = crypto
      .createHash("sha256")
      .update(normalizedText)
      .digest("hex");

    return {
      asset_id: fileAssetId,
      org_id,
      project_id,
      source_type: (spec.source_type ?? "document") as "document" | "image",
      file_path_or_url: `${repo_slug}/${relPath}`,
      normalized_text: normalizedText,
      optional_binary_ref: null,
      acl_scope,
      ingest_status: "indexed" as const,
      content_hash: contentHash,
      parent_asset_id: parentAssetId,
      lineage_metadata: {
        repo_url,
        repo_slug,
        branch,
        relative_path: relPath,
        file_stem: stem,
        ingest_run_id,
      },
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

      // Upsert parent repo asset
      const { error: parentErr } = await db
        .from("assets")
        .upsert(parentRecord, { onConflict: "asset_id" });
      if (parentErr) throw parentErr;

      // Upsert per-file child assets
      for (const rec of fileRecords) {
        const { error: fileErr } = await db
          .from("assets")
          .upsert(rec, { onConflict: "asset_id" });
        if (fileErr) throw fileErr;
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
      repo_asset_id: parentAssetId,
      file_asset_count: fileRecords.length,
      file_assets: fileRecords.map((r) => ({
        asset_id: r.asset_id,
        relative_path: (r.lineage_metadata as { relative_path: string }).relative_path,
        file_path_or_url: r.file_path_or_url,
        project_id: r.project_id,
        ingest_status: r.ingest_status,
        lineage_metadata: r.lineage_metadata,
      })),
    },
    { status: 200 },
  );
}
