/**
 * GET /api/v1/assets — Session 5
 *
 * List asset records with optional project and source-type filters.
 * Used by the UI inventory panel and Playwright API tests.
 *
 * Query parameters:
 *   project_id    string  — filter by project
 *   source_type   string  — filter by source type (document, git_repo, …)
 *   parent_asset_id string — filter children of a specific parent (e.g. git repo)
 *   limit         int     — max results (default 50, max 200)
 *   cursor        string  — opaque pagination cursor (asset_id of last seen row)
 *
 * Response 200:
 * {
 *   data: Asset[],
 *   pagination: { has_more, next_cursor, total_count }
 * }
 *
 * Each Asset includes the new Session-5 fields: parent_asset_id and
 * lineage_metadata.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Auth check
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
      // Supabase unreachable in dev — allow through.
    }
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const auth = await verifyAuth(request);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);

  const projectId = searchParams.get("project_id");
  const sourceType = searchParams.get("source_type");
  const parentAssetId = searchParams.get("parent_asset_id");
  const rawLimit = parseInt(searchParams.get("limit") ?? "50", 10);
  const limit = Math.min(Math.max(rawLimit, 1), 200);
  const cursor = searchParams.get("cursor");

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

      let query = db
        .from("assets")
        .select(
          "asset_id, org_id, project_id, source_type, file_path_or_url, " +
            "acl_scope, ingest_status, content_hash, ingested_at, last_modified_at, " +
            "parent_asset_id, lineage_metadata, deleted_at, deleted_by",
          { count: "exact" },
        )
        .order("ingested_at", { ascending: false })
        .limit(limit + 1); // fetch one extra to detect has_more

      if (projectId) query = query.eq("project_id", projectId);
      if (sourceType) query = query.eq("source_type", sourceType);
      if (parentAssetId) query = query.eq("parent_asset_id", parentAssetId);
      if (cursor) query = query.lt("asset_id", cursor); // simple keyset pagination

      const { data, error, count } = await query;

      if (error) throw error;

      const rows = data ?? [];
      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor = hasMore ? page[page.length - 1].asset_id : null;

      return NextResponse.json({
        data: page,
        pagination: {
          has_more: hasMore,
          next_cursor: nextCursor,
          total_count: count,
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { error: "Database query failed", code: "db_error", details: msg },
        { status: 500 },
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Fallback (no Supabase configured) — return empty list so UI stays runnable
  // ---------------------------------------------------------------------------

  return NextResponse.json({
    data: [],
    pagination: { has_more: false, next_cursor: null, total_count: 0 },
  });
}
