/**
 * GET /api/v1/index-jobs — Session 17
 *
 * List index_jobs with optional filters. Used by the ingest operations screen
 * and Playwright API tests to monitor the incremental indexing queue.
 *
 * Query parameters:
 *   asset_id    string  — filter by asset
 *   project_id  string  — filter by project
 *   status      string  — filter by job status (queued | running | completed | failed | no_change)
 *   limit       int     — max results (default 50, max 200)
 *   cursor      string  — opaque pagination cursor (job_id of last seen row)
 *
 * Response 200:
 * {
 *   data: IndexJob[],
 *   pagination: { has_more, next_cursor, total_count }
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
      // Supabase unreachable in dev — allow through.
    }
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const auth = await verifyAuth(request);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const asset_id = searchParams.get("asset_id") ?? undefined;
  const project_id = searchParams.get("project_id") ?? undefined;
  const statusFilter = searchParams.get("status") ?? undefined;
  const limitRaw = parseInt(searchParams.get("limit") ?? "50", 10);
  const limit = Math.min(Math.max(1, isNaN(limitRaw) ? 50 : limitRaw), 200);
  const cursor = searchParams.get("cursor") ?? undefined;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (supabaseUrl && supabaseServiceKey) {
    try {
      const { createClient } = await import("@supabase/supabase-js");
      const db = createClient(supabaseUrl, supabaseServiceKey, {
        auth: { persistSession: false },
      });

      let query = db
        .from("index_jobs")
        .select("*", { count: "exact" })
        .order("requested_at", { ascending: false })
        .limit(limit + 1);

      if (asset_id) query = query.eq("asset_id", asset_id);
      if (project_id) query = query.eq("project_id", project_id);
      if (statusFilter) query = query.eq("status", statusFilter);
      if (cursor) query = query.lt("requested_at", cursor);

      const { data, error, count } = await query;

      if (error) {
        return NextResponse.json(
          { error: "Database error", code: "db_error", details: error.message },
          { status: 500 },
        );
      }

      const rows = data ?? [];
      const has_more = rows.length > limit;
      const page = has_more ? rows.slice(0, limit) : rows;
      const next_cursor = has_more
        ? (page[page.length - 1]?.requested_at ?? null)
        : null;

      return NextResponse.json(
        {
          data: page,
          pagination: {
            has_more,
            next_cursor,
            total_count: count ?? null,
          },
        },
        { status: 200 },
      );
    } catch (err) {
      return NextResponse.json(
        {
          error: "Internal error",
          code: "internal_error",
          details: err instanceof Error ? err.message : String(err),
        },
        { status: 500 },
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Stub path (no Supabase)
  // ---------------------------------------------------------------------------
  return NextResponse.json(
    {
      data: [],
      pagination: { has_more: false, next_cursor: null, total_count: 0 },
      _stub: true,
    },
    { status: 200 },
  );
}

// ---------------------------------------------------------------------------
// POST /api/v1/index-jobs/run is in a separate route file (run/route.ts)
// so this file only exposes GET.
// ---------------------------------------------------------------------------
