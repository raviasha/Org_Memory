/**
 * GET /api/v1/runs/[run_id]/events — Session 16
 *
 * Returns the ordered event log for a run_id. Supports filtering by
 * event_type and cursor-based pagination.
 *
 * Response 200:
 * {
 *   run_id:     string
 *   events:     RunEvent[]
 *   pagination: { next_cursor: string | null; has_more: boolean }
 * }
 *
 * Error responses:
 *   401 — missing or invalid auth
 *   404 — run_id not found (no events)
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { fallbackStore, getRunEvents } from "../../../../../../lib/task-decomposer";

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

const PAGE_SIZE = 50;

// ---------------------------------------------------------------------------
// GET /api/v1/runs/[run_id]/events
// ---------------------------------------------------------------------------

export async function GET(
  req: NextRequest,
  { params }: { params: { run_id: string } },
): Promise<NextResponse> {
  const authed = await verifyAuth(req);
  if (!authed) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { run_id: runId } = params;
  const { searchParams } = new URL(req.url);
  const eventTypeFilter = searchParams.get("event_type");
  const cursor = searchParams.get("cursor");
  const limitParam = searchParams.get("limit");
  const limit = Math.min(Math.max(parseInt(limitParam ?? String(PAGE_SIZE), 10), 1), 200);

  // ---------------------------------------------------------------------------
  // Supabase path
  // ---------------------------------------------------------------------------
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (supabaseUrl && supabaseServiceKey) {
    try {
      const supabase = createClient(supabaseUrl, supabaseServiceKey);

      let query = supabase
        .from("run_events")
        .select("*")
        .eq("run_id", runId)
        .order("occurred_at", { ascending: true })
        .limit(limit + 1);

      if (eventTypeFilter) {
        query = query.eq("event_type", eventTypeFilter);
      }

      if (cursor) {
        // cursor is an ISO timestamp; return events that occurred strictly after it
        query = query.gt("occurred_at", cursor);
      }

      const { data, error } = await query;

      if (error) throw error;

      const hasMore = (data?.length ?? 0) > limit;
      const events = (data ?? []).slice(0, limit);
      const nextCursor = hasMore && events.length > 0
        ? events[events.length - 1].occurred_at
        : null;

      if (events.length === 0 && !cursor) {
        // Check if run_id exists at all via run_snapshots
        const { data: snap } = await supabase
          .from("run_snapshots")
          .select("run_id")
          .eq("run_id", runId)
          .maybeSingle();

        if (!snap) {
          return NextResponse.json({ error: "Run not found" }, { status: 404 });
        }
      }

      return NextResponse.json({
        run_id: runId,
        events,
        pagination: { next_cursor: nextCursor, has_more: hasMore },
      });
    } catch (err) {
      console.error("runs/[run_id]/events supabase error:", err);
      // Fall through to in-memory fallback
    }
  }

  // ---------------------------------------------------------------------------
  // In-memory fallback
  // ---------------------------------------------------------------------------

  // Check if run_id is known (either in runEvents or referenced by a snapshot)
  const hasEvents = fallbackStore.runEvents.has(runId);
  const hasSnapshot = [...fallbackStore.snapshots.values()].some(
    (s) => s.run_id === runId,
  );

  if (!hasEvents && !hasSnapshot) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  let events = getRunEvents(runId);

  if (eventTypeFilter) {
    events = events.filter((e) => e.event_type === eventTypeFilter);
  }

  // Apply cursor pagination (cursor = ISO timestamp of last seen event)
  if (cursor) {
    events = events.filter((e) => e.occurred_at > cursor);
  }

  const hasMore = events.length > limit;
  const page = events.slice(0, limit);
  const nextCursor = hasMore && page.length > 0
    ? page[page.length - 1].occurred_at
    : null;

  return NextResponse.json({
    run_id: runId,
    events: page,
    pagination: { next_cursor: nextCursor, has_more: hasMore },
  });
}
