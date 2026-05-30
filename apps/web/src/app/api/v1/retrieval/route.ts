/**
 * POST /api/v1/retrieval — Session 10
 *
 * Task router and ranker: given task text and optional filters, returns
 * evidence items ranked by composite score (intent match + trust + freshness
 * + offline-cached semantic score).  Focuses on Level 0 and Level 1 by
 * default.  No per-query LLM calls.  No embedding models.  No vector indexes.
 *
 * Request body:
 * {
 *   task_text:         string  (required)
 *   project_id?:       string
 *   retrieval_levels?: ("level_0" | "level_1" | "level_2")[]
 *   acl_scope?:        string
 *   limit?:            number  (default 20, max 200)
 * }
 *
 * Response 200:
 * {
 *   task_text:                  string
 *   project_id:                 string | null
 *   intent_classes:             string[]
 *   total_candidates:           number
 *   items:                      RankedEvidence[]
 *   retrieval_levels_included:  string[]
 *   scores_from_cache:          boolean
 * }
 *
 * Error responses:
 *   401 — missing or invalid auth
 *   400 — invalid request body
 */

import { NextRequest, NextResponse } from "next/server";
import { rankEvidence } from "../../../../lib/retrieval-ranker";

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

async function verifyAuth(req: NextRequest): Promise<boolean> {
  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return false;
  const token = authHeader.slice(7).trim();
  if (!token) return false;

  const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnon) return true; // dev passthrough

  try {
    const { createClient } = await import("@supabase/supabase-js");
    const client = createClient(supabaseUrl, supabaseAnon);
    const { error } = await client.auth.getUser(token);
    return !error;
  } catch {
    return true; // network error → dev passthrough
  }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

const VALID_LEVELS = new Set(["level_0", "level_1", "level_2"]);

export async function POST(req: NextRequest): Promise<NextResponse> {
  const authed = await verifyAuth(req);
  if (!authed) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Bad Request", code: "invalid_json" },
      { status: 400 },
    );
  }

  const taskText = body.task_text;
  if (typeof taskText !== "string" || taskText.trim().length === 0) {
    return NextResponse.json(
      {
        error: "Bad Request",
        code: "missing_task_text",
        message: "task_text is required and must be a non-empty string",
      },
      { status: 400 },
    );
  }

  // Validate retrieval_levels if provided
  if (body.retrieval_levels !== undefined) {
    if (!Array.isArray(body.retrieval_levels)) {
      return NextResponse.json(
        {
          error: "Bad Request",
          code: "invalid_retrieval_levels",
          message: "retrieval_levels must be an array",
        },
        { status: 400 },
      );
    }
    for (const lvl of body.retrieval_levels as unknown[]) {
      if (!VALID_LEVELS.has(lvl as string)) {
        return NextResponse.json(
          {
            error: "Bad Request",
            code: "invalid_retrieval_level",
            message: `retrieval_levels contains invalid value "${lvl}". Must be level_0, level_1, or level_2.`,
          },
          { status: 400 },
        );
      }
    }
  }

  // Validate limit if provided
  const limitRaw = body.limit;
  if (limitRaw !== undefined) {
    const limit = Number(limitRaw);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      return NextResponse.json(
        {
          error: "Bad Request",
          code: "invalid_limit",
          message: "limit must be an integer between 1 and 200",
        },
        { status: 400 },
      );
    }
  }

  try {
    const result = await rankEvidence(taskText.trim(), {
      project_id:       typeof body.project_id === "string"
                          ? body.project_id : undefined,
      retrieval_levels: Array.isArray(body.retrieval_levels)
                          ? (body.retrieval_levels as string[]) : undefined,
      acl_scope:        typeof body.acl_scope === "string"
                          ? body.acl_scope : undefined,
      limit:            typeof body.limit === "number"
                          ? body.limit : undefined,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    console.error("[retrieval] rankEvidence error:", err);
    return NextResponse.json(
      { error: "Internal Server Error", code: "retrieval_failed" },
      { status: 500 },
    );
  }
}
