/**
 * lib/store-router.ts — Session 8e
 *
 * Memory-store routing catalog and scoring layer.
 *
 * Implements Design Decision 10b:
 *   - Parse task intent and entities from task text (rule-based, deterministic).
 *   - ACL-filter candidate stores from the hierarchy catalog.
 *   - Score candidates by intent match, hierarchy proximity, freshness, and
 *     historical helpfulness.
 *   - Return a ranked store shortlist with per-store evidence targets and token
 *     budget estimates.
 *   - Enforce anti-bloat policy: per-subtask store-count cap (max 3 by default),
 *     per-subtask memory-file budget check, and cross-store deduplication flag.
 *   - Emit structured routing events for every scoring and filtering decision.
 *
 * Scoring formula (deterministic for the same inputs):
 *   score = 0.40 * intent_match
 *         + 0.25 * hierarchy_proximity
 *         + 0.20 * freshness
 *         + 0.15 * historical_helpfulness
 *
 * Tie-breaking: memory_store_id ascending (deterministic).
 *
 * ACL eligibility rule (prototype):
 *   A store is eligible if its acl_scope matches the caller's acl_scope
 *   exactly, OR if the caller's acl_scope begins with the store's acl_scope
 *   prefix (e.g. "org:acme:legal" satisfies "org:acme").
 *
 * Budget escalation rule:
 *   Estimated tokens = sum of (store.memory_count * TOKENS_PER_MEMORY_FILE)
 *   across the capped shortlist. If that exceeds
 *   (memory_file_budget * TOKENS_PER_MEMORY_FILE), set budget_status =
 *   "exceeded" and populate escalation_message — never silently expand.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Rough token estimate per memory file (used for budget projection). */
export const TOKENS_PER_MEMORY_FILE = 1_000;

/** Default store-count cap per subtask. */
export const DEFAULT_MAX_STORES = 3;

/** Default memory-file budget per subtask. */
export const DEFAULT_MEMORY_FILE_BUDGET = 20;

// ---------------------------------------------------------------------------
// Intent keyword map
// ---------------------------------------------------------------------------

const INTENT_KEYWORDS: Record<string, string[]> = {
  financial_analysis: [
    "npv", "finance", "cost", "budget", "valuation", "capex", "opex",
    "depreciation", "irr", "cashflow", "discount rate", "hurdle", "q3",
    "fy26", "infrastructure investment", "board approval",
  ],
  vendor_evaluation: [
    "vendor", "supplier", "procurement", "rfp", "proposal", "approve",
    "approval", "sourcing", "cloudA", "cloudB", "cloudC", "comparison",
  ],
  compliance_check: [
    "compliance", "gdpr", "ccpa", "regulation", "legal", "privacy",
    "dpa", "data protection", "ico", "retention", "personal data",
  ],
  risk_assessment: [
    "risk", "risks", "exposure", "liability", "due diligence",
    "acquisition", "targetco", "m&a", "deal-breaker", "key risk",
  ],
  operations_review: [
    "incident", "runbook", "ops", "on-call", "oncall", "alert", "sla",
    "postmortem", "outage", "502", "504", "platform", "gateway",
  ],
  policy_review: [
    "policy", "process", "procedure", "guideline", "ai usage", "handbook",
    "approval process", "org-wide",
  ],
  technical_assessment: [
    "tech", "technology", "stack", "architecture", "system",
    "infrastructure", "platform", "api", "database", "repo",
  ],
  context_synthesis: [
    "summary", "overview", "report", "brief", "background",
    "context", "glossary", "synthesize", "general",
  ],
};

// Human-readable label per intent
const INTENT_LABELS: Record<string, string> = {
  financial_analysis: "Financial Analysis",
  vendor_evaluation: "Vendor Evaluation",
  compliance_check: "Compliance Check",
  risk_assessment: "Risk Assessment",
  operations_review: "Operations Review",
  policy_review: "Policy Review",
  technical_assessment: "Technical Assessment",
  context_synthesis: "Context Synthesis",
};

// Evidence hints per intent (token-budget-aware shortlist per store)
const INTENT_EVIDENCE_HINTS: Record<string, string[]> = {
  financial_analysis: [
    "infrastructure-investment-business-case-q3-fy26",
    "cfo-q3-guidance",
    "board-approval-memo-q2-fy26",
    "infrastructure-depreciation-schedule",
  ],
  vendor_evaluation: [
    "vendor-comparison-matrix",
    "it-infrastructure-rfp-2026",
    "vendor-cloudA-proposal",
    "vendor-cloudB-proposal",
  ],
  compliance_check: [
    "gdpr-compliance-checklist-v3",
    "data-retention-schedule",
    "dpa-template-v2",
    "privacy-incident-response-playbook",
  ],
  risk_assessment: [
    "targetco-key-risks-memo",
    "targetco-financial-summary-fy25",
    "targetco-tech-stack-assessment",
    "targetco-ip-registry",
  ],
  operations_review: [
    "api-gateway-runbook",
    "on-call-rotation-q2-2026",
    "platform-sla-commitments",
    "incident-postmortem-2026-03-15",
  ],
  policy_review: [
    "org-ai-usage-policy",
    "org-vendor-approval-process",
    "org-data-classification-policy",
    "org-glossary",
  ],
  technical_assessment: [
    "targetco-tech-stack-assessment",
    "alert-thresholds-config",
    "api-gateway-runbook",
    "platform-services-repo",
  ],
  context_synthesis: [
    "org-glossary",
    "org-ai-usage-policy",
    "org-data-classification-policy",
    "org-vendor-approval-process",
  ],
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RoutingStoreMetadata {
  memory_store_id: string;
  project_id: string;
  name: string;
  description: string;
  owner_team: string;
  node_type: string;
  depth: number;
  path_slug: string;
  acl_scope: string;
  allowed_roles: string[];
  data_classification: string;
  top_topics: string[];
  top_entities: string[];
  supported_task_intents: string[];
  staleness_score: number;
  coverage_score: number;
  contradiction_risk_score: number;
  memory_count: number;
  total_bytes: number;
  historical_helpfulness_by_intent: Record<string, number>;
  historical_selection_rate: number;
  historical_override_rate: number;
  default_attach_mode: string;
  attach_priority: number;
  last_updated_at?: string;
}

export interface ScoreBreakdown {
  intent_match: number;
  hierarchy_proximity: number;
  freshness: number;
  historical_helpfulness: number;
}

export interface RoutedStore {
  rank: number;
  memory_store_id: string;
  project_id: string;
  name: string;
  score: number;
  score_breakdown: ScoreBreakdown;
  attach_mode: string;
  evidence_targets: string[];
  token_budget_estimate: number;
  acl_eligible: true;
}

export interface RoutingEvent {
  event_type: string;
  store_id?: string;
  detail: string;
  occurred_at: string;
}

export interface RoutingResult {
  routing_id: string;
  task_intent: string;
  task_intent_label: string;
  task_entities: string[];
  ranked_stores: RoutedStore[];
  applied_cap: number;
  total_candidates: number;
  acl_filtered_count: number;
  budget_status: "ok" | "exceeded";
  escalation_message: string | null;
  routing_events: RoutingEvent[];
  created_at: string;
}

export interface RouteStoresParams {
  routing_id: string;
  task_text: string;
  project_id: string;       // anchoring project
  org_id: string;
  acl_scope: string;        // caller's ACL scope
  max_stores?: number;      // default DEFAULT_MAX_STORES
  memory_file_budget?: number; // default DEFAULT_MEMORY_FILE_BUDGET
}

// ---------------------------------------------------------------------------
// Static fallback catalog
// Mirrors the seeded memory_store_catalog rows so the API works without DB.
// ---------------------------------------------------------------------------

export const STATIC_STORE_CATALOG: RoutingStoreMetadata[] = [
  {
    memory_store_id: "00000000-0000-0000-0001-000000000001",
    project_id: "proj-finance-infra-q3",
    name: "Finance — Infra Q3 FY26 Memory Store",
    description:
      "Asset memories for Q3 FY26 infrastructure investment: NPV model, vendor proposals, CFO guidance, board approvals.",
    owner_team: "Finance",
    node_type: "project",
    depth: 1,
    path_slug: "org/finance/proj-finance-infra-q3",
    acl_scope: "org:acme",
    allowed_roles: ["finance", "infrastructure"],
    data_classification: "confidential",
    top_topics: ["infrastructure", "vendor", "npv", "capex", "budget", "q3", "fy26"],
    top_entities: ["CloudA", "CloudB", "CloudC", "CFO"],
    supported_task_intents: ["financial_analysis", "vendor_evaluation", "policy_review"],
    staleness_score: 0.10,
    coverage_score: 0.90,
    contradiction_risk_score: 0.05,
    memory_count: 8,
    total_bytes: 120000,
    historical_helpfulness_by_intent: {
      financial_analysis: 0.92,
      vendor_evaluation: 0.85,
      policy_review: 0.30,
      risk_assessment: 0.40,
      compliance_check: 0.20,
      operations_review: 0.10,
      technical_assessment: 0.35,
      context_synthesis: 0.25,
    },
    historical_selection_rate: 0.75,
    historical_override_rate: 0.10,
    default_attach_mode: "read_write",
    attach_priority: 10,
  },
  {
    memory_store_id: "00000000-0000-0000-0001-000000000002",
    project_id: "proj-compliance-privacy",
    name: "Legal/Compliance — Data Privacy Memory Store",
    description:
      "Asset memories for GDPR, CCPA, DPA templates, data-retention schedules, incident response playbook.",
    owner_team: "Legal",
    node_type: "project",
    depth: 1,
    path_slug: "org/legal/proj-compliance-privacy",
    acl_scope: "org:acme",
    allowed_roles: ["legal", "compliance", "privacy"],
    data_classification: "confidential",
    top_topics: ["gdpr", "ccpa", "dpa", "data-retention", "privacy", "incident-response"],
    top_entities: ["ICO", "GDPR", "CCPA"],
    supported_task_intents: ["compliance_check", "policy_review", "vendor_evaluation"],
    staleness_score: 0.15,
    coverage_score: 0.85,
    contradiction_risk_score: 0.10,
    memory_count: 7,
    total_bytes: 95000,
    historical_helpfulness_by_intent: {
      compliance_check: 0.95,
      policy_review: 0.80,
      vendor_evaluation: 0.60,
      risk_assessment: 0.55,
      financial_analysis: 0.15,
      operations_review: 0.20,
      technical_assessment: 0.25,
      context_synthesis: 0.40,
    },
    historical_selection_rate: 0.70,
    historical_override_rate: 0.08,
    default_attach_mode: "read_only",
    attach_priority: 8,
  },
  {
    memory_store_id: "00000000-0000-0000-0001-000000000003",
    project_id: "proj-eng-incident-ops",
    name: "Engineering — Incident Ops Memory Store",
    description:
      "Asset memories for runbooks, on-call rotations, SLA commitments, alert-threshold config, incident postmortems.",
    owner_team: "Engineering",
    node_type: "project",
    depth: 1,
    path_slug: "org/engineering/proj-eng-incident-ops",
    acl_scope: "org:acme",
    allowed_roles: ["engineering", "operations", "incidents"],
    data_classification: "internal",
    top_topics: ["runbook", "incident", "on-call", "sla", "alert", "postmortem", "platform"],
    top_entities: ["API Gateway", "Platform Services"],
    supported_task_intents: ["operations_review", "technical_assessment", "policy_review"],
    staleness_score: 0.20,
    coverage_score: 0.80,
    contradiction_risk_score: 0.15,
    memory_count: 9,
    total_bytes: 140000,
    historical_helpfulness_by_intent: {
      operations_review: 0.93,
      technical_assessment: 0.75,
      policy_review: 0.40,
      risk_assessment: 0.50,
      compliance_check: 0.30,
      financial_analysis: 0.10,
      vendor_evaluation: 0.15,
      context_synthesis: 0.30,
    },
    historical_selection_rate: 0.72,
    historical_override_rate: 0.12,
    default_attach_mode: "read_write",
    attach_priority: 9,
  },
  {
    memory_store_id: "00000000-0000-0000-0001-000000000004",
    project_id: "proj-corpdev-targetco-dd",
    name: "CorpDev — TargetCo Due Diligence Memory Store",
    description:
      "Asset memories for TargetCo M&A due diligence: financials, tech-stack assessment, key-risks memo, IP registry.",
    owner_team: "Corporate Development",
    node_type: "project",
    depth: 1,
    path_slug: "org/corpdev/proj-corpdev-targetco-dd",
    acl_scope: "org:acme",
    allowed_roles: ["corporate-development", "due-diligence"],
    data_classification: "restricted",
    top_topics: ["targetco", "acquisition", "due-diligence", "valuation", "risk", "ip"],
    top_entities: ["TargetCo"],
    supported_task_intents: ["risk_assessment", "financial_analysis", "technical_assessment"],
    staleness_score: 0.25,
    coverage_score: 0.75,
    contradiction_risk_score: 0.20,
    memory_count: 6,
    total_bytes: 85000,
    historical_helpfulness_by_intent: {
      risk_assessment: 0.90,
      financial_analysis: 0.88,
      technical_assessment: 0.70,
      vendor_evaluation: 0.30,
      compliance_check: 0.40,
      policy_review: 0.25,
      operations_review: 0.15,
      context_synthesis: 0.35,
    },
    historical_selection_rate: 0.65,
    historical_override_rate: 0.15,
    default_attach_mode: "read_only",
    attach_priority: 7,
  },
  {
    memory_store_id: "00000000-0000-0000-0001-000000000005",
    project_id: "proj-org-shared",
    name: "Org Shared Policies Memory Store",
    description:
      "Asset memories for org-wide shared policies: glossary, data-classification policy, AI usage policy, vendor approval.",
    owner_team: "Platform",
    node_type: "project",
    depth: 0,
    path_slug: "org/shared/proj-org-shared",
    acl_scope: "org:acme",
    allowed_roles: ["policies", "org-wide", "governance"],
    data_classification: "internal",
    top_topics: ["policy", "vendor-approval", "data-classification", "ai-usage", "glossary"],
    top_entities: ["Acme"],
    supported_task_intents: ["policy_review", "compliance_check", "vendor_evaluation", "context_synthesis"],
    staleness_score: 0.05,
    coverage_score: 0.95,
    contradiction_risk_score: 0.02,
    memory_count: 4,
    total_bytes: 45000,
    historical_helpfulness_by_intent: {
      policy_review: 0.88,
      compliance_check: 0.72,
      vendor_evaluation: 0.80,
      context_synthesis: 0.90,
      risk_assessment: 0.45,
      financial_analysis: 0.20,
      operations_review: 0.35,
      technical_assessment: 0.30,
    },
    historical_selection_rate: 0.80,
    historical_override_rate: 0.05,
    default_attach_mode: "read_only",
    attach_priority: 6,
  },
];

// ---------------------------------------------------------------------------
// Intent parsing
// ---------------------------------------------------------------------------

/**
 * Parses task text into a primary intent and a list of extracted entities.
 * Deterministic: same input always returns the same output.
 */
export function parseTaskIntent(taskText: string): {
  intent: string;
  intent_label: string;
  entities: string[];
} {
  const lower = taskText.toLowerCase();

  // Score each intent by keyword hits
  const scored = Object.entries(INTENT_KEYWORDS).map(([intent, keywords]) => {
    const hits = keywords.filter((kw) => lower.includes(kw));
    return { intent, hits };
  });

  // Sort by hit count descending, then intent name for determinism
  scored.sort((a, b) => b.hits.length - a.hits.length || a.intent.localeCompare(b.intent));

  const topIntent = scored[0].hits.length > 0 ? scored[0].intent : "context_synthesis";

  // Extract entities: matched keywords that look like named concepts
  // (unique, deduped, max 10)
  const entityKeywords = scored
    .filter((s) => s.hits.length > 0)
    .flatMap((s) => s.hits)
    .filter((kw) => kw.length > 3) // skip very short keywords
    .slice(0, 10);
  const entities = Array.from(new Set(entityKeywords));

  return {
    intent: topIntent,
    intent_label: INTENT_LABELS[topIntent] ?? topIntent,
    entities,
  };
}

// ---------------------------------------------------------------------------
// ACL eligibility check
// ---------------------------------------------------------------------------

/**
 * Returns true if a store is ACL-eligible for the given caller scope.
 *
 * Rules (prototype):
 *   - Exact match: callerAclScope === store.acl_scope
 *   - Prefix match: callerAclScope starts with store.acl_scope + ":"
 *     (e.g. "org:acme:legal" satisfies "org:acme")
 *   - Org-wide wildcard: store.acl_scope === "public"
 */
function isAclEligible(store: RoutingStoreMetadata, callerAclScope: string): boolean {
  if (store.acl_scope === "public") return true;
  if (store.acl_scope === callerAclScope) return true;
  if (callerAclScope.startsWith(store.acl_scope + ":")) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * Computes intent-match score (0–1) for a store against a detected intent.
 *
 * Score = 1.0 if intent is in store.supported_task_intents
 *       + partial credit for top_topics keyword overlap with intent keywords
 *       → clamped to [0, 1].
 */
function computeIntentMatch(store: RoutingStoreMetadata, intent: string): number {
  const supported = store.supported_task_intents.includes(intent) ? 0.8 : 0.0;
  // Bonus for topic keyword overlap
  const intentKws = INTENT_KEYWORDS[intent] ?? [];
  const topicOverlap =
    store.top_topics.filter((t) => intentKws.some((kw) => t.includes(kw) || kw.includes(t))).length /
    Math.max(intentKws.length, 1);
  return Math.min(1.0, supported + topicOverlap * 0.2);
}

/**
 * Computes hierarchy proximity score (0–1).
 *
 * 1.0 = the store belongs to the anchoring project (same project).
 * 0.7 = org-level store (depth 0) — available to all.
 * 0.5 = peer project at same depth.
 * Decays by 0.1 per extra depth step away.
 */
function computeHierarchyProximity(
  store: RoutingStoreMetadata,
  anchorProjectId: string,
): number {
  if (store.project_id === anchorProjectId) return 1.0;
  if (store.depth === 0) return 0.7; // org-level shared store
  return 0.5; // peer project
}

/**
 * Computes the final weighted score for a store.
 *
 * score = 0.40 * intent_match
 *       + 0.25 * hierarchy_proximity
 *       + 0.20 * freshness          (1 − staleness_score)
 *       + 0.15 * historical_helpfulness
 */
function computeScore(
  store: RoutingStoreMetadata,
  intent: string,
  anchorProjectId: string,
): { score: number; breakdown: ScoreBreakdown } {
  const intent_match = computeIntentMatch(store, intent);
  const hierarchy_proximity = computeHierarchyProximity(store, anchorProjectId);
  const freshness = 1 - store.staleness_score;
  const historical_helpfulness =
    store.historical_helpfulness_by_intent[intent] ?? store.historical_selection_rate;

  const score =
    0.40 * intent_match +
    0.25 * hierarchy_proximity +
    0.20 * freshness +
    0.15 * historical_helpfulness;

  return {
    score: parseFloat(score.toFixed(4)),
    breakdown: {
      intent_match: parseFloat(intent_match.toFixed(4)),
      hierarchy_proximity: parseFloat(hierarchy_proximity.toFixed(4)),
      freshness: parseFloat(freshness.toFixed(4)),
      historical_helpfulness: parseFloat(historical_helpfulness.toFixed(4)),
    },
  };
}

// ---------------------------------------------------------------------------
// Evidence target builder
// ---------------------------------------------------------------------------

function buildEvidenceTargets(store: RoutingStoreMetadata, intent: string): string[] {
  const intentHints = INTENT_EVIDENCE_HINTS[intent] ?? [];
  // Prefer hints that relate to this store's top topics
  return intentHints.slice(0, 4); // cap at 4 evidence targets per store
}

// ---------------------------------------------------------------------------
// Main routing function
// ---------------------------------------------------------------------------

/**
 * Routes stores for a task: ACL-filter → score → rank → cap → budget-check.
 * Deterministic: same (task_text, project_id, acl_scope, stores) → same result.
 */
export function routeStores(
  params: RouteStoresParams,
  allStores: RoutingStoreMetadata[],
): RoutingResult {
  const {
    routing_id,
    task_text,
    project_id,
    acl_scope,
    max_stores = DEFAULT_MAX_STORES,
    memory_file_budget = DEFAULT_MEMORY_FILE_BUDGET,
  } = params;

  const now = new Date().toISOString();
  const events: RoutingEvent[] = [];

  // 1. Parse intent
  const { intent, intent_label, entities } = parseTaskIntent(task_text);
  events.push({
    event_type: "intent_parsed",
    detail: `Detected intent: "${intent}" (${intent_label}). Entities: [${entities.join(", ")}].`,
    occurred_at: now,
  });

  // 2. ACL filter
  const aclEligible: RoutingStoreMetadata[] = [];
  const aclRejected: RoutingStoreMetadata[] = [];
  for (const store of allStores) {
    if (isAclEligible(store, acl_scope)) {
      aclEligible.push(store);
    } else {
      aclRejected.push(store);
      events.push({
        event_type: "acl_rejected",
        store_id: store.memory_store_id,
        detail: `Store "${store.name}" rejected: acl_scope "${store.acl_scope}" not eligible for caller scope "${acl_scope}".`,
        occurred_at: now,
      });
    }
  }
  events.push({
    event_type: "acl_filter_complete",
    detail: `ACL filter: ${aclEligible.length} eligible, ${aclRejected.length} rejected.`,
    occurred_at: now,
  });

  // 3. Score eligible stores
  const scored = aclEligible.map((store) => {
    const { score, breakdown } = computeScore(store, intent, project_id);
    events.push({
      event_type: "store_scored",
      store_id: store.memory_store_id,
      detail: `Score: ${score} (intent_match=${breakdown.intent_match}, hierarchy=${breakdown.hierarchy_proximity}, freshness=${breakdown.freshness}, helpfulness=${breakdown.historical_helpfulness}).`,
      occurred_at: now,
    });
    return { store, score, breakdown };
  });

  // 4. Sort: score descending, then memory_store_id ascending for determinism
  scored.sort(
    (a, b) =>
      b.score - a.score || a.store.memory_store_id.localeCompare(b.store.memory_store_id),
  );

  // 5. Apply store-count cap
  const capped = scored.slice(0, max_stores);
  const capDropped = scored.slice(max_stores);
  events.push({
    event_type: "cap_applied",
    detail: `Store-count cap ${max_stores} applied. Selected ${capped.length} store(s); dropped ${capDropped.length} store(s) below cap.`,
    occurred_at: now,
  });
  for (const d of capDropped) {
    events.push({
      event_type: "store_cap_dropped",
      store_id: d.store.memory_store_id,
      detail: `"${d.store.name}" dropped by store-count cap (score: ${d.score}).`,
      occurred_at: now,
    });
  }

  // 6. Build ranked_stores
  const rankedStores: RoutedStore[] = capped.map((s, i) => ({
    rank: i + 1,
    memory_store_id: s.store.memory_store_id,
    project_id: s.store.project_id,
    name: s.store.name,
    score: s.score,
    score_breakdown: s.breakdown,
    attach_mode: s.store.default_attach_mode,
    evidence_targets: buildEvidenceTargets(s.store, intent),
    token_budget_estimate: s.store.memory_count * TOKENS_PER_MEMORY_FILE,
    acl_eligible: true,
  }));

  // 7. Budget check
  const totalTokens = rankedStores.reduce((sum, s) => sum + s.token_budget_estimate, 0);
  const budgetLimit = memory_file_budget * TOKENS_PER_MEMORY_FILE;
  const budgetStatus: "ok" | "exceeded" = totalTokens > budgetLimit ? "exceeded" : "ok";
  const escalationMessage =
    budgetStatus === "exceeded"
      ? `Total estimated token load (${totalTokens.toLocaleString()} tokens across ${capped.length} store(s)) exceeds the memory-file budget of ${budgetLimit.toLocaleString()} tokens (${memory_file_budget} files × ${TOKENS_PER_MEMORY_FILE} tokens/file). Split into sequential micro-subtasks or reduce max_stores to stay within budget.`
      : null;

  if (budgetStatus === "exceeded") {
    events.push({
      event_type: "budget_exceeded",
      detail: `Budget exceeded: estimated ${totalTokens} tokens > limit ${budgetLimit}. Escalation required.`,
      occurred_at: now,
    });
  } else {
    events.push({
      event_type: "budget_ok",
      detail: `Budget check passed: estimated ${totalTokens} tokens ≤ limit ${budgetLimit}.`,
      occurred_at: now,
    });
  }

  return {
    routing_id,
    task_intent: intent,
    task_intent_label: intent_label,
    task_entities: entities,
    ranked_stores: rankedStores,
    applied_cap: max_stores,
    total_candidates: allStores.length,
    acl_filtered_count: aclRejected.length,
    budget_status: budgetStatus,
    escalation_message: escalationMessage,
    routing_events: events,
    created_at: now,
  };
}
