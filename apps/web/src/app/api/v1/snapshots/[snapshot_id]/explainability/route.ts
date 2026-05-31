/**
 * GET /api/v1/snapshots/[snapshot_id]/explainability — Session 14
 *
 * Returns the full explainability data for a snapshot:
 *   - selected items with per-item rationale cards (inclusion reason, retrieval
 *     level, score, provenance)
 *   - top excluded (dropped) items with reason codes
 *   - run event stream ordered by occurred_at
 *
 * Response 200:
 * {
 *   snapshot_id:     string
 *   run_id:          string
 *   task_id:         string
 *   subtask_id:      string
 *   project_id:      string
 *   created_at:      string
 *   selected_items:  ExplainedItem[]
 *   dropped_items:   ExplainedDroppedItem[]
 *   run_events:      RunEvent[]
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
  getEventsBySnapshotId,
  getRunEvents,
  type RunEvent,
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
// Types
// ---------------------------------------------------------------------------

export interface ExplainedItem {
  item_id: string;
  type: string;
  title: string;
  source_ref: string | null;
  inclusion_reason: string;
  retrieval_level: string | null;
  score: number | null;
  token_estimate: number;
  provenance: {
    source_ref: string | null;
    retrieval_level: string | null;
    score: number | null;
    selected_at: string | null;
  };
}

export interface ExplainedDroppedItem {
  item_id: string;
  type: string;
  title: string;
  exclusion_reason: string;
  reason_code: string;
}

export interface ExplainabilityResponse {
  snapshot_id: string;
  run_id: string;
  task_id: string;
  subtask_id: string;
  project_id: string;
  created_at: string;
  /** SHA-256 hex of context_pack_json — Session 16 immutability field */
  content_hash: string | null;
  /** Session 16b: HMAC-SHA256 trace signature for tamper-evident verification */
  trace_signature: string | null;
  /** Session 16b: restricted-best-match escalation info */
  escalation_info: Record<string, unknown> | null;
  selected_items: ExplainedItem[];
  dropped_items: ExplainedDroppedItem[];
  run_events: RunEvent[];
}

// ---------------------------------------------------------------------------
// GET /api/v1/snapshots/[snapshot_id]/explainability
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

      const pack = data.context_pack_json ?? {};
      const rationaleTrace: { item_id: string; retrieval_level: string; score: number }[] =
        pack.rationale_trace ?? [];

      const selectedItems: ExplainedItem[] = (pack.selected_items ?? []).map(
        (item: {
          item_id: string;
          type: string;
          title: string;
          source_ref?: string;
          inclusion_reason: string;
          token_estimate: number;
        }) => {
          const trace = rationaleTrace.find((r) => r.item_id === item.item_id);
          return {
            item_id: item.item_id,
            type: item.type,
            title: item.title,
            source_ref: item.source_ref ?? null,
            inclusion_reason: item.inclusion_reason,
            retrieval_level: trace?.retrieval_level ?? null,
            score: trace?.score ?? null,
            token_estimate: item.token_estimate,
            provenance: {
              source_ref: item.source_ref ?? null,
              retrieval_level: trace?.retrieval_level ?? null,
              score: trace?.score ?? null,
              selected_at: data.created_at,
            },
          };
        },
      );

      const droppedItems: ExplainedDroppedItem[] = (pack.dropped_items ?? []).map(
        (item: { item_id: string; type: string; title: string; exclusion_reason: string }) => ({
          item_id: item.item_id,
          type: item.type,
          title: item.title,
          exclusion_reason: item.exclusion_reason,
          reason_code: deriveReasonCode(item.exclusion_reason),
        }),
      );

      // Retrieve run events from fallback store (Supabase run events table is v2)
      const runEvents: RunEvent[] = [
        ...getEventsBySnapshotId(snapshotId),
        ...getRunEvents(data.run_id),
      ].filter((ev) => ev.snapshot_id === snapshotId || ev.run_id === data.run_id);
      const deduped = deduplicateEvents(runEvents);

      const response: ExplainabilityResponse = {
        snapshot_id: snapshotId,
        run_id: data.run_id,
        task_id: data.task_id,
        subtask_id: data.subtask_id ?? "",
        project_id: data.project_id,
        created_at: data.created_at,
        content_hash: data.content_hash ?? null,
        trace_signature: data.trace_signature ?? null,
        escalation_info: data.escalation_info ?? (pack.escalation ?? null),
        selected_items: selectedItems,
        dropped_items: droppedItems,
        run_events: deduped,
      };

      return NextResponse.json(response);
    } catch (err) {
      console.error("snapshots/explainability supabase error:", err);
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

  const pack = snap.context_pack_json;
  const rationaleTrace = pack.rationale_trace ?? [];

  const selectedItems: ExplainedItem[] = pack.selected_items.map((item) => {
    const trace = rationaleTrace.find((r) => r.item_id === item.item_id);
    return {
      item_id: item.item_id,
      type: item.type,
      title: item.title,
      source_ref: item.source_ref ?? null,
      inclusion_reason: item.inclusion_reason,
      retrieval_level: trace?.retrieval_level ?? null,
      score: trace?.score ?? null,
      token_estimate: item.token_estimate,
      provenance: {
        source_ref: item.source_ref ?? null,
        retrieval_level: trace?.retrieval_level ?? null,
        score: trace?.score ?? null,
        selected_at: snap.created_at,
      },
    };
  });

  const droppedItems: ExplainedDroppedItem[] = pack.dropped_items.map((item) => ({
    item_id: item.item_id,
    type: item.type,
    title: item.title,
    exclusion_reason: item.exclusion_reason,
    reason_code: deriveReasonCode(item.exclusion_reason),
  }));

  // Collect all run events for this snapshot's run_id
  const allRunEvents = getRunEvents(snap.run_id);
  const snapEvents = getEventsBySnapshotId(snapshotId);
  const deduped = deduplicateEvents([...allRunEvents, ...snapEvents]);

  const response: ExplainabilityResponse = {
    snapshot_id: snapshotId,
    run_id: snap.run_id,
    task_id: snap.task_id,
    subtask_id: snap.subtask_id,
    project_id: snap.project_id,
    created_at: snap.created_at,
    content_hash: snap.content_hash ?? null,
    trace_signature: snap.trace_signature ?? null,
    escalation_info: (pack.escalation as Record<string, unknown> | null | undefined) ?? null,
    selected_items: selectedItems,
    dropped_items: droppedItems,
    run_events: deduped,
  };

  return NextResponse.json(response);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deriveReasonCode(exclusionReason: string): string {
  const lower = exclusionReason.toLowerCase();
  if (lower.includes("threshold") || lower.includes("score")) return "below_threshold";
  if (lower.includes("freshness") || lower.includes("stale") || lower.includes("updated"))
    return "low_freshness";
  if (lower.includes("duplicate") || lower.includes("overlap")) return "duplicate";
  if (lower.includes("acl") || lower.includes("access") || lower.includes("permission"))
    return "acl_restricted";
  if (lower.includes("budget") || lower.includes("token")) return "budget_exceeded";
  return "filtered_out";
}

function deduplicateEvents(events: RunEvent[]): RunEvent[] {
  const seen = new Set<string>();
  const result: RunEvent[] = [];
  for (const ev of events) {
    if (!seen.has(ev.event_id)) {
      seen.add(ev.event_id);
      result.push(ev);
    }
  }
  return result.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
}
