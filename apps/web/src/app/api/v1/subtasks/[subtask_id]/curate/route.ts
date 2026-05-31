import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  buildCuratedBundle,
  buildCurationEvents,
  computeContentHash,
  computeTraceSignature,
  emitRunEvents,
  fallbackStore,
  SnapshotRecord,
  SubtaskPlan,
} from "../../../../../../lib/task-decomposer";
import { randomUUID } from "crypto";

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
// POST /api/v1/subtasks/[subtask_id]/curate
// ---------------------------------------------------------------------------

export async function POST(
  req: NextRequest,
  { params }: { params: { subtask_id: string } },
): Promise<NextResponse> {
  const authed = await verifyAuth(req);
  if (!authed) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { subtask_id: subtaskId } = params;
  const now = new Date().toISOString();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // ---------------------------------------------------------------------------
  // Supabase path
  // ---------------------------------------------------------------------------
  if (supabaseUrl && supabaseServiceKey) {
    try {
      const supabase = createClient(supabaseUrl, supabaseServiceKey);

      // Load subtask
      const { data: subtaskRow, error: subtaskError } = await supabase
        .from("subtasks")
        .select("*")
        .eq("subtask_id", subtaskId)
        .maybeSingle();

      if (subtaskError || !subtaskRow) {
        return NextResponse.json({ error: "Subtask not found" }, { status: 404 });
      }

      // Idempotent: return existing bundle if already curated
      if (subtaskRow.status === "curated" && subtaskRow.snapshot_id) {
        const { data: snap } = await supabase
          .from("run_snapshots")
          .select("*")
          .eq("snapshot_id", subtaskRow.snapshot_id)
          .maybeSingle();

        if (snap) {
          return NextResponse.json({
            subtask_id: subtaskId,
            task_id: subtaskRow.task_id,
            snapshot_id: subtaskRow.snapshot_id,
            ...subtaskRow.curated_bundle,
            created_at: snap.created_at,
          });
        }
      }

      const subtaskPlan: SubtaskPlan = {
        subtask_id: subtaskRow.subtask_id,
        task_id: subtaskRow.task_id,
        project_id: subtaskRow.project_id,
        position: subtaskRow.position,
        intent_label: subtaskRow.intent_label,
        description: subtaskRow.description,
        expected_evidence: subtaskRow.expected_evidence ?? [],
        store_routing: subtaskRow.store_routing ?? {},
        status: "pending",
        created_at: subtaskRow.created_at,
      };

      const bundle = buildCuratedBundle(subtaskPlan, subtaskRow.project_id);
      const snapshotId = randomUUID();
      const runId = `run-${subtaskRow.task_id}`;
      const contentHash = computeContentHash(bundle);
      // Session 16b: compute HMAC trace signature
      const traceSignature = computeTraceSignature(snapshotId, contentHash, now);

      // Build and emit run events for this curation pass
      const events = buildCurationEvents(
        runId,
        subtaskRow.task_id,
        subtaskId,
        snapshotId,
        bundle,
        subtaskRow.intent_label,
        now,
      );
      emitRunEvents(runId, events);

      // Write snapshot
      await supabase.from("run_snapshots").insert({
        snapshot_id: snapshotId,
        run_id: runId,
        org_id: "00000000-0000-0000-0000-000000000001",
        project_id: subtaskRow.project_id,
        task_id: subtaskRow.task_id,
        subtask_id: subtaskId,
        context_pack_json: bundle,
        content_hash: contentHash,
        trace_signature: traceSignature,
        escalation_info: bundle.escalation ?? null,
        run_events_snapshot: events,
        created_at: now,
      });

      // Update subtask
      await supabase
        .from("subtasks")
        .update({ status: "curated", snapshot_id: snapshotId, curated_bundle: bundle, updated_at: now })
        .eq("subtask_id", subtaskId);

      return NextResponse.json({
        subtask_id: subtaskId,
        task_id: subtaskRow.task_id,
        snapshot_id: snapshotId,
        run_id: runId,
        content_hash: contentHash,
        trace_signature: traceSignature,
        escalation: bundle.escalation ?? null,
        ...bundle,
        created_at: now,
      });
    } catch (err) {
      console.error("subtasks/curate supabase error:", err);
      // Fall through to static fallback
    }
  }

  // ---------------------------------------------------------------------------
  // Static / in-memory fallback
  // ---------------------------------------------------------------------------

  let subtaskRecord = fallbackStore.subtasks.get(subtaskId);

  // If the subtask was never registered (e.g. test creates subtask_id externally),
  // synthesise a minimal record so the endpoint can still respond
  if (!subtaskRecord) {
    const synthetic: SubtaskPlan = {
      subtask_id: subtaskId,
      task_id: `task-synthetic`,
      project_id: "proj-org-shared",
      position: 0,
      intent_label: "Context Synthesis",
      description: "Synthesise context for the requested task.",
      expected_evidence: ["wiki: Org Glossary", "org-glossary.md"],
      store_routing: { candidate_store_ids: ["proj-org-shared"], rationale: "Default fallback", max_stores: 1 },
      status: "pending",
      created_at: now,
    };
    subtaskRecord = { ...synthetic, curated_bundle: null, snapshot_id: null };
    fallbackStore.subtasks.set(subtaskId, subtaskRecord);
  }

  // Idempotent: return existing bundle
  if (subtaskRecord.snapshot_id && subtaskRecord.curated_bundle) {
    const snap = fallbackStore.snapshots.get(subtaskRecord.snapshot_id);
    return NextResponse.json({
      subtask_id: subtaskId,
      task_id: subtaskRecord.task_id,
      snapshot_id: subtaskRecord.snapshot_id,
      ...subtaskRecord.curated_bundle,
      created_at: snap?.created_at ?? now,
    });
  }

  const bundle = buildCuratedBundle(subtaskRecord, subtaskRecord.project_id);
  const snapshotId = `snap-${randomUUID()}`;
  const runId = `run-${subtaskRecord.task_id}`;
  const contentHash = computeContentHash(bundle);
  // Session 16b: compute HMAC trace signature
  const traceSignature = computeTraceSignature(snapshotId, contentHash, now);

  // Emit run events first so we can capture them in the snapshot
  const events = buildCurationEvents(
    runId,
    subtaskRecord.task_id,
    subtaskId,
    snapshotId,
    bundle,
    subtaskRecord.intent_label,
    now,
  );
  emitRunEvents(runId, events);

  const snapshotRecord: SnapshotRecord = {
    snapshot_id: snapshotId,
    run_id: runId,
    org_id: "00000000-0000-0000-0000-000000000001",
    project_id: subtaskRecord.project_id,
    task_id: subtaskRecord.task_id,
    subtask_id: subtaskId,
    context_pack_json: bundle,
    content_hash: contentHash,
    trace_signature: traceSignature,
    run_events_snapshot: events,
    created_at: now,
  };

  fallbackStore.snapshots.set(snapshotId, snapshotRecord);
  subtaskRecord.curated_bundle = bundle;
  subtaskRecord.snapshot_id = snapshotId;
  fallbackStore.subtasks.set(subtaskId, subtaskRecord);

  return NextResponse.json({
    subtask_id: subtaskId,
    task_id: subtaskRecord.task_id,
    snapshot_id: snapshotId,
    run_id: runId,
    content_hash: contentHash,
    trace_signature: traceSignature,
    escalation: bundle.escalation ?? null,
    ...bundle,
    created_at: now,
  });
}
