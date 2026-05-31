/**
 * GET /api/v1/snapshots/[snapshot_id]/verify — Session 16b
 *
 * Verifies the HMAC-SHA256 trace signature of a snapshot.
 * This provides a tamper-evident replay path: callers can confirm that the
 * snapshot content has not been altered since it was first committed.
 *
 * The signature is computed as:
 *   HMAC-SHA256(SNAPSHOT_SIGNING_KEY, `${snapshot_id}:${content_hash}:${created_at}`)
 *
 * Response 200 (valid signature):
 * {
 *   valid:           true
 *   snapshot_id:     string
 *   content_hash:    string
 *   trace_signature: string
 *   verified_at:     string   (ISO timestamp of this verification call)
 * }
 *
 * Response 200 (invalid signature or missing fields):
 * {
 *   valid:           false
 *   snapshot_id:     string
 *   error:           string   (machine-readable reason code)
 *   verified_at:     string
 * }
 *
 * Error responses:
 *   401 — missing or invalid auth
 *   404 — snapshot not found
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  fallbackStore,
  verifyTraceSignature,
} from "../../../../../../lib/task-decomposer";

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

async function verifyAuth(req: NextRequest): Promise<boolean> {
  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return false;
  const token = authHeader.slice(7).trim();
  if (!token) return false;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) return true;

  try {
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const { error } = await supabase.auth.getUser(token);
    return !error;
  } catch {
    return true;
  }
}

// ---------------------------------------------------------------------------
// GET /api/v1/snapshots/[snapshot_id]/verify
// ---------------------------------------------------------------------------

export async function GET(
  req: NextRequest,
  { params }: { params: { snapshot_id: string } },
): Promise<NextResponse> {
  const authed = await verifyAuth(req);
  if (!authed) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { snapshot_id: snapshotId } = params;
  const verifiedAt = new Date().toISOString();

  // ---------------------------------------------------------------------------
  // Supabase path
  // ---------------------------------------------------------------------------
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (supabaseUrl && supabaseServiceKey) {
    try {
      const supabase = createClient(supabaseUrl, supabaseServiceKey);

      const { data, error } = await supabase
        .from("run_snapshots")
        .select("snapshot_id, content_hash, trace_signature, created_at")
        .eq("snapshot_id", snapshotId)
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        return NextResponse.json({ error: "Snapshot not found" }, { status: 404 });
      }

      return buildVerifyResponse(
        data.snapshot_id,
        data.content_hash ?? null,
        data.trace_signature ?? null,
        data.created_at,
        verifiedAt,
      );
    } catch (err) {
      console.error("snapshots/verify supabase error:", err);
      // Fall through to in-memory fallback
    }
  }

  // ---------------------------------------------------------------------------
  // In-memory fallback
  // ---------------------------------------------------------------------------
  const snap = fallbackStore.snapshots.get(snapshotId);

  if (!snap) {
    return NextResponse.json({ error: "Snapshot not found" }, { status: 404 });
  }

  return buildVerifyResponse(
    snap.snapshot_id,
    snap.content_hash,
    snap.trace_signature ?? null,
    snap.created_at,
    verifiedAt,
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildVerifyResponse(
  snapshotId: string,
  contentHash: string | null,
  traceSignature: string | null,
  createdAt: string,
  verifiedAt: string,
): NextResponse {
  if (!contentHash) {
    return NextResponse.json({
      valid: false,
      snapshot_id: snapshotId,
      error: "missing_content_hash",
      verified_at: verifiedAt,
    });
  }

  if (!traceSignature) {
    return NextResponse.json({
      valid: false,
      snapshot_id: snapshotId,
      error: "missing_trace_signature",
      verified_at: verifiedAt,
    });
  }

  const valid = verifyTraceSignature(snapshotId, contentHash, createdAt, traceSignature);

  if (valid) {
    return NextResponse.json({
      valid: true,
      snapshot_id: snapshotId,
      content_hash: contentHash,
      trace_signature: traceSignature,
      verified_at: verifiedAt,
    });
  } else {
    return NextResponse.json({
      valid: false,
      snapshot_id: snapshotId,
      error: "signature_mismatch",
      verified_at: verifiedAt,
    });
  }
}
