/**
 * lib/specific-file-picker.ts — Session 11
 *
 * Level 2 specific-file picker.
 *
 * Given task text and an optional project scope, this module:
 *   1. Fetches all Level 2 evidence items for the project from the DB
 *      (or falls back to the static in-memory corpus).
 *   2. Applies rule-based specificity rules to identify mandatory files
 *      (e.g., the business-case file for NPV tasks, the runbook for
 *      API gateway incidents).
 *   3. Scores remaining Level 2 items by keyword and path matching
 *      against the task text (no LLM calls, no embedding models).
 *   4. Returns a SpecificFilePickResult with:
 *        forced_inclusions          — files required by fired rules and found
 *        missing_required_patterns  — patterns mandated but not found
 *        selected                   — forced + top-scored items (up to limit)
 *        dropped                    — scored but excluded, with reasons
 *        specificity_enforced       — true when at least one rule fired
 *
 * Design constraints:
 *   - No per-query LLM calls.
 *   - No embedding models or vector indexes.
 *   - All scoring is rule-based + keyword/path matching.
 *   - Deterministic output for identical inputs (tie-break by evidence_id asc).
 */

import { detectIntents, INTENT_KEYWORDS } from "./retrieval-ranker";
import { listEvidence, EvidenceItem } from "./evidence-resolver";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_L2_LIMIT = 10;
export const MAX_L2_LIMIT = 50;

// ---------------------------------------------------------------------------
// Specificity rules
// ---------------------------------------------------------------------------

interface SpecificityRule {
  id: string;
  /** Returns true when this rule should fire for the given task + intents. */
  condition: (taskTextLower: string, intents: string[]) => boolean;
  /**
   * File path / title substrings that this rule mandates.
   * Matched case-insensitively against file_path_or_url and title.
   */
  target_file_patterns: string[];
  /** Human-readable explanation surfaced in rationale. */
  reason: string;
}

export const SPECIFICITY_RULES: SpecificityRule[] = [
  {
    id: "npv-business-case",
    condition: (t, intents) =>
      intents.includes("financial_analysis") &&
      /\b(npv|irr|discount rate|hurdle|cashflow|investment proceed|q3 infra)\b/.test(t),
    target_file_patterns: [
      "infrastructure-investment-business-case",
      "cfo-q3-guidance",
    ],
    reason:
      "NPV/IRR analysis requires the business-case document (cashflow projections, IRR, recommendation) and the CFO discount rate guidance.",
  },
  {
    id: "vendor-selection-rfp",
    condition: (t, intents) =>
      intents.includes("vendor_evaluation") &&
      /\b(vendor|rfp|proposal|select|comparison|cloud[abc])\b/.test(t),
    target_file_patterns: [
      "vendor-comparison-matrix",
      "it-infrastructure-rfp",
    ],
    reason:
      "Vendor selection requires the comparison matrix and the RFP scoring rubric.",
  },
  {
    id: "data-retention-lookup",
    condition: (t, intents) =>
      intents.includes("compliance_check") &&
      /\b(retention|data retention|retention period|how long)\b/.test(t),
    target_file_patterns: ["data-retention-schedule"],
    reason:
      "Data retention query requires the retention schedule document.",
  },
  {
    id: "dpa-drafting",
    condition: (t, intents) =>
      intents.includes("compliance_check") &&
      /\b(dpa|data processing agreement|draft|processing agreement)\b/.test(t),
    target_file_patterns: ["dpa-template", "gdpr-compliance-checklist"],
    reason:
      "DPA drafting requires the DPA template and the GDPR compliance checklist.",
  },
  {
    id: "api-gateway-incident",
    condition: (t, intents) =>
      intents.includes("operations_review") &&
      /\b(api.{0,15}gateway|502|504|production|immediate steps|returning errors)\b/.test(t),
    target_file_patterns: ["api-gateway-runbook"],
    reason:
      "An API gateway incident requires the runbook for immediate response steps.",
  },
  {
    id: "on-call-sla",
    condition: (t, intents) =>
      intents.includes("operations_review") &&
      /\b(on.?call|oncall|who is on|sla commitment|at risk)\b/.test(t),
    target_file_patterns: ["on-call-rotation", "platform-sla-commitments"],
    reason:
      "On-call and SLA query requires the rotation schedule and the customer SLA commitments document.",
  },
  {
    id: "alert-drift",
    condition: (t, intents) =>
      intents.includes("operations_review") &&
      /\b(alert.{0,20}threshold|thresholds.{0,20}changed|drift|last 30 days)\b/.test(t),
    target_file_patterns: [
      "alert-thresholds-config",
      "api-gateway-runbook",
      "platform-services-repo",
    ],
    reason:
      "Alert drift analysis requires the alert thresholds config, the incident runbook, and the git repository.",
  },
  {
    id: "targetco-key-risks",
    condition: (t, intents) =>
      (intents.includes("risk_assessment") || intents.includes("technical_assessment")) &&
      /\b(targetco|acqui|deal.?breaker|top risks|acquiring)\b/.test(t),
    target_file_patterns: [
      "targetco-key-risks-memo",
      "targetco-financial-summary",
    ],
    reason:
      "TargetCo acquisition risk assessment requires the risks memo and the audited financials.",
  },
  {
    id: "targetco-valuation",
    condition: (t, intents) =>
      (intents.includes("risk_assessment") || intents.includes("financial_analysis")) &&
      /\b(valuation|valuat|comparable|ev.?revenue|ev.?ebitda|multiples|reasonable range)\b/.test(
        t,
      ),
    target_file_patterns: [
      "comparable-transaction-analysis",
      "targetco-financial-summary",
    ],
    reason:
      "Valuation requires the comparable transaction analysis and TargetCo audited financials.",
  },
  {
    id: "vendor-compliance-cross-project",
    condition: (t, intents) =>
      intents.includes("vendor_evaluation") &&
      /\b(data classification|vendor approval|handling requirements|cloudb.{0,30}meet|compliance.{0,30}vendor)\b/.test(
        t,
      ),
    target_file_patterns: [
      "vendor-cloudB-proposal",
      "org-data-classification-policy",
      "vendor-data-handling-requirements",
    ],
    reason:
      "Vendor compliance check requires the vendor proposal, the data classification policy, and the vendor data handling requirements.",
  },
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PickedFile {
  evidence_id: string;
  project_id: string;
  evidence_type: string;
  retrieval_level: "level_2";
  title: string;
  summary_snippet: string;
  wiki_page_slug: string | null;
  file_path_or_url: string | null;
  asset_id: string | null;
  acl_scope: string;
  hierarchy_path: string;
  lineage_chain: string[];
  keyword_hints: string[];
  trust_score: number;
  /** Combined file-relevance score (0–1). Forced items receive score=1.0. */
  score: number;
  /** True when a specificity rule required this file. */
  forced: boolean;
  /** The rule id that forced this inclusion, or null if not forced. */
  forced_by_rule: string | null;
  /** Human-readable inclusion rationale. */
  rationale: string;
}

export interface DroppedFile {
  evidence_id: string;
  title: string;
  file_path_or_url: string | null;
  score: number;
  exclusion_reason: string;
}

export interface SpecificFilePickResult {
  task_text: string;
  project_id: string | null;
  intent_classes: string[];
  /** True if at least one specificity rule's condition fired. */
  specificity_enforced: boolean;
  /** Files identified by fired rules and found among Level 2 candidates. */
  forced_inclusions: PickedFile[];
  /**
   * File patterns mandated by fired rules but not present in the Level 2
   * candidate set (the file may not have been ingested yet).
   */
  missing_required_patterns: string[];
  /** All selected files: forced first, then top-scored, up to `limit`. */
  selected: PickedFile[];
  /** Scored but excluded files with exclusion reasons. */
  dropped: DroppedFile[];
  total_candidates: number;
}

export interface SpecificFilePickOptions {
  project_id?: string;
  acl_scope?: string;
  /** Max files to return in `selected` (default 10, max 50). */
  limit?: number;
  /**
   * When provided, only consider evidence items with these IDs.
   * Useful when Level 0/1 retrieval has already narrowed the candidate set.
   */
  candidate_evidence_ids?: string[];
}

// ---------------------------------------------------------------------------
// Internal: file-relevance scoring (no LLM, no embeddings)
// ---------------------------------------------------------------------------

/**
 * Compute a relevance score (0–1) for a Level 2 file against a task.
 *
 * Combines:
 *   - Keyword hint overlap: fraction of keyword_hints present in task text.
 *   - Intent keyword alignment: fraction of INTENT_KEYWORDS for detected
 *     intents appearing in item title / path / snippet.
 *   - Path match: significant words (≥4 chars) from task appearing in
 *     file_path_or_url or title.
 *
 * Formula: 0.6 * max(kwScore, intentScore) + 0.4 * pathScore
 */
function computeFileScore(
  item: EvidenceItem,
  taskTextLower: string,
  detectedIntents: string[],
): number {
  // 1. Keyword hint overlap
  let kwMatchCount = 0;
  for (const hint of item.keyword_hints) {
    if (hint && taskTextLower.includes(hint.toLowerCase())) kwMatchCount++;
  }
  const kwScore =
    item.keyword_hints.length > 0 ? kwMatchCount / item.keyword_hints.length : 0;

  // 2. Intent keyword alignment against item title + path + snippet
  let intentScore = 0;
  if (detectedIntents.length > 0) {
    const itemText = (
      item.title +
      " " +
      (item.file_path_or_url ?? "") +
      " " +
      item.summary_snippet
    ).toLowerCase();
    let topMatchCount = 0;
    for (const intent of detectedIntents.slice(0, 3)) {
      const intentKws = INTENT_KEYWORDS[intent] ?? [];
      let matches = 0;
      for (const kw of intentKws) {
        if (itemText.includes(kw)) matches++;
      }
      topMatchCount = Math.max(topMatchCount, matches);
    }
    intentScore = Math.min(1.0, topMatchCount / 5.0);
  }

  // 3. Path match: significant task words appearing in file path or title
  const pathText = (item.file_path_or_url ?? item.title ?? "").toLowerCase();
  const taskWords = taskTextLower
    .split(/\W+/)
    .filter((w) => w.length >= 4)
    .slice(0, 20); // cap to avoid excessive iteration
  let pathMatchCount = 0;
  for (const word of taskWords) {
    if (pathText.includes(word)) pathMatchCount++;
  }
  const pathScore =
    taskWords.length > 0
      ? Math.min(1.0, pathMatchCount / Math.min(taskWords.length, 5))
      : 0;

  return 0.6 * Math.max(kwScore, intentScore) + 0.4 * pathScore;
}

/**
 * Returns true if the evidence item matches a file pattern.
 * Matches case-insensitively against file_path_or_url and title.
 */
function itemMatchesPattern(item: EvidenceItem, pattern: string): boolean {
  const p = pattern.toLowerCase();
  return (
    (item.file_path_or_url != null &&
      item.file_path_or_url.toLowerCase().includes(p)) ||
    item.title.toLowerCase().includes(p)
  );
}

// ---------------------------------------------------------------------------
// Core: pickSpecificFiles
// ---------------------------------------------------------------------------

/**
 * Pick specific Level 2 files for a task.
 *
 * Uses rule-based specificity enforcement (no LLM, no embedding models).
 * Forced inclusions appear first in `selected`; remaining slots are filled
 * by the highest-scoring non-forced candidates.
 */
export async function pickSpecificFiles(
  taskText: string,
  options: SpecificFilePickOptions = {},
): Promise<SpecificFilePickResult> {
  const limit = Math.min(options.limit ?? DEFAULT_L2_LIMIT, MAX_L2_LIMIT);
  const taskTextLower = taskText.toLowerCase();
  const detectedIntents = detectIntents(taskText);

  // ── 1. Fetch Level 2 candidates ──────────────────────────────────────────
  const { data: candidates } = await listEvidence({
    retrieval_level: "level_2",
    project_id: options.project_id,
    acl_scope: options.acl_scope,
    limit: 200, // fetch all; re-rank and cap in-process
  });

  // Optional: filter to a pre-selected candidate ID set
  const filtered =
    options.candidate_evidence_ids && options.candidate_evidence_ids.length > 0
      ? candidates.filter((item) =>
          options.candidate_evidence_ids!.includes(item.evidence_id),
        )
      : candidates;

  // ── 2. Apply specificity rules ────────────────────────────────────────────
  const firedRules: SpecificityRule[] = [];
  const forcedPatterns: string[] = [];

  for (const rule of SPECIFICITY_RULES) {
    if (rule.condition(taskTextLower, detectedIntents)) {
      firedRules.push(rule);
      for (const pat of rule.target_file_patterns) {
        if (!forcedPatterns.includes(pat)) {
          forcedPatterns.push(pat);
        }
      }
    }
  }

  const specificityEnforced = firedRules.length > 0;

  // Map each forced pattern → first matching candidate (deterministic FIFO)
  const matchedForcedItems = new Map<string, EvidenceItem>(); // pattern → item
  for (const pattern of forcedPatterns) {
    const match = filtered.find((item) => itemMatchesPattern(item, pattern));
    if (match) {
      matchedForcedItems.set(pattern, match);
    }
  }

  const missingRequiredPatterns = forcedPatterns.filter(
    (p) => !matchedForcedItems.has(p),
  );

  // Deduplicate: multiple patterns may resolve to the same item
  const forcedEvidenceIds = new Set<string>();
  const forcedInclusions: PickedFile[] = [];

  for (const [pattern, item] of matchedForcedItems) {
    if (forcedEvidenceIds.has(item.evidence_id)) continue;
    forcedEvidenceIds.add(item.evidence_id);

    const rule = firedRules.find((r) => r.target_file_patterns.includes(pattern));

    forcedInclusions.push({
      evidence_id: item.evidence_id,
      project_id: item.project_id,
      evidence_type: item.evidence_type,
      retrieval_level: "level_2",
      title: item.title,
      summary_snippet: item.summary_snippet,
      wiki_page_slug: item.wiki_page_slug,
      file_path_or_url: item.file_path_or_url,
      asset_id: item.asset_id,
      acl_scope: item.acl_scope,
      hierarchy_path: item.hierarchy_path,
      lineage_chain: item.lineage_chain,
      keyword_hints: item.keyword_hints,
      trust_score: item.trust_score,
      score: 1.0,
      forced: true,
      forced_by_rule: rule?.id ?? null,
      rationale: rule
        ? `Forced by rule "${rule.id}": ${rule.reason}`
        : `Forced by specificity rule: matches required pattern "${pattern}".`,
    });
  }

  // ── 3. Score non-forced items ─────────────────────────────────────────────
  const nonForcedCandidates = filtered.filter(
    (item) => !forcedEvidenceIds.has(item.evidence_id),
  );

  const scored = nonForcedCandidates.map((item) => ({
    item,
    score: computeFileScore(item, taskTextLower, detectedIntents),
  }));

  // Sort: descending score, then evidence_id ascending for determinism
  scored.sort((a, b) => {
    const diff = b.score - a.score;
    if (Math.abs(diff) > 1e-9) return diff > 0 ? -1 : 1;
    return a.item.evidence_id.localeCompare(b.item.evidence_id);
  });

  // ── 4. Build selected and dropped lists ──────────────────────────────────
  const slotsRemaining = Math.max(0, limit - forcedInclusions.length);
  const topScored  = scored.slice(0, slotsRemaining);
  const restScored = scored.slice(slotsRemaining);

  const selectedNonForced: PickedFile[] = topScored.map(({ item, score }) => ({
    evidence_id: item.evidence_id,
    project_id: item.project_id,
    evidence_type: item.evidence_type,
    retrieval_level: "level_2",
    title: item.title,
    summary_snippet: item.summary_snippet,
    wiki_page_slug: item.wiki_page_slug,
    file_path_or_url: item.file_path_or_url,
    asset_id: item.asset_id,
    acl_scope: item.acl_scope,
    hierarchy_path: item.hierarchy_path,
    lineage_chain: item.lineage_chain,
    keyword_hints: item.keyword_hints,
    trust_score: item.trust_score,
    score,
    forced: false,
    forced_by_rule: null,
    rationale:
      score >= 0.5
        ? `Score ${score.toFixed(3)}: strong keyword and path match for intents [${detectedIntents.slice(0, 2).join(", ")}].`
        : score >= 0.2
        ? `Score ${score.toFixed(3)}: partial keyword/path match for task context.`
        : `Score ${score.toFixed(3)}: weak match; included by rank order within budget.`,
  }));

  const dropped: DroppedFile[] = restScored.map(({ item, score }) => ({
    evidence_id: item.evidence_id,
    title: item.title,
    file_path_or_url: item.file_path_or_url,
    score,
    exclusion_reason:
      slotsRemaining <= 0
        ? "limit_reached_forced_items_filled_slots"
        : `score_${score.toFixed(3)}_below_limit_cutoff`,
  }));

  // Cap total selected at limit (forced items are prioritised but still bounded)
  const selected: PickedFile[] = [...forcedInclusions, ...selectedNonForced].slice(0, limit);

  return {
    task_text: taskText,
    project_id: options.project_id ?? null,
    intent_classes: detectedIntents,
    specificity_enforced: specificityEnforced,
    forced_inclusions: forcedInclusions,
    missing_required_patterns: missingRequiredPatterns,
    selected,
    dropped,
    total_candidates: filtered.length,
  };
}
