/**
 * GET /api/v1/evidence/[evidence_id] — Session 9
 *
 * Retrieve a single evidence item with full lineage resolution.
 * Returns EvidenceItemResolved: the evidence metadata PLUS the resolved
 * backing asset object, backing wiki_page object, and contributing_assets.
 *
 * Response 200:
 * {
 *   ...EvidenceItem,
 *   lineage_resolved: {
 *     asset:                Asset | null,
 *     wiki_page:            WikiPage | null,
 *     contributing_assets:  Asset[]
 *   }
 * }
 *
 * Response 404 if evidence_id does not exist.
 *
 * Error responses:
 *   401 — missing or invalid auth
 *   404 — evidence item not found
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { resolveEvidence } from "../../../../../lib/evidence-resolver";

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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ evidence_id: string }> },
) {
  const auth = await verifyAuth(request);
  if (!auth.ok) return auth.response;

  const { evidence_id } = await params;

  if (!evidence_id) {
    return NextResponse.json(
      { error: "Bad Request", code: "missing_evidence_id" },
      { status: 400 },
    );
  }

  const item = await resolveEvidence(evidence_id);

  if (!item) {
    return NextResponse.json(
      { error: "Not Found", code: "evidence_not_found", evidence_id },
      { status: 404 },
    );
  }

  return NextResponse.json(item, { status: 200 });
}
