/**
 * POST /api/v1/promotions — Session 10
 *
 * Promotion gate endpoint: promotes a memory-derived output into a canonical
 * wiki page with provenance validation and ACL checks.
 *
 * Request body:
 * {
 *   memory_version_id: string  (required)
 *   asset_id:          string  (required — UUID)
 *   project_id:        string  (required)
 *   content_md:        string  (required — markdown content for the wiki page)
 *   title:             string  (required)
 *   page_type:         "summary" | "entity" | "concept" | "comparison" | "synthesis"
 *   acl_scope:         string  (required)
 *   triggered_by?:     string  (default "operator")
 *   run_id?:           string  (UUID — for event correlation)
 *   slug?:             string  (optional explicit slug)
 * }
 *
 * Response 201:
 * {
 *   promotion_id:      string
 *   wiki_page_id:      string
 *   wiki_page_slug:    string
 *   asset_id:          string
 *   memory_version_id: string
 *   project_id:        string
 *   status:            "accepted"
 *   promoted_at:       string (ISO timestamp)
 *   audit_entry: {
 *     memory_version_id: string
 *     asset_id:          string
 *     wiki_page_id:      string
 *   }
 * }
 *
 * Error responses:
 *   400 — missing/invalid fields
 *   401 — missing or invalid auth
 *   403 — ACL mismatch
 *   404 — asset not found or provenance mismatch
 */

import { NextRequest, NextResponse } from "next/server";
import { promoteMemoryOutput } from "../../../../lib/promotion-gate";

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

async function verifyAuth(req: NextRequest): Promise<{
  ok: boolean;
  callerAclScope?: string;
}> {
  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return { ok: false };
  const token = authHeader.slice(7).trim();
  if (!token) return { ok: false };

  const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnon) {
    return { ok: true }; // dev passthrough
  }

  try {
    const { createClient } = await import("@supabase/supabase-js");
    const client = createClient(supabaseUrl, supabaseAnon);
    const { data, error } = await client.auth.getUser(token);
    if (error || !data.user) return { ok: false };
    // In prototype mode ACL scope is derived from the user's metadata or
    // defaults to "org:acme" (the dev org).
    const callerAclScope =
      (data.user.user_metadata?.acl_scope as string | undefined) ?? "org:acme";
    return { ok: true, callerAclScope };
  } catch {
    return { ok: true }; // network error → dev passthrough
  }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

const VALID_PAGE_TYPES = new Set([
  "summary", "entity", "concept", "comparison", "synthesis",
]);

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { ok, callerAclScope } = await verifyAuth(req);
  if (!ok) {
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

  // Required field validation
  const required = [
    "memory_version_id",
    "asset_id",
    "project_id",
    "content_md",
    "title",
    "page_type",
    "acl_scope",
  ] as const;

  for (const field of required) {
    if (!body[field] || typeof body[field] !== "string") {
      return NextResponse.json(
        {
          error: "Bad Request",
          code: "missing_required_field",
          message: `${field} is required and must be a non-empty string`,
        },
        { status: 400 },
      );
    }
  }

  if (!VALID_PAGE_TYPES.has(body.page_type as string)) {
    return NextResponse.json(
      {
        error: "Bad Request",
        code: "invalid_page_type",
        message: `page_type must be one of: ${[...VALID_PAGE_TYPES].join(", ")}`,
      },
      { status: 400 },
    );
  }

  try {
    const result = await promoteMemoryOutput({
      memory_version_id: body.memory_version_id as string,
      asset_id:          body.asset_id as string,
      project_id:        body.project_id as string,
      content_md:        body.content_md as string,
      title:             body.title as string,
      page_type:         body.page_type as "summary" | "entity" | "concept" | "comparison" | "synthesis",
      acl_scope:         body.acl_scope as string,
      caller_acl_scope:  callerAclScope,
      triggered_by:      typeof body.triggered_by === "string"
                           ? body.triggered_by : "operator",
      run_id:            typeof body.run_id === "string"
                           ? body.run_id : undefined,
      slug:              typeof body.slug === "string"
                           ? body.slug : undefined,
    });

    if ("error" in result) {
      const status =
        result.error.code === "asset_not_found" ||
        result.error.code === "provenance_mismatch"
          ? 404
          : result.error.code === "acl_forbidden"
          ? 403
          : 422;
      return NextResponse.json(
        { error: result.error.message, code: result.error.code },
        { status },
      );
    }

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    console.error("[promotions] error:", err);
    return NextResponse.json(
      { error: "Internal Server Error", code: "promotion_failed" },
      { status: 500 },
    );
  }
}
