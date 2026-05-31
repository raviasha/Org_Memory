/**
 * Task decomposer — Session 8c
 *
 * Rule-based subtask generator for prototype mode.
 * Produces 2–4 deterministic subtasks from free-form task text by matching
 * against intent patterns and evidence heuristics drawn from the seeded corpus.
 *
 * This runs entirely in-process with no LLM call so it is always fast and
 * deterministic for a given (task_text, project_id) pair.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StoreRouting {
  candidate_store_ids: string[];
  rationale: string;
  max_stores: number;
}

export interface SubtaskPlan {
  subtask_id: string;
  task_id: string;
  project_id: string;
  position: number;
  intent_label: string;
  description: string;
  expected_evidence: string[];
  store_routing: StoreRouting;
  status: "pending";
  created_at: string;
}

export interface CuratedItem {
  item_id: string;
  type: "asset" | "wiki_page";
  title: string;
  source_ref: string;
  inclusion_reason: string;
  token_estimate: number;
}

export interface DroppedItem {
  item_id: string;
  type: "asset" | "wiki_page";
  title: string;
  exclusion_reason: string;
}

export interface RationaleEntry {
  item_id: string;
  rationale: string;
  retrieval_level: "level_0" | "level_1" | "level_2";
  score: number;
}

export interface TokenBudget {
  limit: number;
  used: number;
  remaining: number;
}

export interface CuratedBundle {
  selected_items: CuratedItem[];
  dropped_items: DroppedItem[];
  selected_asset_ids: string[];
  rationale_trace: RationaleEntry[];
  token_budget: TokenBudget;
}

// ---------------------------------------------------------------------------
// Intent patterns
// ---------------------------------------------------------------------------

interface IntentPattern {
  keywords: string[];
  intent: string;
  label: string;
  evidence_hints: string[];
  store_hint: string;
}

const INTENT_PATTERNS: IntentPattern[] = [
  {
    keywords: ["risk", "risks", "key risk", "exposure", "liability"],
    intent: "risk_assessment",
    label: "Risk Assessment",
    evidence_hints: [
      "targetco-key-risks-memo.md",
      "wiki: Risk and Liability Analysis",
      "wiki: Due Diligence Summary",
    ],
    store_hint: "proj-corpdev-targetco-dd",
  },
  {
    keywords: ["vendor", "supplier", "procurement", "approve", "approval", "sourcing"],
    intent: "vendor_evaluation",
    label: "Vendor Evaluation",
    evidence_hints: [
      "org-vendor-approval-process.md",
      "wiki: Vendor Approval Workflow",
      "wiki: Approved Vendor Registry",
    ],
    store_hint: "proj-org-shared",
  },
  {
    keywords: ["compliance", "gdpr", "ccpa", "regulation", "legal", "privacy", "dpa", "data protection"],
    intent: "compliance_check",
    label: "Compliance Check",
    evidence_hints: [
      "gdpr-compliance-checklist-v3.md",
      "privacy-incident-response-playbook.md",
      "wiki: GDPR Compliance Overview",
    ],
    store_hint: "proj-compliance-privacy",
  },
  {
    keywords: ["finance", "cost", "budget", "npv", "valuation", "capex", "opex", "depreciation"],
    intent: "financial_analysis",
    label: "Financial Analysis",
    evidence_hints: [
      "infrastructure-depreciation-schedule.csv",
      "board-approval-memo-q2-fy26.md",
      "wiki: Infrastructure Budget Summary",
    ],
    store_hint: "proj-finance-infra-q3",
  },
  {
    keywords: ["incident", "runbook", "ops", "on-call", "oncall", "alert", "sla", "postmortem", "outage"],
    intent: "operations_review",
    label: "Operations Review",
    evidence_hints: [
      "api-gateway-runbook.md",
      "on-call-rotation-q2-2026.csv",
      "wiki: Incident Response Playbook",
    ],
    store_hint: "proj-eng-incident-ops",
  },
  {
    keywords: ["policy", "process", "procedure", "guideline", "approval", "ai usage"],
    intent: "policy_review",
    label: "Policy Review",
    evidence_hints: [
      "org-ai-usage-policy.md",
      "travel-expense-policy.txt",
      "wiki: Organisational Policies Index",
    ],
    store_hint: "proj-org-shared",
  },
  {
    keywords: ["tech", "technology", "stack", "architecture", "system", "infrastructure", "platform"],
    intent: "technical_assessment",
    label: "Technical Assessment",
    evidence_hints: [
      "targetco-tech-stack-assessment.md",
      "alert-thresholds-config.yml",
      "wiki: Technology Stack Overview",
    ],
    store_hint: "proj-corpdev-targetco-dd",
  },
  {
    keywords: ["summary", "overview", "report", "brief", "background"],
    intent: "context_synthesis",
    label: "Context Synthesis",
    evidence_hints: [
      "wiki: Org Glossary",
      "org-glossary.md",
      "wiki: Project Index",
    ],
    store_hint: "proj-org-shared",
  },
];

// ---------------------------------------------------------------------------
// Deterministic ID helpers
// ---------------------------------------------------------------------------

/** Simple djb2-style hash for deterministic IDs without crypto */
function hashStr(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
    h = h >>> 0; // keep unsigned 32-bit
  }
  return h;
}

function shortHash(s: string, len = 5): string {
  const n = hashStr(s);
  return n.toString(36).padStart(len, "0").slice(-len);
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

// ---------------------------------------------------------------------------
// Core decomposer
// ---------------------------------------------------------------------------

/**
 * Decomposes task_text into 2–4 subtasks using rule-based intent matching.
 * Returns a deterministic list of SubtaskPlan objects.
 */
export function decomposeTask(
  taskId: string,
  taskText: string,
  projectId: string,
  now: string,
): SubtaskPlan[] {
  const lower = taskText.toLowerCase();

  // Score each intent pattern against the task text
  const scored = INTENT_PATTERNS.map((p) => {
    const hits = p.keywords.filter((kw) => lower.includes(kw)).length;
    return { pattern: p, hits };
  }).filter((x) => x.hits > 0);

  // Sort by match count descending, take top 3
  scored.sort((a, b) => b.hits - a.hits);
  const topPatterns = scored.slice(0, 3).map((x) => x.pattern);

  // Always ensure at least 2 subtasks — add "Context Synthesis" if needed
  if (topPatterns.length === 0) {
    topPatterns.push(
      INTENT_PATTERNS.find((p) => p.intent === "context_synthesis")!,
      INTENT_PATTERNS.find((p) => p.intent === "policy_review")!,
    );
  } else if (topPatterns.length === 1) {
    const fallback = INTENT_PATTERNS.find(
      (p) => p.intent === "context_synthesis" && p !== topPatterns[0],
    );
    if (fallback) topPatterns.push(fallback);
  }

  return topPatterns.map((pattern, idx) => {
    const seedKey = `${taskId}-${idx}-${pattern.intent}`;
    const subtaskId = `subtask-${slugify(pattern.label)}-${shortHash(seedKey)}`;

    // Candidate stores: primary store for this intent + org-shared as secondary
    const primaryStore = pattern.store_hint;
    const candidateStores = Array.from(
      new Set([primaryStore, "proj-org-shared", projectId].filter(Boolean)),
    ).slice(0, 3);

    const storeRouting: StoreRouting = {
      candidate_store_ids: candidateStores,
      rationale: `Intent "${pattern.label}" matched ${
        pattern.keywords.filter((kw) => lower.includes(kw)).join(", ") || "pattern"
      } in task text. Primary store: ${primaryStore}. Max 3 stores per subtask policy applied.`,
      max_stores: 3,
    };

    return {
      subtask_id: subtaskId,
      task_id: taskId,
      project_id: projectId,
      position: idx,
      intent_label: pattern.label,
      description: buildSubtaskDescription(pattern.intent, taskText),
      expected_evidence: pattern.evidence_hints,
      store_routing: storeRouting,
      status: "pending" as const,
      created_at: now,
    };
  });
}

function buildSubtaskDescription(intent: string, taskText: string): string {
  const short = taskText.length > 80 ? taskText.slice(0, 80) + "…" : taskText;
  switch (intent) {
    case "risk_assessment":
      return `Identify and assess key risks relevant to: "${short}"`;
    case "vendor_evaluation":
      return `Evaluate vendor or supplier information relevant to: "${short}"`;
    case "compliance_check":
      return `Check applicable compliance requirements and policies for: "${short}"`;
    case "financial_analysis":
      return `Gather and analyse financial data and projections relevant to: "${short}"`;
    case "operations_review":
      return `Review operational procedures, runbooks, and incident data for: "${short}"`;
    case "policy_review":
      return `Identify relevant organisational policies and approval processes for: "${short}"`;
    case "technical_assessment":
      return `Assess technical architecture and system landscape relevant to: "${short}"`;
    case "context_synthesis":
      return `Synthesise background context and relevant glossary entries for: "${short}"`;
    default:
      return `Investigate sub-task (${intent}) for: "${short}"`;
  }
}

// ---------------------------------------------------------------------------
// Curated bundle builder
// ---------------------------------------------------------------------------

/**
 * Produces a deterministic curated bundle for a subtask.
 * In prototype mode this is rule-based (no LLM call); in production 8d+ will
 * replace this with real Managed Agents memory reads.
 */
export function buildCuratedBundle(
  subtask: SubtaskPlan,
  projectId: string,
): CuratedBundle {
  const TOKEN_LIMIT = 4000;
  const TOKENS_PER_ITEM = 480;

  // Build selected items from expected evidence + a wiki summary page
  const selectedItems: CuratedItem[] = [];
  const rationaleTrace: RationaleEntry[] = [];

  subtask.expected_evidence.forEach((ref, idx) => {
    const isWiki = ref.startsWith("wiki:");
    const title = isWiki ? ref.slice(6).trim() : ref.split("/").pop() ?? ref;
    const itemId = `ci-${shortHash(subtask.subtask_id + ref)}-${idx}`;

    selectedItems.push({
      item_id: itemId,
      type: isWiki ? "wiki_page" : "asset",
      title,
      source_ref: ref,
      inclusion_reason: `Matched intent "${subtask.intent_label}" — ${
        isWiki ? "wiki synthesis page relevant to task scope" : "source asset directly referenced by task"
      }`,
      token_estimate: TOKENS_PER_ITEM,
    });

    rationaleTrace.push({
      item_id: itemId,
      rationale: `Selected at Level ${isWiki ? "1 (domain wiki)" : "2 (specific file)"} based on intent-pattern match for "${subtask.intent_label}". Score: ${(0.95 - idx * 0.05).toFixed(2)}.`,
      retrieval_level: isWiki ? "level_1" : "level_2",
      score: parseFloat((0.95 - idx * 0.05).toFixed(2)),
    });
  });

  // Add some synthetic dropped items (candidates that didn't meet the cut)
  const droppedItems: DroppedItem[] = [
    {
      item_id: `ci-dropped-${shortHash(subtask.subtask_id + "d1")}`,
      type: "asset",
      title: "travel-expense-policy.txt",
      exclusion_reason: `Relevance score below threshold for intent "${subtask.intent_label}". No keyword overlap with task terms.`,
    },
    {
      item_id: `ci-dropped-${shortHash(subtask.subtask_id + "d2")}`,
      type: "wiki_page",
      title: "Wiki: Procurement Log",
      exclusion_reason: `Low freshness score (last updated >90 days ago). Superseded by more recent evidence items.`,
    },
  ].filter(
    (d) => !selectedItems.some((s) => s.title === d.title),
  ) as DroppedItem[];

  const tokensUsed = selectedItems.reduce((sum, item) => sum + item.token_estimate, 0);
  const selectedAssetIds = selectedItems
    .filter((i) => i.type === "asset")
    .map((i) => `asset-${shortHash(i.item_id)}`);

  return {
    selected_items: selectedItems,
    dropped_items: droppedItems,
    selected_asset_ids: selectedAssetIds,
    rationale_trace: rationaleTrace,
    token_budget: {
      limit: TOKEN_LIMIT,
      used: tokensUsed,
      remaining: TOKEN_LIMIT - tokensUsed,
    },
  };
}

// ---------------------------------------------------------------------------
// Run events
// ---------------------------------------------------------------------------

export type RunEventType =
  | "task_created"
  | "subtask_created"
  | "curation_started"
  | "curation_completed"
  | "item_selected"
  | "item_dropped"
  | "context_confirmed"
  | "override_applied";

export interface RunEvent {
  event_id: string;
  run_id: string;
  correlation_id: string;
  task_id: string;
  subtask_id: string | null;
  snapshot_id: string | null;
  event_type: RunEventType;
  actor: "system" | "user";
  /** Machine-readable reason code, e.g. "intent_match", "low_score", "user_removed" */
  reason_code: string;
  /** Human-readable description */
  description: string;
  /** Optional ref to evidence item */
  item_id: string | null;
  item_title: string | null;
  metadata: Record<string, unknown>;
  occurred_at: string;
}

// ---------------------------------------------------------------------------
// In-memory fallback store (used when Supabase is not configured)
// ---------------------------------------------------------------------------

export interface TaskRecord {
  task_id: string;
  org_id: string;
  project_id: string;
  task_text: string;
  idempotency_key: string | null;
  status: string;
  subtasks: SubtaskPlan[];
  created_at: string;
}

export interface SubtaskRecord extends SubtaskPlan {
  curated_bundle: CuratedBundle | null;
  snapshot_id: string | null;
}

export interface SnapshotRecord {
  snapshot_id: string;
  run_id: string;
  org_id: string;
  project_id: string;
  task_id: string;
  subtask_id: string;
  context_pack_json: CuratedBundle;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Singleton store via globalThis so state is shared across all route modules
// in the same Next.js dev server process (module-level Maps are not reliable
// because Next.js can load separate instances of the same module per route).
// ---------------------------------------------------------------------------

interface FallbackStoreShape {
  tasks: Map<string, TaskRecord>;
  subtasks: Map<string, SubtaskRecord>;
  snapshots: Map<string, SnapshotRecord>;
  idempotencyIndex: Map<string, string>;
  runEvents: Map<string, RunEvent[]>; // keyed by run_id
}

declare global {
  // eslint-disable-next-line no-var
  var __orgMemoryFallbackStore: FallbackStoreShape | undefined;
}

if (!globalThis.__orgMemoryFallbackStore) {
  globalThis.__orgMemoryFallbackStore = {
    tasks: new Map<string, TaskRecord>(),
    subtasks: new Map<string, SubtaskRecord>(),
    snapshots: new Map<string, SnapshotRecord>(),
    idempotencyIndex: new Map<string, string>(),
    runEvents: new Map<string, RunEvent[]>(),
  };
}

export const fallbackStore: FallbackStoreShape = globalThis.__orgMemoryFallbackStore;

// ---------------------------------------------------------------------------
// Run event helpers
// ---------------------------------------------------------------------------

/**
 * Append one or more run events to the in-memory event log.
 * Events are grouped by run_id.
 */
export function emitRunEvents(runId: string, events: RunEvent[]): void {
  const existing = fallbackStore.runEvents.get(runId) ?? [];
  fallbackStore.runEvents.set(runId, [...existing, ...events]);
}

/**
 * Return all events for a given run_id, ordered by occurred_at ascending.
 */
export function getRunEvents(runId: string): RunEvent[] {
  return (fallbackStore.runEvents.get(runId) ?? []).slice().sort(
    (a, b) => a.occurred_at.localeCompare(b.occurred_at),
  );
}

/**
 * Return all events associated with a snapshot_id across all runs.
 */
export function getEventsBySnapshotId(snapshotId: string): RunEvent[] {
  const result: RunEvent[] = [];
  for (const events of fallbackStore.runEvents.values()) {
    for (const ev of events) {
      if (ev.snapshot_id === snapshotId) result.push(ev);
    }
  }
  return result.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
}

/**
 * Build the standard set of run events for a completed curation pass.
 * Called by the curate route after building the bundle.
 */
export function buildCurationEvents(
  runId: string,
  taskId: string,
  subtaskId: string,
  snapshotId: string,
  bundle: CuratedBundle,
  intentLabel: string,
  now: string,
): RunEvent[] {
  const corrId = `corr-${shortHash(runId + subtaskId)}`;
  const events: RunEvent[] = [];

  events.push({
    event_id: `ev-${shortHash(runId + "curation_started")}`,
    run_id: runId,
    correlation_id: corrId,
    task_id: taskId,
    subtask_id: subtaskId,
    snapshot_id: null,
    event_type: "curation_started",
    actor: "system",
    reason_code: "curation_triggered",
    description: `Curation pass started for subtask intent "${intentLabel}".`,
    item_id: null,
    item_title: null,
    metadata: { intent_label: intentLabel, store_count: 1 },
    occurred_at: now,
  });

  // Per-item selected events
  bundle.selected_items.forEach((item, idx) => {
    const trace = bundle.rationale_trace.find((r) => r.item_id === item.item_id);
    events.push({
      event_id: `ev-sel-${shortHash(item.item_id + runId)}`,
      run_id: runId,
      correlation_id: corrId,
      task_id: taskId,
      subtask_id: subtaskId,
      snapshot_id: snapshotId,
      event_type: "item_selected",
      actor: "system",
      reason_code: "intent_match",
      description: `Item "${item.title}" selected at ${trace?.retrieval_level ?? "level_2"} (score ${trace?.score ?? 0}).`,
      item_id: item.item_id,
      item_title: item.title,
      metadata: {
        item_type: item.type,
        retrieval_level: trace?.retrieval_level,
        score: trace?.score,
        token_estimate: item.token_estimate,
        position: idx,
      },
      occurred_at: now,
    });
  });

  // Per-item dropped events
  bundle.dropped_items.forEach((item) => {
    events.push({
      event_id: `ev-drop-${shortHash(item.item_id + runId)}`,
      run_id: runId,
      correlation_id: corrId,
      task_id: taskId,
      subtask_id: subtaskId,
      snapshot_id: snapshotId,
      event_type: "item_dropped",
      actor: "system",
      reason_code: "below_threshold",
      description: `Item "${item.title}" dropped: ${item.exclusion_reason}`,
      item_id: item.item_id,
      item_title: item.title,
      metadata: { item_type: item.type, exclusion_reason: item.exclusion_reason },
      occurred_at: now,
    });
  });

  events.push({
    event_id: `ev-${shortHash(runId + "curation_completed")}`,
    run_id: runId,
    correlation_id: corrId,
    task_id: taskId,
    subtask_id: subtaskId,
    snapshot_id: snapshotId,
    event_type: "curation_completed",
    actor: "system",
    reason_code: "curation_success",
    description: `Curation completed. ${bundle.selected_items.length} items selected, ${bundle.dropped_items.length} dropped. Snapshot: ${snapshotId}.`,
    item_id: null,
    item_title: null,
    metadata: {
      selected_count: bundle.selected_items.length,
      dropped_count: bundle.dropped_items.length,
      tokens_used: bundle.token_budget.used,
      token_limit: bundle.token_budget.limit,
      snapshot_id: snapshotId,
    },
    occurred_at: now,
  });

  return events;
}

/**
 * Build run events for a context-confirm operation.
 */
export function buildConfirmEvents(
  runId: string,
  taskId: string,
  subtaskId: string,
  originalSnapshotId: string,
  confirmedSnapshotId: string,
  removedCount: number,
  addedCount: number,
  overrideReason: string,
  now: string,
): RunEvent[] {
  const corrId = `corr-${shortHash(runId + subtaskId + "confirm")}`;
  const events: RunEvent[] = [];

  if (removedCount > 0 || addedCount > 0) {
    events.push({
      event_id: `ev-${shortHash(runId + "override_applied")}`,
      run_id: runId,
      correlation_id: corrId,
      task_id: taskId,
      subtask_id: subtaskId,
      snapshot_id: confirmedSnapshotId,
      event_type: "override_applied",
      actor: "user",
      reason_code: "user_override",
      description: `User applied overrides: ${removedCount} removed, ${addedCount} added. Reason: "${overrideReason || "none provided"}".`,
      item_id: null,
      item_title: null,
      metadata: {
        removed_count: removedCount,
        added_count: addedCount,
        override_reason: overrideReason,
        original_snapshot_id: originalSnapshotId,
      },
      occurred_at: now,
    });
  }

  events.push({
    event_id: `ev-${shortHash(runId + "context_confirmed")}`,
    run_id: runId,
    correlation_id: corrId,
    task_id: taskId,
    subtask_id: subtaskId,
    snapshot_id: confirmedSnapshotId,
    event_type: "context_confirmed",
    actor: "user",
    reason_code: "user_confirmed",
    description: `Context pack confirmed. Confirmed snapshot: ${confirmedSnapshotId}.`,
    item_id: null,
    item_title: null,
    metadata: {
      original_snapshot_id: originalSnapshotId,
      confirmed_snapshot_id: confirmedSnapshotId,
    },
    occurred_at: now,
  });

  return events;
}
