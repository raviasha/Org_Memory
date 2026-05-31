/**
 * lib/retrieval-ranker.ts — Session 10
 *
 * Task router and ranker for Level 0 and Level 1 retrieval.
 *
 * Delivers the Session 10 "task router and ranker" deliverable:
 *   - Given free-form task text and an optional project_id, rank evidence
 *     items from the evidence_items table and return top candidates with
 *     rationale and score breakdowns.
 *   - Focuses on Level 0 (summary / index pages) and Level 1 (entity /
 *     concept / store-catalog pages) — Level 2 items are included but
 *     ranked below Level 0/1 by default.
 *   - ALL scores are read from the DB or computed from rule-based features.
 *     No per-query LLM calls.  No embedding models.  No vector indexes.
 *
 * Scoring formula (same structure as store-router.ts):
 *   composite_score
 *     = 0.40 * intent_match        (keyword overlap, rule-based)
 *     + 0.25 * trust_score         (from evidence_items.trust_score, static)
 *     + 0.20 * freshness           (derived from evidence_items.updated_at)
 *     + 0.15 * semantic_score      (read from evidence_items.semantic_score cache)
 *
 * Level boost: Level 0 items receive +0.10, Level 1 items +0.05, Level 2
 * receives no boost.  Applied after the composite score to preserve ordering
 * within each level but promote higher-level items overall.
 *
 * Tie-breaking: evidence_id ascending (deterministic).
 *
 * Semantic score cache rule:
 *   evidence_items.semantic_score is pre-computed offline by the DB function
 *   _compute_semantic_score() and refreshed by refresh_semantic_scores().
 *   The trigger trg_invalidate_evidence_semantic_score sets semantic_score=NULL
 *   when the backing wiki_pages.updated_at changes.  This function calls
 *   refreshSemanticScores() before ranking if any NULL scores are found.
 */

import { createClient } from "@supabase/supabase-js";
import {
  isAssetQuarantined,
  staleDemotionFromTimestamp,
} from "./source-trust";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const LEVEL_BOOST: Record<string, number> = {
  level_0: 0.10,
  level_1: 0.05,
  level_2: 0.00,
};

// Scoring weights
export const W_INTENT    = 0.40;
export const W_TRUST     = 0.25;
export const W_FRESHNESS = 0.20;
export const W_SEMANTIC  = 0.15;

/** Default max results per retrieval request. */
export const DEFAULT_LIMIT = 20;

/** Max staleness in days before freshness score reaches 0. */
const FRESHNESS_DECAY_DAYS = 180;

// ---------------------------------------------------------------------------
// Intent keyword map (mirrors store-router.ts INTENT_KEYWORDS)
// ---------------------------------------------------------------------------

export const INTENT_KEYWORDS: Record<string, string[]> = {
  financial_analysis: [
    "npv", "finance", "cost", "budget", "valuation", "capex", "opex",
    "depreciation", "irr", "cashflow", "discount rate", "hurdle", "q3",
    "fy26", "infrastructure investment", "board approval",
  ],
  vendor_evaluation: [
    "vendor", "supplier", "procurement", "rfp", "proposal", "approve",
    "approval", "sourcing", "clouda", "cloudb", "cloudc", "comparison",
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScoreBreakdown {
  intent_match:  number;
  trust_score:   number;
  freshness:     number;
  semantic_score: number;
  stale_demotion: number;
  level_boost:   number;
  composite:     number;
}

export interface RankedEvidence {
  evidence_id:      string;
  asset_id:         string | null;
  project_id:       string;
  evidence_type:    string;
  retrieval_level:  string;
  title:            string;
  summary_snippet:  string;
  wiki_page_slug:   string | null;
  file_path_or_url: string | null;
  acl_scope:        string;
  hierarchy_path:   string;
  lineage_chain:    string[];
  keyword_hints:    string[];
  score_breakdown:  ScoreBreakdown;
  rank_position:    number;
  rationale:        string;
  semantic_score_cached_at: string | null;
}

export interface RetrievalResult {
  task_text:      string;
  project_id:     string | null;
  intent_classes: string[];
  total_candidates: number;
  items:          RankedEvidence[];
  retrieval_levels_included: string[];
  scores_from_cache: boolean;
}

export interface RetrievalFilters {
  project_id?:       string;
  retrieval_levels?: string[];   // default: ["level_0", "level_1"]
  acl_scope?:        string;
  limit?:            number;
}

// ---------------------------------------------------------------------------
// Internal DB row type
// ---------------------------------------------------------------------------

interface EvidenceRow {
  evidence_id:              string;
  org_id:                   string;
  project_id:               string;
  evidence_type:            string;
  asset_id:                 string | null;
  source_asset_ids:         string[];
  retrieval_level:          string;
  title:                    string;
  summary_snippet:          string;
  wiki_page_slug:           string | null;
  file_path_or_url:         string | null;
  acl_scope:                string;
  hierarchy_path:           string;
  lineage_chain:            string[];
  keyword_hints:            string[];
  trust_score:              number;
  semantic_score:           number | null;
  semantic_score_cached_at: string | null;
  updated_at:               string;
}

interface AssetStateRow {
  asset_id: string;
  ingest_status: string;
  lineage_metadata: unknown;
}

// ---------------------------------------------------------------------------
// Supabase client factory
// ---------------------------------------------------------------------------

function getSupabaseClient() {
  const url  = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key  = process.env.SUPABASE_SERVICE_ROLE_KEY
            ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null; // dev passthrough — no Supabase configured
  return createClient(url, key);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse task text into one or more intent classes via keyword matching.
 * Returns all matching intents sorted by match count (descending).
 */
export function detectIntents(taskText: string): string[] {
  const lower = taskText.toLowerCase();
  const scores: Record<string, number> = {};
  for (const [intent, keywords] of Object.entries(INTENT_KEYWORDS)) {
    let count = 0;
    for (const kw of keywords) {
      if (lower.includes(kw)) count++;
    }
    if (count > 0) scores[intent] = count;
  }
  return Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .map(([intent]) => intent);
}

/**
 * Compute intent_match score (0–1) for an evidence item given a set of
 * detected intent classes.
 *
 * Strategy: check overlap between:
 *   1. The item's keyword_hints array vs the task text (direct lexical match)
 *   2. The item's retrieval_level and hierarchy_path vs detected intents
 *
 * Returns the highest overlap fraction found.
 */
function computeIntentMatch(
  row: EvidenceRow,
  taskTextLower: string,
  detectedIntents: string[],
): number {
  if (row.keyword_hints.length === 0 && detectedIntents.length === 0) return 0;

  // 1. Keyword hint overlap: count how many of the item's keyword_hints appear
  //    in the task text.
  let kwMatchCount = 0;
  for (const hint of row.keyword_hints) {
    if (hint && taskTextLower.includes(hint.toLowerCase())) kwMatchCount++;
  }
  const kwScore = row.keyword_hints.length > 0
    ? kwMatchCount / row.keyword_hints.length
    : 0;

  // 2. Intent alignment: check if any INTENT_KEYWORDS for a detected intent
  //    appear in the item's title or summary_snippet.
  let intentScore = 0;
  if (detectedIntents.length > 0) {
    const itemText = (row.title + " " + row.summary_snippet).toLowerCase();
    let topMatchCount = 0;
    for (const intent of detectedIntents.slice(0, 2)) {
      const intentKws = INTENT_KEYWORDS[intent] ?? [];
      let matches = 0;
      for (const kw of intentKws) {
        if (itemText.includes(kw)) matches++;
      }
      topMatchCount = Math.max(topMatchCount, matches);
    }
    // Normalise by a ceiling of 5 keyword matches for the intent
    intentScore = Math.min(1.0, topMatchCount / 5.0);
  }

  // Return the max of both signals, giving the item the benefit of the doubt
  return Math.max(kwScore, intentScore);
}

/**
 * Compute freshness score (0–1) from an ISO timestamp.
 * Score = 1 at age 0 days, decays linearly to 0 at FRESHNESS_DECAY_DAYS.
 */
function computeFreshness(updatedAt: string): number {
  const ageMs = Date.now() - new Date(updatedAt).getTime();
  const ageDays = ageMs / 86_400_000;
  return Math.max(0, 1 - ageDays / FRESHNESS_DECAY_DAYS);
}

/**
 * Build a human-readable rationale string for an evidence item.
 */
function buildRationale(
  row: EvidenceRow,
  breakdown: ScoreBreakdown,
  detectedIntents: string[],
): string {
  const parts: string[] = [];
  if (breakdown.intent_match >= 0.5) {
    parts.push(`strong intent match to [${detectedIntents.slice(0, 2).join(", ")}]`);
  } else if (breakdown.intent_match >= 0.2) {
    parts.push(`partial intent match`);
  }
  if (row.retrieval_level === "level_0") parts.push("org-level index or summary page");
  if (row.retrieval_level === "level_1") parts.push("domain/entity page");
  if (breakdown.trust_score >= 0.85) parts.push(`high-trust source (${row.evidence_type})`);
  if (breakdown.freshness >= 0.8)  parts.push("recently updated");
  if (breakdown.stale_demotion > 0) {
    parts.push(`stale-source demotion applied (${breakdown.stale_demotion.toFixed(2)})`);
  }
  if (breakdown.semantic_score >= 0.6) parts.push("rich content");
  const composite = breakdown.composite.toFixed(3);
  return parts.length > 0
    ? `Composite score ${composite}: ${parts.join("; ")}.`
    : `Composite score ${composite}.`;
}

// ---------------------------------------------------------------------------
// Core: refresh semantic scores if any are NULL
// ---------------------------------------------------------------------------

async function refreshNullScores(
  supabase: NonNullable<ReturnType<typeof getSupabaseClient>>,
  projectId: string | undefined,
): Promise<void> {
  // Check for any NULL semantic scores in the project scope
  let query = supabase
    .from("evidence_items")
    .select("evidence_id", { count: "exact", head: true })
    .is("semantic_score", null);
  if (projectId) query = query.eq("project_id", projectId);

  const { count } = await query;
  if (!count || count === 0) return;

  // Call DB function to batch-refresh all NULL scores
  await supabase.rpc("refresh_semantic_scores", {
    p_project_id: projectId ?? null,
  });
}

// ---------------------------------------------------------------------------
// Core: rankEvidence
// ---------------------------------------------------------------------------

/**
 * Rank evidence items for a given task text.
 *
 * @param taskText - Free-form task description.
 * @param filters  - Optional project, level, ACL, and limit filters.
 * @returns        - Ranked evidence list with score breakdowns and rationale.
 */
export async function rankEvidence(
  taskText: string,
  filters: RetrievalFilters = {},
): Promise<RetrievalResult> {
  const supabase = getSupabaseClient();

  const levels = filters.retrieval_levels ?? ["level_0", "level_1"];
  const limit  = Math.min(filters.limit ?? DEFAULT_LIMIT, 200);

  // Detect intents from task text (always run, even without DB)
  const detectedIntents = detectIntents(taskText);
  const taskTextLower   = taskText.toLowerCase();

  // Dev passthrough: no Supabase configured → return empty result set
  if (!supabase) {
    return {
      task_text:      taskText,
      project_id:     filters.project_id ?? null,
      intent_classes: detectedIntents,
      total_candidates: 0,
      items:          [],
      retrieval_levels_included: [],
      scores_from_cache: true,
    };
  }

  // Ensure semantic scores are cached
  await refreshNullScores(supabase, filters.project_id);

  // Fetch candidate evidence items
  let dbQuery = supabase
    .from("evidence_items")
    .select(`
      evidence_id, org_id, project_id, evidence_type,
      asset_id, source_asset_ids,
      retrieval_level, title, summary_snippet,
      wiki_page_slug, file_path_or_url,
      acl_scope, hierarchy_path, lineage_chain, keyword_hints,
      trust_score, semantic_score, semantic_score_cached_at,
      updated_at
    `)
    .in("retrieval_level", levels);

  if (filters.project_id) {
    dbQuery = dbQuery.eq("project_id", filters.project_id);
  }
  if (filters.acl_scope) {
    dbQuery = dbQuery.eq("acl_scope", filters.acl_scope);
  }

  // Fetch up to limit * 3 candidates and rerank in-process
  const { data: rows, error } = await dbQuery
    .limit(limit * 3)
    .returns<EvidenceRow[]>();

  if (error) throw new Error(`Evidence query failed: ${error.message}`);
  if (!rows || rows.length === 0) {
    return {
      task_text:      taskText,
      project_id:     filters.project_id ?? null,
      intent_classes: detectedIntents,
      total_candidates: 0,
      items:          [],
      retrieval_levels_included: levels,
      scores_from_cache: true,
    };
  }

  const referencedAssetIds = new Set<string>();
  for (const row of rows) {
    if (row.asset_id) referencedAssetIds.add(row.asset_id);
    for (const id of row.source_asset_ids ?? []) {
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        referencedAssetIds.add(id);
      }
    }
  }

  const assetStateById = new Map<string, AssetStateRow>();
  if (referencedAssetIds.size > 0) {
    const { data: assetRows } = await supabase
      .from("assets")
      .select("asset_id, ingest_status, lineage_metadata")
      .in("asset_id", Array.from(referencedAssetIds))
      .returns<AssetStateRow[]>();

    for (const row of assetRows ?? []) {
      assetStateById.set(row.asset_id, row);
    }
  }

  const filteredRows = rows.filter((row) => {
    const linkedIds = row.evidence_type === "asset"
      ? [row.asset_id]
      : (row.source_asset_ids ?? []);

    for (const id of linkedIds) {
      if (!id) continue;
      const assetState = assetStateById.get(id);
      if (!assetState) continue;
      if (isAssetQuarantined(assetState.lineage_metadata, assetState.ingest_status)) {
        return false;
      }
    }

    return true;
  });

  if (filteredRows.length === 0) {
    return {
      task_text: taskText,
      project_id: filters.project_id ?? null,
      intent_classes: detectedIntents,
      total_candidates: rows.length,
      items: [],
      retrieval_levels_included: levels,
      scores_from_cache: true,
    };
  }

  // Score and rank
  const scored: Array<{ row: EvidenceRow; breakdown: ScoreBreakdown }> =
    filteredRows.map((row) => {
      const intentMatch = computeIntentMatch(row, taskTextLower, detectedIntents);
      const trustScore  = row.trust_score ?? 0.8;
      const freshness   = computeFreshness(row.updated_at);
      // Semantic score from cache (fallback to 0.5 if still NULL after refresh)
      const semanticScore = row.semantic_score ?? 0.5;
      const staleDemotion = staleDemotionFromTimestamp(row.updated_at);
      const levelBoost  = LEVEL_BOOST[row.retrieval_level] ?? 0;

      const composite =
        W_INTENT    * intentMatch  +
        W_TRUST     * trustScore   +
        W_FRESHNESS * freshness    +
        W_SEMANTIC  * semanticScore +
        levelBoost - staleDemotion;

      const breakdown: ScoreBreakdown = {
        intent_match:   intentMatch,
        trust_score:    trustScore,
        freshness,
        semantic_score: semanticScore,
        stale_demotion: staleDemotion,
        level_boost:    levelBoost,
        composite:      Math.min(1.0, composite),
      };
      return { row, breakdown };
    });

  // Sort: descending composite score, tie-break by evidence_id ascending
  scored.sort((a, b) => {
    const diff = b.breakdown.composite - a.breakdown.composite;
    if (Math.abs(diff) > 1e-9) return diff > 0 ? 1 : -1;
    return a.row.evidence_id.localeCompare(b.row.evidence_id);
  });

  const topN = scored.slice(0, limit);

  const items: RankedEvidence[] = topN.map(({ row, breakdown }, idx) => ({
    evidence_id:      row.evidence_id,
    asset_id:         row.asset_id,
    project_id:       row.project_id,
    evidence_type:    row.evidence_type,
    retrieval_level:  row.retrieval_level,
    title:            row.title,
    summary_snippet:  row.summary_snippet,
    wiki_page_slug:   row.wiki_page_slug,
    file_path_or_url: row.file_path_or_url,
    acl_scope:        row.acl_scope,
    hierarchy_path:   row.hierarchy_path,
    lineage_chain:    row.lineage_chain,
    keyword_hints:    row.keyword_hints,
    score_breakdown:  breakdown,
    rank_position:    idx + 1,
    rationale:        buildRationale(row, breakdown, detectedIntents),
    semantic_score_cached_at: row.semantic_score_cached_at,
  }));

  const levelsPresent = [...new Set(items.map((i) => i.retrieval_level))];

  return {
    task_text:      taskText,
    project_id:     filters.project_id ?? null,
    intent_classes: detectedIntents,
    total_candidates: filteredRows.length,
    items,
    retrieval_levels_included: levelsPresent,
    scores_from_cache: true, // semantic scores always read from cache after refresh
  };
}
