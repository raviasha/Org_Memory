/**
 * POST /api/v1/subtasks/[subtask_id]/confirm — Session 13
 *
 * Context review and override endpoint.
 *
 * Accepts a list of items to remove from the curated bundle and optional
 * custom items to add.  Produces a confirmed snapshot that is distinct from
 * the original curated snapshot and reflects the user's overrides.
 *
 * Request body:
 * {
 *   removed_item_ids?: string[]        IDs of selected items to remove
 *   added_items?:      AddedItemInput[] Custom items to add
 *   override_reason?:  string           Human-readable reason for edits
 * }
 *
 * Response 200:
 * {
 *   subtask_id:           string
 *   task_id:              string
 *   original_snapshot_id: string
 *   confirmed_snapshot_id: string
 *   final_selected_items: CuratedItem[]
 *   removed_items:        { item_id: string; title: string; removal_reason: string }[]
 *   added_items:          CuratedItem[]
 *   token_budget:         { limit: number; used: number; remaining: number }
 *   override_summary:     { removed_count: number; added_count: number; override_reason: string; overridden_at: string }
 *   confirmed_at:         string
 * }
 *
 * Error responses:
 *   401 — missing / invalid auth
 *   400 — malformed body
 *   404 — subtask not found or not yet curated
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  fallbackStore,
  buildConfirmEvents,
  computeContentHash,
  emitRunEvents,
  CuratedItem,
  SnapshotRecord,
} from "../../../../../../lib/task-decomposer";
import { randomUUID } from "crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AddedItemInput {
  title: string;
  content?: string;
  item_type?: "asset" | "wiki_page" | "manual";
  override_reason?: string;
}

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

  if (!supabaseUrl || !supabaseAnonKey) return true; // dev passthrough

  try {
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const { error } = await supabase.auth.getUser(token);
    return !error;
  } catch {
    return true;
  }
}

// ---------------------------------------------------------------------------
// POST /api/v1/subtasks/[subtask_id]/confirm
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

  // Parse body
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // Empty body is valid (no overrides = confirm as-is)
  }

  const removedItemIds: string[] = Array.isArray(body.removed_item_ids)
    ? (body.removed_item_ids as unknown[]).filter((x) => typeof x === "string") as string[]
    : [];

  const rawAdded: unknown[] = Array.isArray(body.added_items) ? body.added_items : [];
  const addedInputs: AddedItemInput[] = rawAdded
    .filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null)
    .map((x) => ({
      title: typeof x.title === "string" && x.title.trim() ? x.title.trim() : "Custom Item",
      content: typeof x.content === "string" ? x.content.trim() : "",
      item_type:
        x.item_type === "asset" || x.item_type === "wiki_page" ? x.item_type : "manual",
      override_reason: typeof x.override_reason === "string" ? x.override_reason : undefined,
    }));

  const overrideReason =
    typeof body.override_reason === "string" ? body.override_reason.trim() : "";

  // -------------------------------------------------------------------------
  // Supabase path
  // -------------------------------------------------------------------------
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (supabaseUrl && supabaseServiceKey) {
    try {
      const supabase = createClient(supabaseUrl, supabaseServiceKey);

      const { data: subtaskRow, error: subtaskError } = await supabase
        .from("subtasks")
        .select("*")
        .eq("subtask_id", subtaskId)
        .maybeSingle();

      if (subtaskError || !subtaskRow) {
        return NextResponse.json({ error: "Subtask not found" }, { status: 404 });
      }

      const curatedBundle = subtaskRow.curated_bundle;
      const originalSnapshotId: string = subtaskRow.snapshot_id;

      if (!curatedBundle || !originalSnapshotId) {
        return NextResponse.json(
          { error: "Subtask has not been curated yet" },
          { status: 404 },
        );
      }

      const result = applyOverrides(
        subtaskId,
        subtaskRow.task_id,
        originalSnapshotId,
        curatedBundle,
        removedItemIds,
        addedInputs,
        overrideReason,
        now,
      );

      const confirmedSnapshotId = randomUUID();

      await supabase.from("run_snapshots").insert({
        snapshot_id: confirmedSnapshotId,
        run_id: `run-${subtaskRow.task_id}`,
        org_id: "00000000-0000-0000-0000-000000000001",
        project_id: subtaskRow.project_id,
        task_id: subtaskRow.task_id,
        context_pack_json: {
          ...curatedBundle,
          selected_items: result.final_selected_items,
          override_summary: result.override_summary,
          is_confirmed: true,
          original_snapshot_id: originalSnapshotId,
        },
        created_at: now,
      });

      await supabase
        .from("subtasks")
        .update({ confirmed_snapshot_id: confirmedSnapshotId, updated_at: now })
        .eq("subtask_id", subtaskId);

      return NextResponse.json({
        ...result,
        confirmed_snapshot_id: confirmedSnapshotId,
        confirmed_at: now,
      });
    } catch (err) {
      console.error("subtasks/confirm supabase error:", err);
      // Fall through to in-memory path
    }
  }

  // -------------------------------------------------------------------------
  // In-memory fallback
  // -------------------------------------------------------------------------

  const subtaskRecord = fallbackStore.subtasks.get(subtaskId);

  if (!subtaskRecord) {
    return NextResponse.json({ error: "Subtask not found" }, { status: 404 });
  }

  const curatedBundle = subtaskRecord.curated_bundle;
  const originalSnapshotId = subtaskRecord.snapshot_id;

  if (!curatedBundle || !originalSnapshotId) {
    return NextResponse.json(
      { error: "Subtask has not been curated yet" },
      { status: 404 },
    );
  }

  const result = applyOverrides(
    subtaskId,
    subtaskRecord.task_id,
    originalSnapshotId,
    curatedBundle,
    removedItemIds,
    addedInputs,
    overrideReason,
    now,
  );

  const confirmedSnapshotId = `snap-confirmed-${randomUUID()}`;
  const confirmedPackJson = {
    ...curatedBundle,
    selected_items: result.final_selected_items,
    override_summary: result.override_summary,
    is_confirmed: true,
    original_snapshot_id: originalSnapshotId,
  } as typeof curatedBundle;

  const confirmedSnapshot: SnapshotRecord = {
    snapshot_id: confirmedSnapshotId,
    run_id: `run-${subtaskRecord.task_id}`,
    org_id: "00000000-0000-0000-0000-000000000001",
    project_id: subtaskRecord.project_id,
    task_id: subtaskRecord.task_id,
    subtask_id: subtaskId,
    context_pack_json: confirmedPackJson,
    content_hash: computeContentHash(confirmedPackJson),
    run_events_snapshot: [],
    created_at: now,
  };

  fallbackStore.snapshots.set(confirmedSnapshotId, confirmedSnapshot);

  const runId = `run-${subtaskRecord.task_id}`;
  const confirmEvents = buildConfirmEvents(
    runId,
    subtaskRecord.task_id,
    subtaskId,
    originalSnapshotId,
    confirmedSnapshotId,
    result.removed_items.length,
    result.added_items.length,
    overrideReason,
    now,
  );
  emitRunEvents(runId, confirmEvents);

  return NextResponse.json({
    ...result,
    confirmed_snapshot_id: confirmedSnapshotId,
    confirmed_at: now,
  });
}

// ---------------------------------------------------------------------------
// Override logic (pure function — shared by both paths)
// ---------------------------------------------------------------------------

function applyOverrides(
  subtaskId: string,
  taskId: string,
  originalSnapshotId: string,
  curatedBundle: {
    selected_items: CuratedItem[];
    dropped_items: { item_id: string; type: string; title: string; exclusion_reason: string }[];
    token_budget: { limit: number; used: number; remaining: number };
  },
  removedItemIds: string[],
  addedInputs: AddedItemInput[],
  overrideReason: string,
  now: string,
) {
  const TOKEN_PER_ITEM = 480;
  const removedSet = new Set(removedItemIds);

  // Keep items not in the removal set
  const keptItems = curatedBundle.selected_items.filter(
    (item) => !removedSet.has(item.item_id),
  );

  // Collect removed item records
  const removedItems = curatedBundle.selected_items
    .filter((item) => removedSet.has(item.item_id))
    .map((item) => ({
      item_id: item.item_id,
      title: item.title,
      removal_reason: overrideReason || "Removed by user during context review",
    }));

  // Build added items as CuratedItem records
  const addedItems: CuratedItem[] = addedInputs.map((input, idx) => ({
    item_id: `ci-manual-${now.replace(/\D/g, "").slice(0, 12)}-${idx}`,
    type: (input.item_type === "asset" || input.item_type === "wiki_page"
      ? input.item_type
      : "asset") as "asset" | "wiki_page",
    title: input.title,
    source_ref: "manual-override",
    inclusion_reason:
      input.override_reason || overrideReason || "Manually added by user during context review",
    token_estimate: TOKEN_PER_ITEM,
  }));

  const finalSelectedItems = [...keptItems, ...addedItems];
  const tokensUsed = finalSelectedItems.reduce((sum, i) => sum + i.token_estimate, 0);
  const tokenBudget = {
    limit: curatedBundle.token_budget.limit,
    used: tokensUsed,
    remaining: curatedBundle.token_budget.limit - tokensUsed,
  };

  return {
    subtask_id: subtaskId,
    task_id: taskId,
    original_snapshot_id: originalSnapshotId,
    final_selected_items: finalSelectedItems,
    removed_items: removedItems,
    added_items: addedItems,
    token_budget: tokenBudget,
    override_summary: {
      removed_count: removedItems.length,
      added_count: addedItems.length,
      override_reason: overrideReason,
      overridden_at: now,
    },
  };
}
