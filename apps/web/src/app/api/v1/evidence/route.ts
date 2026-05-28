/**
 * GET /api/v1/evidence — Session 9
 *
 * List unified evidence items (assets and wiki pages) with optional filters.
 * Returns items from the evidence_items table with full resolution metadata.
 *
 * Query parameters:
 *   project_id       string  — filter by project (recommended)
 *   retrieval_level  string  — "level_0" | "level_1" | "level_2"
 *   evidence_type    string  — "asset" | "wiki_page" | "hybrid"
 *   acl_scope        string  — filter by ACL scope
 *   limit            int     — max results (default 50, max 200)
 *   cursor           string  — pagination cursor (evidence_id of last seen row)
 *
 * Response 200:
 * {
 *   data: EvidenceItem[],
 *   pagination: { has_more, next_cursor, total_count }
 * }
 *
 * Each EvidenceItem resolves to wiki_page_slug and/or file_path_or_url with
 * full hierarchy_path, lineage_chain, trust_score, and acl_scope.
 *
 * Error responses:
 *   401 — missing or invalid auth
 *   400 — invalid parameter values
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { listEvidence } from "../../../../lib/evidence-resolver";
import type { RetrievalLevel } from "../../../../lib/evidence-resolver";

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
      // Supabase unreachable — allow through in dev
    }
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

const VALID_RETRIEVAL_LEVELS = new Set(["level_0", "level_1", "level_2"]);
const VALID_EVIDENCE_TYPES = new Set(["asset", "wiki_page", "hybrid"]);

export async function GET(request: NextRequest) {
  const auth = await verifyAuth(request);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);

  // Validate retrieval_level
  const retrieval_level_raw = searchParams.get("retrieval_level");
  if (retrieval_level_raw && !VALID_RETRIEVAL_LEVELS.has(retrieval_level_raw)) {
    return NextResponse.json(
      {
        error: "Bad Request",
        code: "invalid_retrieval_level",
        message: `retrieval_level must be one of: level_0, level_1, level_2`,
      },
      { status: 400 },
    );
  }

  // Validate evidence_type
  const evidence_type_raw = searchParams.get("evidence_type");
  if (evidence_type_raw && !VALID_EVIDENCE_TYPES.has(evidence_type_raw)) {
    return NextResponse.json(
      {
        error: "Bad Request",
        code: "invalid_evidence_type",
        message: `evidence_type must be one of: asset, wiki_page, hybrid`,
      },
      { status: 400 },
    );
  }

  // Validate limit
  const limitRaw = searchParams.get("limit");
  const limit = limitRaw ? parseInt(limitRaw, 10) : 50;
  if (isNaN(limit) || limit < 1 || limit > 200) {
    return NextResponse.json(
      {
        error: "Bad Request",
        code: "invalid_limit",
        message: "limit must be between 1 and 200",
      },
      { status: 400 },
    );
  }

  const result = await listEvidence({
    project_id: searchParams.get("project_id") ?? undefined,
    org_id: searchParams.get("org_id") ?? undefined,
    retrieval_level: (retrieval_level_raw as RetrievalLevel) ?? undefined,
    acl_scope: searchParams.get("acl_scope") ?? undefined,
    evidence_type:
      (evidence_type_raw as "asset" | "wiki_page" | "hybrid") ?? undefined,
    limit,
    cursor: searchParams.get("cursor") ?? undefined,
  });

  return NextResponse.json(result, { status: 200 });
}
