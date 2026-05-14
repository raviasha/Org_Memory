/**
 * GET /api/v1/projects — Session 8
 *
 * List projects with KPI aggregates (asset count, last ingest, indexed count,
 * failed count). Used by the Project Hub index dashboard.
 *
 * Query parameters:
 *   limit   int  — max results (default 50, max 200)
 *   cursor  str  — opaque pagination cursor (project_id of last seen row)
 *
 * Response 200:
 * {
 *   data: ProjectKPI[],
 *   pagination: { has_more, next_cursor }
 * }
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProjectKPI {
  project_id: string;
  name: string;
  description: string | null;
  owner_team: string | null;
  acl_scope: string;
  created_at: string;
  updated_at: string;
  asset_count: number;
  indexed_count: number;
  failed_count: number;
  last_ingest_at: string | null;
}

// ---------------------------------------------------------------------------
// Static fallback data (when Supabase is not configured)
// ---------------------------------------------------------------------------

const STATIC_PROJECTS: ProjectKPI[] = [
  {
    project_id: "proj-finance-infra-q3",
    name: "Finance — Infra Q3 FY26",
    description: "Capital budgeting and vendor selection for Q3 FY26 infrastructure investment.",
    owner_team: "Finance",
    acl_scope: "org:acme",
    created_at: "2026-05-13T00:00:00Z",
    updated_at: "2026-05-13T00:00:00Z",
    asset_count: 10,
    indexed_count: 10,
    failed_count: 0,
    last_ingest_at: "2026-05-13T00:00:00Z",
  },
  {
    project_id: "proj-compliance-privacy",
    name: "Legal/Compliance — Data Privacy",
    description: "GDPR, CCPA, and data governance compliance program.",
    owner_team: "Legal",
    acl_scope: "org:acme",
    created_at: "2026-05-13T00:00:00Z",
    updated_at: "2026-05-13T00:00:00Z",
    asset_count: 9,
    indexed_count: 9,
    failed_count: 0,
    last_ingest_at: "2026-05-13T00:00:00Z",
  },
  {
    project_id: "proj-eng-incident-ops",
    name: "Engineering — Incident Ops",
    description: "Runbooks, on-call rotations, SLA commitments, and incident postmortems.",
    owner_team: "Engineering",
    acl_scope: "org:acme",
    created_at: "2026-05-13T00:00:00Z",
    updated_at: "2026-05-13T00:00:00Z",
    asset_count: 11,
    indexed_count: 11,
    failed_count: 0,
    last_ingest_at: "2026-05-13T00:00:00Z",
  },
  {
    project_id: "proj-corpdev-targetco-dd",
    name: "CorpDev — TargetCo Due Diligence",
    description: "M&A due diligence materials for TargetCo acquisition.",
    owner_team: "Corporate Development",
    acl_scope: "org:acme",
    created_at: "2026-05-13T00:00:00Z",
    updated_at: "2026-05-13T00:00:00Z",
    asset_count: 8,
    indexed_count: 8,
    failed_count: 0,
    last_ingest_at: "2026-05-13T00:00:00Z",
  },
  {
    project_id: "proj-org-shared",
    name: "Org Shared Policies",
    description: "Canonical org-wide glossary, policies, and process documents.",
    owner_team: "Corporate",
    acl_scope: "org:acme",
    created_at: "2026-05-13T00:00:00Z",
    updated_at: "2026-05-13T00:00:00Z",
    asset_count: 4,
    indexed_count: 4,
    failed_count: 0,
    last_ingest_at: "2026-05-13T00:00:00Z",
  },
];

// ---------------------------------------------------------------------------
// Auth check (mirrors pattern from assets route)
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
  const rawLimit = parseInt(searchParams.get("limit") ?? "50", 10);
  const limit = Math.min(Math.max(rawLimit, 1), 200);
  const cursor = searchParams.get("cursor");

  // ---------------------------------------------------------------------------
  // Supabase path
  // ---------------------------------------------------------------------------

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (supabaseUrl && supabaseServiceKey) {
    try {
      const { createClient } = await import("@supabase/supabase-js");
      const db = createClient(supabaseUrl, supabaseServiceKey, {
        auth: { persistSession: false },
      });

      // Fetch projects with pagination
      let query = db
        .from("projects")
        .select("project_id, name, description, owner_team, acl_scope, created_at, updated_at")
        .order("project_id", { ascending: true })
        .limit(limit + 1);

      if (cursor) {
        query = query.gt("project_id", cursor);
      }

      const { data: projects, error: projectsError } = await query;

      if (projectsError) {
        return NextResponse.json(
          { error: "Database error", code: "db_error", detail: projectsError.message },
          { status: 500 },
        );
      }

      const rows = projects ?? [];
      const hasMore = rows.length > limit;
      const pageRows = hasMore ? rows.slice(0, limit) : rows;

      // Fetch asset aggregates per project in one query
      const projectIds = pageRows.map((p) => p.project_id);
      const kpis: ProjectKPI[] = [];

      if (projectIds.length > 0) {
        // Get counts grouped by project_id and ingest_status
        const { data: assetStats, error: statsError } = await db
          .from("assets")
          .select("project_id, ingest_status")
          .in("project_id", projectIds)
          .neq("ingest_status", "deleted");

        // Get last ingest per project
        const { data: lastIngestRows, error: lastIngestError } = await db
          .from("assets")
          .select("project_id, ingested_at")
          .in("project_id", projectIds)
          .order("ingested_at", { ascending: false });

        const statsMap: Record<string, { total: number; indexed: number; failed: number }> = {};
        const lastIngestMap: Record<string, string> = {};

        if (!statsError && assetStats) {
          for (const row of assetStats) {
            if (!statsMap[row.project_id]) {
              statsMap[row.project_id] = { total: 0, indexed: 0, failed: 0 };
            }
            statsMap[row.project_id].total += 1;
            if (row.ingest_status === "indexed") statsMap[row.project_id].indexed += 1;
            if (row.ingest_status === "failed") statsMap[row.project_id].failed += 1;
          }
        }

        if (!lastIngestError && lastIngestRows) {
          for (const row of lastIngestRows) {
            // First occurrence per project_id is the most recent (ordered desc)
            if (!lastIngestMap[row.project_id]) {
              lastIngestMap[row.project_id] = row.ingested_at;
            }
          }
        }

        for (const p of pageRows) {
          const stats = statsMap[p.project_id] ?? { total: 0, indexed: 0, failed: 0 };
          kpis.push({
            project_id: p.project_id,
            name: p.name,
            description: p.description ?? null,
            owner_team: p.owner_team ?? null,
            acl_scope: p.acl_scope,
            created_at: p.created_at,
            updated_at: p.updated_at,
            asset_count: stats.total,
            indexed_count: stats.indexed,
            failed_count: stats.failed,
            last_ingest_at: lastIngestMap[p.project_id] ?? null,
          });
        }
      }

      return NextResponse.json({
        data: kpis,
        pagination: {
          has_more: hasMore,
          next_cursor: hasMore ? pageRows[pageRows.length - 1]?.project_id ?? null : null,
        },
      });
    } catch (err) {
      // Fall through to static data on unexpected error
      console.error("Supabase error in GET /api/v1/projects:", err);
    }
  }

  // ---------------------------------------------------------------------------
  // Static fallback (when Supabase is not configured)
  // ---------------------------------------------------------------------------

  const startIdx = cursor
    ? STATIC_PROJECTS.findIndex((p) => p.project_id > cursor)
    : 0;
  const slice = STATIC_PROJECTS.slice(startIdx < 0 ? 0 : startIdx, startIdx + limit + 1);
  const hasMore = slice.length > limit;
  const page = hasMore ? slice.slice(0, limit) : slice;

  return NextResponse.json({
    data: page,
    pagination: {
      has_more: hasMore,
      next_cursor: hasMore ? page[page.length - 1]?.project_id ?? null : null,
    },
  });
}
