/**
 * GET /api/v1/wiki/pages — Session 8
 *
 * List wiki pages with optional type and slug-prefix filters.
 * Used by the LLM Wiki Explorer read-only view.
 *
 * Query parameters:
 *   page_type   string  — filter by wiki_page_type enum value
 *   slug_prefix string  — filter pages whose slug starts with this prefix
 *   limit       int     — max results (default 50, max 200)
 *   cursor      string  — opaque pagination cursor (page_id of last seen row)
 *
 * Response 200:
 * {
 *   data: WikiPageSummary[],
 *   pagination: { has_more, next_cursor }
 * }
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WikiPageSummary {
  page_id: string;
  slug: string;
  title: string;
  page_type: string;
  acl_scope: string;
  source_asset_ids: string[];
  created_at: string;
  updated_at: string;
  shaping_job_id: string | null;
  /** Cross-reference counts resolved by a join. */
  inbound_ref_count: number;
  outbound_ref_count: number;
}

// ---------------------------------------------------------------------------
// Static fallback wiki pages (mirrors the Session 2b seed migration)
// ---------------------------------------------------------------------------

const STATIC_WIKI_PAGES: WikiPageSummary[] = [
  {
    page_id: "00000000-0000-0000-0000-000000000001",
    slug: "root/index",
    title: "Root Index",
    page_type: "index",
    acl_scope: "org:demo",
    source_asset_ids: [],
    created_at: "2026-05-13T00:00:00Z",
    updated_at: "2026-05-13T00:00:00Z",
    shaping_job_id: null,
    inbound_ref_count: 0,
    outbound_ref_count: 0,
  },
  {
    page_id: "00000000-0000-0000-0000-000000000002",
    slug: "root/log",
    title: "Org Memory Activity Log",
    page_type: "log",
    acl_scope: "org:demo",
    source_asset_ids: [],
    created_at: "2026-05-13T00:00:00Z",
    updated_at: "2026-05-13T00:00:00Z",
    shaping_job_id: null,
    inbound_ref_count: 0,
    outbound_ref_count: 0,
  },
  {
    page_id: "00000000-0000-0000-0000-000000000003",
    slug: "example/shared/example-summary",
    title: "Summary: Example Document",
    page_type: "summary",
    acl_scope: "org:demo",
    source_asset_ids: [],
    created_at: "2026-05-13T00:00:00Z",
    updated_at: "2026-05-13T00:00:00Z",
    shaping_job_id: null,
    inbound_ref_count: 0,
    outbound_ref_count: 0,
  },
  {
    page_id: "00000000-0000-0000-0000-000000000004",
    slug: "example/shared/example-entity",
    title: "Entity: Example Team",
    page_type: "entity",
    acl_scope: "org:demo",
    source_asset_ids: [],
    created_at: "2026-05-13T00:00:00Z",
    updated_at: "2026-05-13T00:00:00Z",
    shaping_job_id: null,
    inbound_ref_count: 0,
    outbound_ref_count: 0,
  },
  {
    page_id: "00000000-0000-0000-0000-000000000005",
    slug: "example/shared/example-concept",
    title: "Concept: Example Concept",
    page_type: "concept",
    acl_scope: "org:demo",
    source_asset_ids: [],
    created_at: "2026-05-13T00:00:00Z",
    updated_at: "2026-05-13T00:00:00Z",
    shaping_job_id: null,
    inbound_ref_count: 0,
    outbound_ref_count: 0,
  },
  {
    page_id: "00000000-0000-0000-0000-000000000006",
    slug: "example/shared/example-comparison",
    title: "Comparison: Example vs Baseline",
    page_type: "comparison",
    acl_scope: "org:demo",
    source_asset_ids: [],
    created_at: "2026-05-13T00:00:00Z",
    updated_at: "2026-05-13T00:00:00Z",
    shaping_job_id: null,
    inbound_ref_count: 0,
    outbound_ref_count: 0,
  },
  {
    page_id: "00000000-0000-0000-0000-000000000007",
    slug: "example/shared/example-synthesis",
    title: "Synthesis: Example Cross-Asset Insight",
    page_type: "synthesis",
    acl_scope: "org:demo",
    source_asset_ids: [],
    created_at: "2026-05-13T00:00:00Z",
    updated_at: "2026-05-13T00:00:00Z",
    shaping_job_id: null,
    inbound_ref_count: 0,
    outbound_ref_count: 0,
  },
];

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
  const pageType = searchParams.get("page_type");
  const slugPrefix = searchParams.get("slug_prefix");
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

      let query = db
        .from("wiki_pages")
        .select(
          "page_id, slug, title, page_type, acl_scope, source_asset_ids, created_at, updated_at, shaping_job_id",
        )
        .order("slug", { ascending: true })
        .limit(limit + 1);

      if (pageType) query = query.eq("page_type", pageType);
      if (slugPrefix) query = query.like("slug", `${slugPrefix}%`);
      if (cursor) query = query.gt("slug", cursor);

      const { data: pages, error: pagesError } = await query;

      if (pagesError) {
        return NextResponse.json(
          { error: "Database error", code: "db_error", detail: pagesError.message },
          { status: 500 },
        );
      }

      const rows = pages ?? [];
      const hasMore = rows.length > limit;
      const pageRows = hasMore ? rows.slice(0, limit) : rows;

      // Fetch cross-reference counts for the returned pages
      const pageIds = pageRows.map((p) => p.page_id);
      const countMap: Record<string, { inbound: number; outbound: number }> = {};

      if (pageIds.length > 0) {
        const { data: outboundRefs } = await db
          .from("wiki_cross_references")
          .select("from_page_id")
          .in("from_page_id", pageIds);

        const { data: inboundRefs } = await db
          .from("wiki_cross_references")
          .select("to_page_id")
          .in("to_page_id", pageIds);

        for (const ref of outboundRefs ?? []) {
          if (!countMap[ref.from_page_id]) countMap[ref.from_page_id] = { inbound: 0, outbound: 0 };
          countMap[ref.from_page_id].outbound += 1;
        }
        for (const ref of inboundRefs ?? []) {
          if (!countMap[ref.to_page_id]) countMap[ref.to_page_id] = { inbound: 0, outbound: 0 };
          countMap[ref.to_page_id].inbound += 1;
        }
      }

      const result: WikiPageSummary[] = pageRows.map((p) => ({
        page_id: p.page_id,
        slug: p.slug,
        title: p.title,
        page_type: p.page_type,
        acl_scope: p.acl_scope,
        source_asset_ids: p.source_asset_ids ?? [],
        created_at: p.created_at,
        updated_at: p.updated_at,
        shaping_job_id: p.shaping_job_id ?? null,
        inbound_ref_count: countMap[p.page_id]?.inbound ?? 0,
        outbound_ref_count: countMap[p.page_id]?.outbound ?? 0,
      }));

      return NextResponse.json({
        data: result,
        pagination: {
          has_more: hasMore,
          next_cursor: hasMore ? pageRows[pageRows.length - 1]?.slug ?? null : null,
        },
      });
    } catch (err) {
      console.error("Supabase error in GET /api/v1/wiki/pages:", err);
    }
  }

  // ---------------------------------------------------------------------------
  // Static fallback
  // ---------------------------------------------------------------------------

  let filtered = [...STATIC_WIKI_PAGES];
  if (pageType) filtered = filtered.filter((p) => p.page_type === pageType);
  if (slugPrefix) filtered = filtered.filter((p) => p.slug.startsWith(slugPrefix));
  if (cursor) filtered = filtered.filter((p) => p.slug > cursor);

  const hasMore = filtered.length > limit;
  const page = hasMore ? filtered.slice(0, limit) : filtered;

  return NextResponse.json({
    data: page,
    pagination: {
      has_more: hasMore,
      next_cursor: hasMore ? page[page.length - 1]?.slug ?? null : null,
    },
  });
}
