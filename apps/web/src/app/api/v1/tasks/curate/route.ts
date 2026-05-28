import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  decomposeTask,
  fallbackStore,
  TaskRecord,
  SubtaskRecord,
} from "../../../../../lib/task-decomposer";

// ---------------------------------------------------------------------------
// Auth helper (same pattern as all other routes in this app)
// ---------------------------------------------------------------------------

async function verifyAuth(req: NextRequest): Promise<boolean> {
  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return false;
  const token = authHeader.slice(7).trim();
  if (!token) return false;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    // Dev passthrough when Supabase is not configured
    return true;
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const { error } = await supabase.auth.getUser(token);
    return !error;
  } catch {
    return true; // Treat network errors as dev passthrough
  }
}

// ---------------------------------------------------------------------------
// ID helpers
// ---------------------------------------------------------------------------

function shortId(len = 5): string {
  return Math.random().toString(36).slice(2, 2 + len).padStart(len, "0");
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
}

// ---------------------------------------------------------------------------
// POST /api/v1/tasks/curate
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
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const taskText = typeof body.task_text === "string" ? body.task_text.trim() : "";
  const projectId = typeof body.project_id === "string" ? body.project_id.trim() : "";
  const orgId = typeof body.org_id === "string" ? body.org_id : "00000000-0000-0000-0000-000000000001";
  const idempotencyKey = typeof body.idempotency_key === "string" ? body.idempotency_key.trim() || null : null;

  if (!taskText) {
    return NextResponse.json({ error: "task_text is required" }, { status: 400 });
  }
  if (!projectId) {
    return NextResponse.json({ error: "project_id is required" }, { status: 400 });
  }

  const now = new Date().toISOString();

  // ---------------------------------------------------------------------------
  // Supabase path
  // ---------------------------------------------------------------------------
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (supabaseUrl && supabaseServiceKey) {
    try {
      const supabase = createClient(supabaseUrl, supabaseServiceKey);

      // Idempotency check
      if (idempotencyKey) {
        const { data: existing } = await supabase
          .from("tasks")
          .select("*")
          .eq("idempotency_key", idempotencyKey)
          .maybeSingle();

        if (existing) {
          const { data: subtasks } = await supabase
            .from("subtasks")
            .select("*")
            .eq("task_id", existing.task_id)
            .order("position");

          return NextResponse.json(
            { ...existing, subtasks: subtasks ?? [] },
            { status: 200 },
          );
        }
      }

      // Generate task_id and subtasks
      const taskId = `task-${slugify(taskText.slice(0, 20))}-${shortId()}`;
      const subtasks = decomposeTask(taskId, taskText, projectId, now);

      // Insert task
      const taskRow = {
        task_id: taskId,
        org_id: orgId,
        project_id: projectId,
        task_text: taskText,
        idempotency_key: idempotencyKey,
        status: "ready",
        created_at: now,
        updated_at: now,
      };

      await supabase.from("tasks").insert(taskRow);

      // Insert subtasks
      const subtaskRows = subtasks.map((s) => ({
        subtask_id: s.subtask_id,
        task_id: taskId,
        project_id: projectId,
        position: s.position,
        intent_label: s.intent_label,
        description: s.description,
        expected_evidence: s.expected_evidence,
        store_routing: s.store_routing,
        status: "pending",
        created_at: now,
        updated_at: now,
      }));
      await supabase.from("subtasks").insert(subtaskRows);

      return NextResponse.json(
        {
          task_id: taskId,
          org_id: orgId,
          project_id: projectId,
          task_text: taskText,
          idempotency_key: idempotencyKey,
          status: "ready",
          subtasks,
          created_at: now,
        },
        { status: 201 },
      );
    } catch (err) {
      console.error("tasks/curate supabase error:", err);
      // Fall through to static fallback
    }
  }

  // ---------------------------------------------------------------------------
  // Static / in-memory fallback
  // ---------------------------------------------------------------------------

  // Idempotency check in memory
  if (idempotencyKey && fallbackStore.idempotencyIndex.has(idempotencyKey)) {
    const existingTaskId = fallbackStore.idempotencyIndex.get(idempotencyKey)!;
    const existingTask = fallbackStore.tasks.get(existingTaskId);
    if (existingTask) {
      return NextResponse.json(existingTask, { status: 200 });
    }
  }

  const taskId = `task-${slugify(taskText.slice(0, 20))}-${shortId()}`;
  const subtasks = decomposeTask(taskId, taskText, projectId, now);

  const subtaskRecords: SubtaskRecord[] = subtasks.map((s) => ({
    ...s,
    curated_bundle: null,
    snapshot_id: null,
  }));

  const taskRecord: TaskRecord = {
    task_id: taskId,
    org_id: orgId,
    project_id: projectId,
    task_text: taskText,
    idempotency_key: idempotencyKey,
    status: "ready",
    subtasks,
    created_at: now,
  };

  fallbackStore.tasks.set(taskId, taskRecord);
  subtaskRecords.forEach((s) => fallbackStore.subtasks.set(s.subtask_id, s));
  if (idempotencyKey) fallbackStore.idempotencyIndex.set(idempotencyKey, taskId);

  return NextResponse.json(taskRecord, { status: 201 });
}
