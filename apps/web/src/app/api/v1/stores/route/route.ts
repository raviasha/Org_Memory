/**
 * POST /api/v1/stores/route — Session 8e
 *
 * Memory-store routing request endpoint.
 *
 * Given a task text and an anchoring project, returns a ranked shortlist of
 * memory stores with per-store evidence targets, token budget estimates,
 * ACL-filtering results, and structured routing events.
 *
 * Request body:
 *   {
 *     task_text:           string          (required)
 *     project_id:          string          (required — anchoring project)
 *     org_id?:             string          (defaults to demo org)
 *     acl_scope?:          string          (defaults to "org:acme")
 *     max_stores?:         number          (default 3, must be ≥ 1)
 *     memory_file_budget?: number          (default 20 files × 1 000 tokens)
 *   }
 *
 * Response 201:
 *   {
 *     routing_id:          string
 *     task_intent:         string
 *     task_intent_label:   string
 *     task_entities:       string[]
 *     ranked_stores:       RoutedStore[]
 *     applied_cap:         number
 *     total_candidates:    number
 *     acl_filtered_count:  number
 *     budget_status:       "ok" | "exceeded"
 *     escalation_message:  string | null
 *     routing_events:      RoutingEvent[]
 *     created_at:          string
 *   }
 *
 * Error responses:
 *   401  — missing or invalid auth
 *   400  — missing required fields or invalid parameter values
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  routeStores,
  STATIC_STORE_CATALOG,
  DEFAULT_MAX_STORES,
  DEFAULT_MEMORY_FILE_BUDGET,
  RoutingStoreMetadata,
} from "../../../../../lib/store-router";

// ---------------------------------------------------------------------------
// Auth helper (same pattern as all other routes)
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
    return true; // network error → dev passthrough
  }
}

// ---------------------------------------------------------------------------
// ID generator
// ---------------------------------------------------------------------------

function generateRoutingId(): string {
  return `route-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// ---------------------------------------------------------------------------
// POST /api/v1/stores/route
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
  const orgId =
    typeof body.org_id === "string"
      ? body.org_id
      : "00000000-0000-0000-0000-000000000001";
  const aclScope =
    typeof body.acl_scope === "string" ? body.acl_scope.trim() : "org:acme";

  if (!taskText) {
    return NextResponse.json({ error: "task_text is required" }, { status: 400 });
  }
  if (!projectId) {
    return NextResponse.json({ error: "project_id is required" }, { status: 400 });
  }

  // Validate optional numeric params
  let maxStores = DEFAULT_MAX_STORES;
  if (body.max_stores !== undefined) {
    const v = Number(body.max_stores);
    if (!Number.isInteger(v) || v < 1) {
      return NextResponse.json(
        { error: "max_stores must be a positive integer" },
        { status: 400 },
      );
    }
    maxStores = v;
  }

  let memoryFileBudget = DEFAULT_MEMORY_FILE_BUDGET;
  if (body.memory_file_budget !== undefined) {
    const v = Number(body.memory_file_budget);
    if (!Number.isInteger(v) || v < 1) {
      return NextResponse.json(
        { error: "memory_file_budget must be a positive integer" },
        { status: 400 },
      );
    }
    memoryFileBudget = v;
  }

  const routingId = generateRoutingId();

  // ---------------------------------------------------------------------------
  // Fetch candidate stores (Supabase path or static fallback)
  // ---------------------------------------------------------------------------

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  let candidateStores: RoutingStoreMetadata[] = STATIC_STORE_CATALOG;

  if (supabaseUrl && supabaseServiceKey) {
    try {
      const db = createClient(supabaseUrl, supabaseServiceKey, {
        auth: { persistSession: false },
      });

      const { data: rows, error } = await db
        .from("memory_store_catalog")
        .select(
          [
            "memory_store_id",
            "project_id",
            "name",
            "description",
            "owner_team",
            "node_type",
            "depth",
            "path_slug",
            "acl_scope",
            "allowed_roles",
            "data_classification",
            "top_topics",
            "top_entities",
            "supported_task_intents",
            "staleness_score",
            "coverage_score",
            "contradiction_risk_score",
            "memory_count",
            "total_bytes",
            "historical_helpfulness_by_intent",
            "historical_selection_rate",
            "historical_override_rate",
            "default_attach_mode",
            "attach_priority",
            "last_updated_at",
          ].join(", "),
        )
        .eq("status", "active");

      if (!error && rows && (rows as unknown as RoutingStoreMetadata[]).length > 0) {
        candidateStores = rows as unknown as RoutingStoreMetadata[];
      }
    } catch {
      // Fall through to static catalog on DB error
    }
  }

  // ---------------------------------------------------------------------------
  // Run routing
  // ---------------------------------------------------------------------------

  const result = routeStores(
    {
      routing_id: routingId,
      task_text: taskText,
      project_id: projectId,
      org_id: orgId,
      acl_scope: aclScope,
      max_stores: maxStores,
      memory_file_budget: memoryFileBudget,
    },
    candidateStores,
  );

  // ---------------------------------------------------------------------------
  // Persist routing request (Supabase path only — non-blocking)
  // ---------------------------------------------------------------------------

  if (supabaseUrl && supabaseServiceKey) {
    try {
      const db = createClient(supabaseUrl, supabaseServiceKey, {
        auth: { persistSession: false },
      });

      // Persist to routing_requests table
      await db.from("routing_requests").insert({
        routing_id: routingId,
        org_id: orgId,
        project_id: projectId,
        task_text: taskText,
        task_intent: result.task_intent,
        task_entities: result.task_entities,
        acl_scope: aclScope,
        max_stores: maxStores,
        memory_file_budget: memoryFileBudget,
        ranked_stores: result.ranked_stores,
        total_candidates: result.total_candidates,
        acl_filtered_count: result.acl_filtered_count,
        budget_status: result.budget_status,
        escalation_message: result.escalation_message,
        routing_events: result.routing_events,
        created_at: result.created_at,
      });

      // Also emit run_events for each routing event
      const runId = routingId;
      const eventsToInsert = result.routing_events.map((re) => ({
        run_id: runId,
        correlation_id: routingId,
        event_type: "curation_started", // use closest available enum value
        actor: "store-router",
        payload: {
          routing_event_type: re.event_type,
          store_id: re.store_id ?? null,
          detail: re.detail,
        },
        occurred_at: re.occurred_at,
      }));

      if (eventsToInsert.length > 0) {
        await db.from("run_events").insert(eventsToInsert);
      }
    } catch {
      // Non-blocking — routing result still returned even if persist fails
    }
  }

  return NextResponse.json(result, { status: 201 });
}
