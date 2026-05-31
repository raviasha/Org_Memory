/**
 * POST /api/v1/context/assemble — Session 12
 *
 * Context assembler endpoint.  Given evidence sets from one or more memory
 * stores, produces a deterministic context pack with:
 *   - per-level token budget enforcement
 *   - cross-store deduplication
 *   - persisted curation manifest
 *
 * Request body:
 * {
 *   stores:         StoreEvidenceSet[]   (required, 1–3 stores)
 *   task_id?:       string
 *   subtask_id?:    string
 *   run_id?:        string
 *   project_id?:    string
 *   level_budgets?: { level_0?: number; level_1?: number; level_2?: number }
 *   total_budget?:  number
 * }
 *
 * Response 201:
 * {
 *   manifest_id:       string
 *   selected:          SelectedItem[]
 *   dropped:           DroppedItem[]
 *   curation_manifest: CurationManifest
 *   store_count:       number
 *   total_candidates:  number
 * }
 *
 * Error responses:
 *   401 — missing or invalid auth
 *   400 — invalid request body
 *   422 — store count exceeds cap (max 3)
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  assembleContext,
  AssemblerInput,
  StoreEvidenceSet,
  EvidenceInput,
} from "../../../../../lib/context-assembler";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_STORES = 3;

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

async function verifyAuth(req: NextRequest): Promise<boolean> {
  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return false;
  const token = authHeader.slice(7).trim();
  if (!token) return false;

  const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnon) return true; // dev passthrough

  try {
    const client = createClient(supabaseUrl, supabaseAnon);
    const { error } = await client.auth.getUser(token);
    return !error;
  } catch {
    return true;
  }
}

// ---------------------------------------------------------------------------
// Input validation helpers
// ---------------------------------------------------------------------------

function isEvidenceInput(v: unknown): v is EvidenceInput {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.evidence_id === "string" &&
    typeof o.evidence_type === "string" &&
    typeof o.retrieval_level === "string" &&
    typeof o.title === "string" &&
    typeof o.composite_score === "number"
  );
}

function normaliseItem(raw: Record<string, unknown>, storeId: string): EvidenceInput {
  return {
    evidence_id:      String(raw.evidence_id ?? ""),
    project_id:       String(raw.project_id ?? ""),
    store_id:         storeId,
    evidence_type:    String(raw.evidence_type ?? "asset"),
    retrieval_level:  String(raw.retrieval_level ?? "level_2"),
    title:            String(raw.title ?? ""),
    summary_snippet:  String(raw.summary_snippet ?? ""),
    wiki_page_slug:   typeof raw.wiki_page_slug === "string" ? raw.wiki_page_slug : null,
    file_path_or_url: typeof raw.file_path_or_url === "string" ? raw.file_path_or_url : null,
    acl_scope:        String(raw.acl_scope ?? "org:acme"),
    hierarchy_path:   String(raw.hierarchy_path ?? ""),
    lineage_chain:    Array.isArray(raw.lineage_chain) ? (raw.lineage_chain as string[]) : [],
    keyword_hints:    Array.isArray(raw.keyword_hints) ? (raw.keyword_hints as string[]) : [],
    composite_score:  Number(raw.composite_score ?? 0),
    rationale:        String(raw.rationale ?? ""),
  };
}

// ---------------------------------------------------------------------------
// Supabase persistence helper
// ---------------------------------------------------------------------------

async function persistManifest(
  manifest: ReturnType<typeof assembleContext>["curation_manifest"],
  contextPackJson: ReturnType<typeof assembleContext>,
  orgId: string,
): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return; // dev passthrough — no Supabase

  try {
    const supabase = createClient(supabaseUrl, serviceKey);
    await supabase.from("curation_manifests").insert({
      manifest_id:       manifest.manifest_id,
      task_id:           manifest.task_id,
      subtask_id:        manifest.subtask_id,
      run_id:            manifest.run_id,
      org_id:            orgId,
      project_id:        manifest.project_id,
      selected_item_ids: manifest.selected_item_ids,
      dropped_item_ids:  manifest.dropped_item_ids,
      deduplication_log: manifest.deduplication_log,
      budget_summary:    manifest.budget_summary,
      store_ids_used:    manifest.store_ids_used,
      total_candidates:  manifest.total_candidates,
      context_pack_json: contextPackJson,
      created_at:        manifest.created_at,
    });
  } catch (err) {
    // Log but do not fail the request — manifest persistence is best-effort
    // to avoid blocking context assembly for transient DB issues.
    console.error("Failed to persist curation manifest:", err);
  }
}

// ---------------------------------------------------------------------------
// POST handler
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
    return NextResponse.json(
      { error: "Bad Request", code: "invalid_json" },
      { status: 400 },
    );
  }

  // ── Validate stores ───────────────────────────────────────────────────────
  if (!Array.isArray(body.stores) || body.stores.length === 0) {
    return NextResponse.json(
      { error: "Bad Request", code: "missing_stores",
        message: "stores must be a non-empty array of StoreEvidenceSet" },
      { status: 400 },
    );
  }

  if (body.stores.length > MAX_STORES) {
    return NextResponse.json(
      {
        error: "Unprocessable Entity",
        code: "store_count_exceeded",
        message: `Maximum ${MAX_STORES} stores allowed per assembly run. ` +
          `${body.stores.length} stores provided. ` +
          "Reduce store count or use an explicit escalation path.",
        max_stores: MAX_STORES,
        provided: body.stores.length,
      },
      { status: 422 },
    );
  }

  const parsedStores: StoreEvidenceSet[] = [];
  for (let i = 0; i < body.stores.length; i++) {
    const s = body.stores[i] as Record<string, unknown>;
    if (typeof s.store_id !== "string" || !s.store_id.trim()) {
      return NextResponse.json(
        { error: "Bad Request", code: "invalid_store",
          message: `stores[${i}].store_id must be a non-empty string` },
        { status: 400 },
      );
    }
    if (!Array.isArray(s.items)) {
      return NextResponse.json(
        { error: "Bad Request", code: "invalid_store",
          message: `stores[${i}].items must be an array` },
        { status: 400 },
      );
    }
    const items = (s.items as unknown[]).map((raw, j) => {
      if (typeof raw !== "object" || raw === null) {
        throw new TypeError(`stores[${i}].items[${j}] is not an object`);
      }
      if (!isEvidenceInput(raw)) {
        // Normalise gracefully — fill missing fields with defaults
      }
      return normaliseItem(raw as Record<string, unknown>, s.store_id as string);
    });

    parsedStores.push({ store_id: s.store_id as string, items });
  }

  // ── Optional parameters ───────────────────────────────────────────────────
  const taskId      = typeof body.task_id === "string"    ? body.task_id.trim() || null    : null;
  const subtaskId   = typeof body.subtask_id === "string" ? body.subtask_id.trim() || null : null;
  const runId       = typeof body.run_id === "string"     ? body.run_id.trim() || null     : null;
  const projectId   = typeof body.project_id === "string" ? body.project_id.trim() || null : null;
  const totalBudget = typeof body.total_budget === "number" ? body.total_budget : undefined;
  const orgId       = typeof body.org_id === "string" ? body.org_id : "00000000-0000-0000-0000-000000000001";

  let levelBudgets: Partial<{ level_0: number; level_1: number; level_2: number }> | undefined;
  if (typeof body.level_budgets === "object" && body.level_budgets !== null) {
    const lb = body.level_budgets as Record<string, unknown>;
    levelBudgets = {};
    if (typeof lb.level_0 === "number") levelBudgets.level_0 = lb.level_0;
    if (typeof lb.level_1 === "number") levelBudgets.level_1 = lb.level_1;
    if (typeof lb.level_2 === "number") levelBudgets.level_2 = lb.level_2;
  }

  // ── Run assembler ─────────────────────────────────────────────────────────
  const assemblerInput: AssemblerInput = {
    stores:       parsedStores,
    task_id:      taskId,
    subtask_id:   subtaskId,
    run_id:       runId,
    project_id:   projectId,
    level_budgets: levelBudgets,
    total_budget:  totalBudget,
  };

  const pack = assembleContext(assemblerInput);

  // ── Persist manifest ──────────────────────────────────────────────────────
  await persistManifest(pack.curation_manifest, pack, orgId);

  return NextResponse.json(
    {
      manifest_id:       pack.curation_manifest.manifest_id,
      selected:          pack.selected,
      dropped:           pack.dropped,
      curation_manifest: pack.curation_manifest,
      store_count:       pack.store_count,
      total_candidates:  pack.total_candidates,
    },
    { status: 201 },
  );
}
