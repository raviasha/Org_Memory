/**
 * lib/context-assembler.ts — Session 12
 *
 * Context assembler, budget caps, and cross-store deduplication.
 *
 * Given evidence items from one or more memory stores, this module:
 *
 *   1. Merges evidence items across all stores into a single candidate pool.
 *   2. Deduplicates across stores: items sharing the same canonical key
 *      (file_path_or_url basename, wiki_page_slug, or title slug) are
 *      considered duplicates; the highest-scored copy is kept; all others
 *      are dropped with reason "duplicate_cross_store".
 *   3. Applies per-level token budget caps (Level 0, Level 1, Level 2).
 *      Items that exceed the level cap are dropped with reason
 *      "budget_exceeded_level_{N}".
 *   4. Applies a hard total-budget cap.  Items exceeding total budget are
 *      dropped with reason "budget_exceeded_total".
 *   5. Returns a deterministic context pack:
 *        selected     — items within budget, sorted level_0 → level_1 → level_2,
 *                       then by composite_score desc, then evidence_id asc.
 *        dropped      — every dropped item with its reason.
 *        curation_manifest — full audit record: selected IDs, dropped IDs,
 *                       deduplication log, budget usage, and manifest metadata.
 *
 * Design constraints:
 *   - No per-query LLM calls.
 *   - No embedding models or vector indexes.
 *   - Deterministic output for identical inputs.
 *   - Token budgets are enforced as hard limits; no silent expansion.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Approximate tokens per evidence item (wiki page summary or file excerpt). */
export const TOKENS_PER_ITEM = 800;

/** Default per-level token budget caps. */
export const DEFAULT_LEVEL_BUDGETS: LevelBudgets = {
  level_0: 3_200,   // ~4 org/domain summary pages
  level_1: 6_400,   // ~8 entity/concept pages
  level_2: 8_000,   // ~10 specific files
};

/** Default hard total-budget cap (tokens). */
export const DEFAULT_TOTAL_BUDGET = 12_800;

/** Level order for stable pack assembly. */
const LEVEL_ORDER: Record<string, number> = {
  level_0: 0,
  level_1: 1,
  level_2: 2,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single evidence item from the retrieval pipeline (subset of RankedEvidence). */
export interface EvidenceInput {
  evidence_id:      string;
  project_id:       string;
  store_id:         string;       // which memory store this came from
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
  composite_score:  number;       // pre-computed composite from ranker
  rationale:        string;
}

/** Per-store evidence set fed to the assembler. */
export interface StoreEvidenceSet {
  store_id: string;
  items:    EvidenceInput[];
}

/** Budget caps per retrieval level (token counts). */
export interface LevelBudgets {
  level_0: number;
  level_1: number;
  level_2: number;
}

/** An item included in the final context pack. */
export interface SelectedItem {
  evidence_id:      string;
  store_id:         string;
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
  composite_score:  number;
  rationale:        string;
  token_estimate:   number;
  rank_position:    number;       // 1-indexed within the final pack
}

/** An item excluded from the final context pack. */
export interface DroppedItem {
  evidence_id:   string;
  store_id:      string;
  title:         string;
  retrieval_level: string;
  composite_score: number;
  drop_reason:   DropReason;
  drop_detail:   string;
}

/** Machine-readable drop reason codes. */
export type DropReason =
  | "duplicate_cross_store"
  | "budget_exceeded_level_0"
  | "budget_exceeded_level_1"
  | "budget_exceeded_level_2"
  | "budget_exceeded_total";

/** One entry in the deduplication log. */
export interface DeduplicationEntry {
  deduplication_key: string;
  canonical_id:      string;   // evidence_id kept
  canonical_store:   string;   // store_id of canonical item
  duplicate_ids:     string[]; // evidence_ids dropped
  reason:            string;
}

/** Budget usage summary per level and total. */
export interface BudgetSummary {
  total_limit:    number;
  level_0_limit:  number;
  level_1_limit:  number;
  level_2_limit:  number;
  total_used:     number;
  level_0_used:   number;
  level_1_used:   number;
  level_2_used:   number;
  budget_status:  "within_budget" | "exceeded";
}

/** Curation manifest — full audit record for one assembly run. */
export interface CurationManifest {
  manifest_id:        string;
  task_id:            string | null;
  subtask_id:         string | null;
  run_id:             string | null;
  project_id:         string | null;
  selected_item_ids:  string[];
  dropped_item_ids:   string[];
  deduplication_log:  DeduplicationEntry[];
  budget_summary:     BudgetSummary;
  store_ids_used:     string[];
  total_candidates:   number;
  created_at:         string;
}

/** Full output from the assembler. */
export interface ContextPack {
  selected:            SelectedItem[];
  dropped:             DroppedItem[];
  curation_manifest:   CurationManifest;
  store_count:         number;
  total_candidates:    number;
}

/** Input configuration for the assembler. */
export interface AssemblerInput {
  stores:        StoreEvidenceSet[];
  task_id?:      string | null;
  subtask_id?:   string | null;
  run_id?:       string | null;
  project_id?:   string | null;
  level_budgets?: Partial<LevelBudgets>;
  total_budget?:  number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Simple djb2 hash for deterministic IDs. */
function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
    h = h >>> 0;
  }
  return h;
}

function shortId(seed: string): string {
  return djb2(seed).toString(36).padStart(7, "0").slice(-7);
}

/**
 * Derive a canonical deduplication key for an evidence item.
 *
 * Priority:
 *   1. file_path_or_url basename without extension (normalised, lower-case)
 *   2. wiki_page_slug (lower-case)
 *   3. title slug (lower-case, alphanumeric only)
 *
 * Items with the same key are considered duplicates.
 */
function deduplicationKey(item: EvidenceInput): string {
  if (item.file_path_or_url) {
    // Extract basename, strip extension
    const basename = item.file_path_or_url
      .split("/")
      .pop()!
      .replace(/\.[^.]+$/, "")
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, "-");
    return `file:${basename}`;
  }
  if (item.wiki_page_slug) {
    return `wiki:${item.wiki_page_slug.toLowerCase()}`;
  }
  const titleSlug = item.title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `title:${titleSlug}`;
}

// ---------------------------------------------------------------------------
// Core assembler
// ---------------------------------------------------------------------------

/**
 * Assemble a deterministic context pack from multi-store evidence sets.
 *
 * Steps:
 *   1. Flatten all store evidence into a single candidate list.
 *   2. Deduplicate across stores (keep highest-scored canonical copy).
 *   3. Sort candidates: level_0 → level_1 → level_2, then score desc, id asc.
 *   4. Apply per-level budget caps, then total budget cap.
 *   5. Build and return ContextPack.
 */
export function assembleContext(input: AssemblerInput): ContextPack {
  const now = new Date().toISOString();

  const levelBudgets: LevelBudgets = {
    level_0: input.level_budgets?.level_0 ?? DEFAULT_LEVEL_BUDGETS.level_0,
    level_1: input.level_budgets?.level_1 ?? DEFAULT_LEVEL_BUDGETS.level_1,
    level_2: input.level_budgets?.level_2 ?? DEFAULT_LEVEL_BUDGETS.level_2,
  };
  const totalBudget = input.total_budget ?? DEFAULT_TOTAL_BUDGET;

  // ── Step 1: flatten ───────────────────────────────────────────────────────
  const allItems: EvidenceInput[] = [];
  const storeIds = new Set<string>();
  for (const store of input.stores) {
    storeIds.add(store.store_id);
    for (const item of store.items) {
      allItems.push({ ...item, store_id: store.store_id });
    }
  }
  const totalCandidates = allItems.length;

  // ── Step 2: cross-store deduplication ────────────────────────────────────
  // Group by deduplication key; within each group keep the highest-scored item.
  const groups = new Map<string, EvidenceInput[]>();
  for (const item of allItems) {
    const key = deduplicationKey(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }

  const deduplicationLog: DeduplicationEntry[] = [];
  const deduplicated: EvidenceInput[] = []; // canonical items only
  const duplicateDropped: DroppedItem[] = [];

  for (const [key, group] of groups) {
    if (group.length === 1) {
      deduplicated.push(group[0]);
      continue;
    }

    // Sort group: highest score first, then evidence_id asc as tie-break
    group.sort((a, b) =>
      b.composite_score - a.composite_score ||
      (a.evidence_id < b.evidence_id ? -1 : 1),
    );

    const canonical = group[0];
    const dups = group.slice(1);

    deduplicated.push(canonical);

    const entry: DeduplicationEntry = {
      deduplication_key: key,
      canonical_id:      canonical.evidence_id,
      canonical_store:   canonical.store_id,
      duplicate_ids:     dups.map((d) => d.evidence_id),
      reason:
        `Duplicate evidence across ${group.length} stores. ` +
        `Canonical copy kept from store "${canonical.store_id}" ` +
        `(score ${canonical.composite_score.toFixed(3)}). ` +
        `Dropped copies: ${dups.map((d) => `${d.evidence_id}@${d.store_id}`).join(", ")}.`,
    };
    deduplicationLog.push(entry);

    for (const dup of dups) {
      duplicateDropped.push({
        evidence_id:     dup.evidence_id,
        store_id:        dup.store_id,
        title:           dup.title,
        retrieval_level: dup.retrieval_level,
        composite_score: dup.composite_score,
        drop_reason:     "duplicate_cross_store",
        drop_detail:
          `Duplicate of canonical item ${canonical.evidence_id} ` +
          `(deduplication key: "${key}").`,
      });
    }
  }

  // ── Step 3: sort deduplicated pool ───────────────────────────────────────
  deduplicated.sort((a, b) => {
    const lvA = LEVEL_ORDER[a.retrieval_level] ?? 99;
    const lvB = LEVEL_ORDER[b.retrieval_level] ?? 99;
    if (lvA !== lvB) return lvA - lvB;
    if (b.composite_score !== a.composite_score)
      return b.composite_score - a.composite_score;
    return a.evidence_id < b.evidence_id ? -1 : 1;
  });

  // ── Step 4: apply budget caps ────────────────────────────────────────────
  const levelUsed: Record<string, number> = {
    level_0: 0,
    level_1: 0,
    level_2: 0,
  };
  const levelLimit: Record<string, number> = {
    level_0: levelBudgets.level_0,
    level_1: levelBudgets.level_1,
    level_2: levelBudgets.level_2,
  };
  let totalUsed = 0;
  let totalExceeded = false;

  const selected: SelectedItem[] = [];
  const budgetDropped: DroppedItem[] = [];

  for (const item of deduplicated) {
    const tokens = TOKENS_PER_ITEM;
    const level = item.retrieval_level;
    const levelCap = levelLimit[level] ?? levelBudgets.level_2;
    const levelKey = level in levelLimit ? level : "level_2";

    // Check total budget first
    if (totalExceeded || totalUsed + tokens > totalBudget) {
      totalExceeded = true;
      budgetDropped.push({
        evidence_id:     item.evidence_id,
        store_id:        item.store_id,
        title:           item.title,
        retrieval_level: item.retrieval_level,
        composite_score: item.composite_score,
        drop_reason:     "budget_exceeded_total",
        drop_detail:
          `Total budget cap of ${totalBudget} tokens reached ` +
          `(used ${totalUsed}, item requires ${tokens}).`,
      });
      continue;
    }

    // Check level budget
    if (levelUsed[levelKey] + tokens > levelCap) {
      const dropReason = `budget_exceeded_${level}` as DropReason;
      budgetDropped.push({
        evidence_id:     item.evidence_id,
        store_id:        item.store_id,
        title:           item.title,
        retrieval_level: item.retrieval_level,
        composite_score: item.composite_score,
        drop_reason:     dropReason,
        drop_detail:
          `Level ${level} budget cap of ${levelCap} tokens reached ` +
          `(used ${levelUsed[levelKey]}, item requires ${tokens}).`,
      });
      continue;
    }

    // Accept item
    levelUsed[levelKey] += tokens;
    totalUsed += tokens;

    selected.push({
      evidence_id:      item.evidence_id,
      store_id:         item.store_id,
      project_id:       item.project_id,
      evidence_type:    item.evidence_type,
      retrieval_level:  item.retrieval_level,
      title:            item.title,
      summary_snippet:  item.summary_snippet,
      wiki_page_slug:   item.wiki_page_slug,
      file_path_or_url: item.file_path_or_url,
      acl_scope:        item.acl_scope,
      hierarchy_path:   item.hierarchy_path,
      lineage_chain:    item.lineage_chain,
      composite_score:  item.composite_score,
      rationale:        item.rationale,
      token_estimate:   tokens,
      rank_position:    0, // assigned below
    });
  }

  // Assign 1-indexed rank_position
  selected.forEach((item, idx) => {
    item.rank_position = idx + 1;
  });

  // ── Step 5: build curation manifest ──────────────────────────────────────
  const allDropped: DroppedItem[] = [...duplicateDropped, ...budgetDropped];

  const budgetSummary: BudgetSummary = {
    total_limit:   totalBudget,
    level_0_limit: levelBudgets.level_0,
    level_1_limit: levelBudgets.level_1,
    level_2_limit: levelBudgets.level_2,
    total_used:    totalUsed,
    level_0_used:  levelUsed.level_0,
    level_1_used:  levelUsed.level_1,
    level_2_used:  levelUsed.level_2,
    budget_status: totalUsed > totalBudget ? "exceeded" : "within_budget",
  };

  const manifestSeed = [
    input.task_id ?? "",
    input.subtask_id ?? "",
    input.run_id ?? "",
    now,
  ].join("-");

  const manifest: CurationManifest = {
    manifest_id:       `manifest-${shortId(manifestSeed)}`,
    task_id:           input.task_id ?? null,
    subtask_id:        input.subtask_id ?? null,
    run_id:            input.run_id ?? null,
    project_id:        input.project_id ?? null,
    selected_item_ids: selected.map((i) => i.evidence_id),
    dropped_item_ids:  allDropped.map((i) => i.evidence_id),
    deduplication_log: deduplicationLog,
    budget_summary:    budgetSummary,
    store_ids_used:    Array.from(storeIds),
    total_candidates:  totalCandidates,
    created_at:        now,
  };

  return {
    selected,
    dropped:           allDropped,
    curation_manifest: manifest,
    store_count:       storeIds.size,
    total_candidates:  totalCandidates,
  };
}
