/**
 * POST /api/v1/subtasks/[subtask_id]/execute — Session 15
 *
 * Executes a confirmed subtask using the selected LLM provider.
 *
 * Dual-key constraint (enforced here):
 *   When provider === "openai", both claude_api_key and openai_api_key are
 *   required. Memory store operations always run through Claude regardless
 *   of the execution provider choice. Attempting to run with provider=openai
 *   and no claude_api_key returns 400 with a descriptive error.
 *
 * In stub mode (no API keys provided), a deterministic mock response is
 * returned so the flow can be demoed without real keys.
 *
 * Request body:
 * {
 *   provider:         "claude" | "openai"   default: "claude"
 *   claude_api_key?:  string                required for real mode
 *   openai_api_key?:  string                required when provider=openai
 *   snapshot_id?:     string                use specific confirmed snapshot
 * }
 *
 * Response 200:
 * {
 *   subtask_id:          string
 *   task_id:             string
 *   snapshot_id:         string
 *   provider:            "claude" | "openai"
 *   stub_mode:           boolean
 *   answer:              string
 *   evidence_ids:        string[]
 *   token_usage:         { prompt_tokens, completion_tokens, total_tokens }
 *   executed_at:         string
 *   model:               string
 *   memory_provider_note?: string
 * }
 *
 * Error responses:
 *   400 — invalid provider config (dual-key constraint violation)
 *   401 — missing or invalid auth
 *   404 — subtask not found or not yet curated
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  executeSubtask,
  validateProviderKeys,
  Provider,
  ExecutionContext,
} from "../../../../../../lib/provider-adapter";
import { fallbackStore } from "../../../../../../lib/task-decomposer";

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
// POST /api/v1/subtasks/[subtask_id]/execute
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

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // Body is optional; default to empty
  }

  const provider = (body.provider as string) ?? "claude";
  if (provider !== "claude" && provider !== "openai") {
    return NextResponse.json(
      { error: 'provider must be "claude" or "openai".' },
      { status: 400 },
    );
  }

  const providerConfig = {
    provider: provider as Provider,
    claude_api_key:
      typeof body.claude_api_key === "string" ? body.claude_api_key : undefined,
    openai_api_key:
      typeof body.openai_api_key === "string" ? body.openai_api_key : undefined,
  };

  // Enforce dual-key constraint before any execution
  const validation = validateProviderKeys(providerConfig);
  if (!validation.valid) {
    return NextResponse.json(
      {
        error: validation.errors.join(" "),
        provider,
        dual_key_required: provider === "openai",
        errors: validation.errors,
      },
      { status: 400 },
    );
  }

  const requestedSnapshotId =
    typeof body.snapshot_id === "string" ? body.snapshot_id : null;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // ---------------------------------------------------------------------------
  // Resolve curated bundle from Supabase or fallback store
  // ---------------------------------------------------------------------------

  let execCtx: ExecutionContext | null = null;

  if (supabaseUrl && supabaseServiceKey) {
    try {
      const supabase = createClient(supabaseUrl, supabaseServiceKey);

      const { data: subtaskRow, error } = await supabase
        .from("subtasks")
        .select("*")
        .eq("subtask_id", subtaskId)
        .maybeSingle();

      if (error || !subtaskRow) {
        return NextResponse.json({ error: "Subtask not found" }, { status: 404 });
      }

      if (!subtaskRow.snapshot_id && !requestedSnapshotId) {
        return NextResponse.json(
          { error: "Subtask has not been curated yet. Call /curate first." },
          { status: 404 },
        );
      }

      const snapshotId = requestedSnapshotId ?? subtaskRow.snapshot_id;
      const { data: snap } = await supabase
        .from("run_snapshots")
        .select("*")
        .eq("snapshot_id", snapshotId)
        .maybeSingle();

      if (!snap) {
        return NextResponse.json({ error: "Snapshot not found" }, { status: 404 });
      }

      const bundle = snap.context_pack_json as {
        selected_items: ExecutionContext["selected_items"];
        token_budget: ExecutionContext["token_budget"];
      };

      execCtx = {
        subtask_id: subtaskId,
        task_id: subtaskRow.task_id,
        project_id: subtaskRow.project_id,
        intent_label: subtaskRow.intent_label ?? "Execution",
        description: subtaskRow.description ?? "Execute subtask",
        snapshot_id: snapshotId,
        selected_items: bundle.selected_items ?? [],
        token_budget: bundle.token_budget ?? { limit: 16000, used: 0, remaining: 16000 },
      };
    } catch {
      // Fall through to in-memory store
    }
  }

  // In-memory fallback
  if (!execCtx) {
    const subtaskRecord = fallbackStore.subtasks.get(subtaskId);
    if (!subtaskRecord) {
      return NextResponse.json({ error: "Subtask not found" }, { status: 404 });
    }

    const snapshotId = requestedSnapshotId ?? subtaskRecord.snapshot_id;
    if (!snapshotId) {
      return NextResponse.json(
        { error: "Subtask has not been curated yet. Call /curate first." },
        { status: 404 },
      );
    }

    const snap = fallbackStore.snapshots.get(snapshotId);
    if (!snap) {
      return NextResponse.json({ error: "Snapshot not found" }, { status: 404 });
    }

    const bundle = snap.context_pack_json as {
      selected_items: ExecutionContext["selected_items"];
      token_budget: ExecutionContext["token_budget"];
    };

    execCtx = {
      subtask_id: subtaskId,
      task_id: subtaskRecord.task_id,
      project_id: subtaskRecord.project_id,
      intent_label: subtaskRecord.intent_label ?? "Execution",
      description: subtaskRecord.description ?? "Execute subtask",
      snapshot_id: snapshotId,
      selected_items: bundle.selected_items ?? [],
      token_budget: bundle.token_budget ?? { limit: 16000, used: 0, remaining: 16000 },
    };
  }

  // ---------------------------------------------------------------------------
  // Execute via adapter
  // ---------------------------------------------------------------------------

  try {
    const result = await executeSubtask(execCtx, providerConfig);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Execution failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
