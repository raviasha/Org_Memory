/**
 * GET /api/v1/memory-stores/[memory_store_id]/activity
 *
 * Session 8d — Memory store activity endpoint.
 *
 * Returns the memory write operations recorded for a given local memory
 * store ID (UUID from the memory_store_catalog table). Both real-API and
 * stub-mode writes are surfaced here, as both emit structured run_events rows.
 *
 * Response 200:
 * {
 *   memory_store_id:      string         // local UUID
 *   anthropic_store_id:   string | null  // memstore_... or stub-memstore-...
 *   project_id:           string | null
 *   activities: [
 *     {
 *       event_type:         "memory_write_succeeded"
 *       memory_path:        "/assets/{asset_id}.md"
 *       memory_version_id:  "memver_..." | "stub-memver-..."
 *       asset_id:           string
 *       occurred_at:        ISO-8601 string
 *     },
 *     ...
 *   ]
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { listMemoryActivity } from "../../../../../../lib/managed-memory";

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
// Route handler
// ---------------------------------------------------------------------------

export async function GET(
  req: NextRequest,
  { params }: { params: { memory_store_id: string } },
): Promise<NextResponse> {
  const authed = await verifyAuth(req);
  if (!authed) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { memory_store_id } = params;
  if (!memory_store_id) {
    return NextResponse.json({ error: "memory_store_id is required" }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    // No Supabase — return empty activity list for dev environments
    return NextResponse.json({
      memory_store_id,
      anthropic_store_id: null,
      project_id: null,
      activities: [],
    });
  }

  const db = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });

  // Look up store metadata
  const { data: storeRows } = await db
    .from("memory_store_catalog")
    .select("memory_store_id, anthropic_memory_store_id, project_id")
    .eq("memory_store_id", memory_store_id);

  const store = (
    storeRows as Array<{
      memory_store_id: string;
      anthropic_memory_store_id: string | null;
      project_id: string;
    }>
  )?.[0];

  if (!store) {
    return NextResponse.json({ error: "Memory store not found" }, { status: 404 });
  }

  // Fetch activity items from run_events
  const activities = await listMemoryActivity(memory_store_id, db as never);

  return NextResponse.json({
    memory_store_id: store.memory_store_id,
    anthropic_store_id: store.anthropic_memory_store_id ?? null,
    project_id: store.project_id ?? null,
    activities,
  });
}
