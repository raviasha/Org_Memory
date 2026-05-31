import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { fallbackStore, getEventsBySnapshotId } from "../../../../../lib/task-decomposer";

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
// GET /api/v1/snapshots/[snapshot_id]
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
        .select("*")
        .eq("snapshot_id", snapshotId)
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        return NextResponse.json({ error: "Snapshot not found" }, { status: 404 });
      }

      return NextResponse.json({
        snapshot_id: data.snapshot_id,
        run_id: data.run_id,
        org_id: data.org_id,
        project_id: data.project_id,
        task_id: data.task_id,
        subtask_id: data.subtask_id ?? null,
        context_pack_json: data.context_pack_json,
        content_hash: data.content_hash ?? null,
        /** Session 16b: HMAC trace signature */
        trace_signature: data.trace_signature ?? null,
        /** Session 16b: restricted-best-match escalation info */
        escalation_info: data.escalation_info ?? null,
        run_events_snapshot: data.run_events_snapshot ?? [],
        created_at: data.created_at,
      });
    } catch (err) {
      console.error("snapshots/[snapshot_id] supabase error:", err);
      // Fall through to static fallback
    }
  }

  // ---------------------------------------------------------------------------
  // Static / in-memory fallback
  // ---------------------------------------------------------------------------
  const snap = fallbackStore.snapshots.get(snapshotId);

  if (!snap) {
    return NextResponse.json({ error: "Snapshot not found" }, { status: 404 });
  }

  return NextResponse.json({
    snapshot_id: snap.snapshot_id,
    run_id: snap.run_id,
    org_id: snap.org_id,
    project_id: snap.project_id,
    task_id: snap.task_id,
    subtask_id: snap.subtask_id,
    context_pack_json: snap.context_pack_json,
    content_hash: snap.content_hash,
    /** Session 16b: HMAC trace signature */
    trace_signature: snap.trace_signature ?? null,
    /** Session 16b: restricted-best-match escalation info */
    escalation_info: snap.context_pack_json?.escalation ?? null,
    run_events_snapshot: snap.run_events_snapshot?.length
      ? snap.run_events_snapshot
      : getEventsBySnapshotId(snapshotId),
    created_at: snap.created_at,
  });
}
