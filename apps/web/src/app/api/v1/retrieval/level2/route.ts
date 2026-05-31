/**
 * POST /api/v1/retrieval/level2 — Session 11
 *
 * Level 2 specific-file picker: given task text and an optional project
 * scope, returns a curated set of specific Level 2 files with forced
 * inclusions (from specificity rules) and scored candidates.
 *
 * No per-query LLM calls. No embedding models. Deterministic output.
 *
 * Request body:
 * {
 *   task_text:               string   (required)
 *   project_id?:             string
 *   acl_scope?:              string
 *   limit?:                  number   (default 10, max 50)
 *   candidate_evidence_ids?: string[] (pre-filter to these evidence IDs)
 * }
 *
 * Response 200:
 * {
 *   task_text:                  string
 *   project_id:                 string | null
 *   intent_classes:             string[]
 *   specificity_enforced:       boolean
 *   forced_inclusions:          PickedFile[]
 *   missing_required_patterns:  string[]
 *   selected:                   PickedFile[]
 *   dropped:                    DroppedFile[]
 *   total_candidates:           number
 * }
 *
 * Error responses:
 *   401 — missing or invalid auth
 *   400 — invalid request body
 *   500 — picker error
 */

import { NextRequest, NextResponse } from "next/server";
import { pickSpecificFiles } from "../../../../../lib/specific-file-picker";

// ---------------------------------------------------------------------------
// Auth helper (identical to other v1 routes)
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

  if (body.limit !== undefined) {
    const limit = Number(body.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      return NextResponse.json(
        {
          error: "Bad Request",
          code: "invalid_limit",
          message: "limit must be an integer between 1 and 50",
        },
        { status: 400 },
      );
    }
  }

  if (
    body.candidate_evidence_ids !== undefined &&
    !Array.isArray(body.candidate_evidence_ids)
  ) {
    return NextResponse.json(
      {
        error: "Bad Request",
        code: "invalid_candidate_evidence_ids",
        message: "candidate_evidence_ids must be an array of strings",
      },
      { status: 400 },
    );
  }

  try {
    const result = await pickSpecificFiles(taskText.trim(), {
      project_id:
        typeof body.project_id === "string" ? body.project_id : undefined,
      acl_scope:
        typeof body.acl_scope === "string" ? body.acl_scope : undefined,
      limit: typeof body.limit === "number" ? body.limit : undefined,
      candidate_evidence_ids: Array.isArray(body.candidate_evidence_ids)
        ? (body.candidate_evidence_ids as string[])
        : undefined,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    console.error("[level2] pickSpecificFiles error:", err);
    return NextResponse.json(
      { error: "Internal Server Error", code: "picker_error" },
      { status: 500 },
    );
  }
}
