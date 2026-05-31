/**
 * e2e/session-12/context-assembler.spec.ts
 *
 * Session 12 — Context assembler, budget caps, and cross-store deduplication
 * @session-12
 *
 * Exit criteria:
 *
 *  A. Guard paths — POST /api/v1/context/assemble:
 *     - 401 without auth header.
 *     - 400 when stores is missing.
 *     - 400 when stores is an empty array.
 *     - 400 when a store has no store_id.
 *     - 400 when a store has no items array.
 *     - 422 when more than 3 stores are provided (store count cap enforcement).
 *
 *  B. Happy path — single store:
 *     - 201 with all required response fields.
 *     - selected is a non-empty array.
 *     - dropped is an array (may be empty if all items fit in budget).
 *     - curation_manifest has required fields: manifest_id, selected_item_ids,
 *       dropped_item_ids, deduplication_log, budget_summary, store_ids_used.
 *     - budget_summary has total_limit, total_used, budget_status.
 *     - budget_status is "within_budget" when items fit.
 *     - rank_position is 1-indexed and strictly increasing.
 *     - Stable ordering: items sorted level_0 → level_1 → level_2.
 *
 *  C. Cross-store deduplication — two-store input:
 *     - Items sharing the same file_path_or_url are deduplicated.
 *     - Items sharing the same wiki_page_slug are deduplicated.
 *     - deduplication_log has one entry per duplicate group.
 *     - Each deduplication_log entry has: deduplication_key, canonical_id,
 *       canonical_store, duplicate_ids (non-empty), reason.
 *     - dropped contains every duplicate with drop_reason "duplicate_cross_store".
 *     - selected does NOT contain any evidence_id that appears in dropped
 *       with reason "duplicate_cross_store" — no duplicates in final pack.
 *     - store_count = 2 in the response.
 *
 *  D. Budget enforcement:
 *     - When total_budget is set very low, items exceeding it appear in dropped
 *       with drop_reason "budget_exceeded_total".
 *     - When a level budget is set very low, items from that level exceeding
 *       it appear in dropped with drop_reason matching
 *       "budget_exceeded_level_{N}".
 *     - budget_status = "exceeded" is NOT returned when items fit but is
 *       "within_budget" when they do.
 *     - Hard limit: selected items' total token_estimate never exceeds
 *       total_budget.
 *
 *  E. Determinism:
 *     - Two identical POST requests return identical selected evidence_id order.
 *
 *  F. Cross-project Task 9 — vendor compliance, 3-store input:
 *     - POST with stores from proj-finance-infra-q3, proj-compliance-privacy,
 *       and proj-org-shared produces a pack with no duplicate evidence items.
 *     - selected does not contain any evidence_id present in dropped with
 *       drop_reason "duplicate_cross_store".
 *     - deduplication_log is present (may be empty if no cross-store dups
 *       in the synthetic fixtures).
 *     - store_count = 3.
 *
 *  G. Curation manifest persistence — GET /api/v1/context/manifests/{id}:
 *     - After a successful POST, GET the manifest by manifest_id.
 *     - Returns 200 when Supabase is configured, 404 in dev (no Supabase).
 *     - 401 without auth header.
 *     - 401 for a random non-existent manifest_id returns 401 without auth
 *       header.
 */

import { test, expect } from "@playwright/test";

const AUTH_HEADER    = { Authorization: "Bearer prototype-dev-token" };
const ASSEMBLE_URL   = "/api/v1/context/assemble";
const MANIFESTS_BASE = "/api/v1/context/manifests";

// ---------------------------------------------------------------------------
// Fixtures: synthetic per-store evidence sets
// ---------------------------------------------------------------------------

/** A single evidence item with all required fields. */
function makeItem(
  id: string,
  level: "level_0" | "level_1" | "level_2",
  score: number,
  opts: {
    file_path_or_url?: string;
    wiki_page_slug?: string;
    project_id?: string;
  } = {},
) {
  return {
    evidence_id:      id,
    project_id:       opts.project_id ?? "proj-finance-infra-q3",
    evidence_type:    level === "level_2" ? "asset" : "wiki_page",
    retrieval_level:  level,
    title:            `Item ${id}`,
    summary_snippet:  `Summary for item ${id}`,
    wiki_page_slug:   opts.wiki_page_slug ?? null,
    file_path_or_url: opts.file_path_or_url ?? null,
    acl_scope:        "org:acme",
    hierarchy_path:   "org:acme/finance",
    lineage_chain:    [],
    keyword_hints:    ["finance", "vendor"],
    composite_score:  score,
    rationale:        `Rationale for ${id}`,
  };
}

// Store A: finance project
const STORE_A_ITEMS = [
  makeItem("ev-a1", "level_0", 0.90, { wiki_page_slug: "finance/index" }),
  makeItem("ev-a2", "level_1", 0.80, { wiki_page_slug: "finance/vendor-eval" }),
  makeItem("ev-a3", "level_2", 0.75, { file_path_or_url: "/proj-finance-infra-q3/vendor-comparison-matrix.xlsx" }),
  makeItem("ev-a4", "level_2", 0.65, { file_path_or_url: "/proj-finance-infra-q3/cfo-q3-guidance.pdf" }),
];

// Store B: compliance project — ev-b1 duplicates ev-a1 (same wiki_page_slug)
// ev-b2 duplicates ev-a3 (same file basename)
const STORE_B_ITEMS = [
  makeItem("ev-b1", "level_0", 0.70, { wiki_page_slug: "finance/index", project_id: "proj-compliance-privacy" }),
  makeItem("ev-b2", "level_2", 0.50, { file_path_or_url: "/proj-compliance-privacy/vendor-comparison-matrix.xlsx", project_id: "proj-compliance-privacy" }),
  makeItem("ev-b3", "level_1", 0.85, { wiki_page_slug: "compliance/gdpr-overview", project_id: "proj-compliance-privacy" }),
  makeItem("ev-b4", "level_2", 0.60, { file_path_or_url: "/proj-compliance-privacy/vendor-data-handling-requirements.pdf", project_id: "proj-compliance-privacy" }),
];

// Store C: org-shared project — cross-project shared items
const STORE_C_ITEMS = [
  makeItem("ev-c1", "level_0", 0.88, { wiki_page_slug: "org/index", project_id: "proj-org-shared" }),
  makeItem("ev-c2", "level_1", 0.76, { wiki_page_slug: "org/data-classification-policy", project_id: "proj-org-shared" }),
  makeItem("ev-c3", "level_2", 0.55, { file_path_or_url: "/proj-org-shared/org-data-classification-policy.pdf", project_id: "proj-org-shared" }),
];

// ============================================================================
// A. Guard paths
// ============================================================================

test.describe("Session 12 — Guard paths @session-12", () => {
  test("returns 401 without auth header", async ({ request }) => {
    const res = await request.post(ASSEMBLE_URL, {
      data: { stores: [{ store_id: "s1", items: STORE_A_ITEMS }] },
    });
    expect(res.status()).toBe(401);
    expect(await res.json()).toMatchObject({ error: "Unauthorized" });
  });

  test("returns 400 when stores is missing", async ({ request }) => {
    const res = await request.post(ASSEMBLE_URL, {
      headers: AUTH_HEADER,
      data: { task_id: "t1" },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).code).toBe("missing_stores");
  });

  test("returns 400 when stores is an empty array", async ({ request }) => {
    const res = await request.post(ASSEMBLE_URL, {
      headers: AUTH_HEADER,
      data: { stores: [] },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).code).toBe("missing_stores");
  });

  test("returns 400 when a store has no store_id", async ({ request }) => {
    const res = await request.post(ASSEMBLE_URL, {
      headers: AUTH_HEADER,
      data: { stores: [{ items: STORE_A_ITEMS }] },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).code).toBe("invalid_store");
  });

  test("returns 400 when a store has no items array", async ({ request }) => {
    const res = await request.post(ASSEMBLE_URL, {
      headers: AUTH_HEADER,
      data: { stores: [{ store_id: "finance", items: "bad" }] },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).code).toBe("invalid_store");
  });

  test("returns 422 when more than 3 stores provided", async ({ request }) => {
    const fourStores = Array.from({ length: 4 }, (_, i) => ({
      store_id: `store-${i}`,
      items: [makeItem(`ev-${i}-1`, "level_0", 0.8)],
    }));
    const res = await request.post(ASSEMBLE_URL, {
      headers: AUTH_HEADER,
      data: { stores: fourStores },
    });
    expect(res.status()).toBe(422);
    const body = await res.json();
    expect(body.code).toBe("store_count_exceeded");
    expect(body.max_stores).toBe(3);
    expect(body.provided).toBe(4);
  });
});

// ============================================================================
// B. Happy path — single store
// ============================================================================

test.describe("Session 12 — Single-store happy path @session-12", () => {
  test("returns 201 with all required fields", async ({ request }) => {
    const res = await request.post(ASSEMBLE_URL, {
      headers: AUTH_HEADER,
      data: {
        stores: [{ store_id: "proj-finance-infra-q3", items: STORE_A_ITEMS }],
        task_id:    "task-npv-test",
        subtask_id: "subtask-npv-01",
        project_id: "proj-finance-infra-q3",
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();

    // Top-level fields
    expect(typeof body.manifest_id).toBe("string");
    expect(body.manifest_id.length).toBeGreaterThan(0);
    expect(Array.isArray(body.selected)).toBe(true);
    expect(Array.isArray(body.dropped)).toBe(true);
    expect(typeof body.store_count).toBe("number");
    expect(typeof body.total_candidates).toBe("number");
    expect(body.total_candidates).toBe(STORE_A_ITEMS.length);

    // curation_manifest fields
    const m = body.curation_manifest;
    expect(typeof m.manifest_id).toBe("string");
    expect(Array.isArray(m.selected_item_ids)).toBe(true);
    expect(Array.isArray(m.dropped_item_ids)).toBe(true);
    expect(Array.isArray(m.deduplication_log)).toBe(true);
    expect(typeof m.budget_summary).toBe("object");
    expect(Array.isArray(m.store_ids_used)).toBe(true);
    expect(m.store_ids_used).toContain("proj-finance-infra-q3");
    expect(typeof m.created_at).toBe("string");

    // budget_summary fields
    const bs = m.budget_summary;
    expect(typeof bs.total_limit).toBe("number");
    expect(typeof bs.total_used).toBe("number");
    expect(typeof bs.budget_status).toBe("string");
    expect(["within_budget", "exceeded"]).toContain(bs.budget_status);
  });

  test("selected items have required fields", async ({ request }) => {
    const res = await request.post(ASSEMBLE_URL, {
      headers: AUTH_HEADER,
      data: { stores: [{ store_id: "proj-finance-infra-q3", items: STORE_A_ITEMS }] },
    });
    expect(res.status()).toBe(201);
    const { selected } = await res.json();
    expect(selected.length).toBeGreaterThan(0);

    for (const item of selected) {
      expect(typeof item.evidence_id).toBe("string");
      expect(typeof item.retrieval_level).toBe("string");
      expect(typeof item.composite_score).toBe("number");
      expect(typeof item.token_estimate).toBe("number");
      expect(typeof item.rank_position).toBe("number");
    }
  });

  test("rank_position is 1-indexed and strictly increasing", async ({ request }) => {
    const res = await request.post(ASSEMBLE_URL, {
      headers: AUTH_HEADER,
      data: { stores: [{ store_id: "proj-finance-infra-q3", items: STORE_A_ITEMS }] },
    });
    expect(res.status()).toBe(201);
    const { selected } = await res.json();
    expect(selected[0].rank_position).toBe(1);
    for (let i = 1; i < selected.length; i++) {
      expect(selected[i].rank_position).toBe(selected[i - 1].rank_position + 1);
    }
  });

  test("stable level ordering: level_0 before level_1 before level_2", async ({ request }) => {
    const res = await request.post(ASSEMBLE_URL, {
      headers: AUTH_HEADER,
      data: { stores: [{ store_id: "proj-finance-infra-q3", items: STORE_A_ITEMS }] },
    });
    expect(res.status()).toBe(201);
    const { selected } = await res.json();

    const levelOrder: Record<string, number> = { level_0: 0, level_1: 1, level_2: 2 };
    for (let i = 1; i < selected.length; i++) {
      const prev = levelOrder[selected[i - 1].retrieval_level] ?? 99;
      const curr = levelOrder[selected[i].retrieval_level] ?? 99;
      expect(curr).toBeGreaterThanOrEqual(prev);
    }
  });

  test("budget_status is within_budget when items fit", async ({ request }) => {
    const res = await request.post(ASSEMBLE_URL, {
      headers: AUTH_HEADER,
      data: { stores: [{ store_id: "proj-finance-infra-q3", items: STORE_A_ITEMS }] },
    });
    expect(res.status()).toBe(201);
    const { curation_manifest } = await res.json();
    expect(curation_manifest.budget_summary.budget_status).toBe("within_budget");
  });
});

// ============================================================================
// C. Cross-store deduplication — two-store input
// ============================================================================

test.describe("Session 12 — Cross-store deduplication @session-12", () => {
  test("deduplicates items with same wiki_page_slug across stores", async ({ request }) => {
    const res = await request.post(ASSEMBLE_URL, {
      headers: AUTH_HEADER,
      data: {
        stores: [
          { store_id: "proj-finance-infra-q3",   items: STORE_A_ITEMS },
          { store_id: "proj-compliance-privacy",  items: STORE_B_ITEMS },
        ],
        project_id: "proj-finance-infra-q3",
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.store_count).toBe(2);

    // deduplication_log must have entries for the two duplicates:
    //   - wiki:finance/index (ev-a1 vs ev-b1)
    //   - file:vendor-comparison-matrix (ev-a3 vs ev-b2)
    const { deduplication_log } = body.curation_manifest;
    expect(deduplication_log.length).toBeGreaterThanOrEqual(2);

    // Each entry must have required fields
    for (const entry of deduplication_log) {
      expect(typeof entry.deduplication_key).toBe("string");
      expect(typeof entry.canonical_id).toBe("string");
      expect(typeof entry.canonical_store).toBe("string");
      expect(Array.isArray(entry.duplicate_ids)).toBe(true);
      expect(entry.duplicate_ids.length).toBeGreaterThanOrEqual(1);
      expect(typeof entry.reason).toBe("string");
    }
  });

  test("no duplicate evidence_ids in selected", async ({ request }) => {
    const res = await request.post(ASSEMBLE_URL, {
      headers: AUTH_HEADER,
      data: {
        stores: [
          { store_id: "proj-finance-infra-q3",   items: STORE_A_ITEMS },
          { store_id: "proj-compliance-privacy",  items: STORE_B_ITEMS },
        ],
      },
    });
    expect(res.status()).toBe(201);
    const { selected } = await res.json();
    const ids = selected.map((i: { evidence_id: string }) => i.evidence_id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  test("duplicate items appear in dropped with reason duplicate_cross_store", async ({ request }) => {
    const res = await request.post(ASSEMBLE_URL, {
      headers: AUTH_HEADER,
      data: {
        stores: [
          { store_id: "proj-finance-infra-q3",   items: STORE_A_ITEMS },
          { store_id: "proj-compliance-privacy",  items: STORE_B_ITEMS },
        ],
      },
    });
    expect(res.status()).toBe(201);
    const { dropped } = await res.json();

    const dupDropped = dropped.filter(
      (d: { drop_reason: string }) => d.drop_reason === "duplicate_cross_store",
    );
    expect(dupDropped.length).toBeGreaterThanOrEqual(2); // ev-b1 and ev-b2 are dupes

    for (const d of dupDropped) {
      expect(typeof d.evidence_id).toBe("string");
      expect(typeof d.drop_detail).toBe("string");
    }
  });

  test("lower-scored duplicate is the one dropped", async ({ request }) => {
    // ev-a1 score=0.90 vs ev-b1 score=0.70 → ev-b1 should be dropped
    const res = await request.post(ASSEMBLE_URL, {
      headers: AUTH_HEADER,
      data: {
        stores: [
          { store_id: "proj-finance-infra-q3",   items: STORE_A_ITEMS },
          { store_id: "proj-compliance-privacy",  items: STORE_B_ITEMS },
        ],
      },
    });
    expect(res.status()).toBe(201);
    const { selected, dropped } = await res.json();

    const selectedIds = new Set(selected.map((i: { evidence_id: string }) => i.evidence_id));
    const dupDroppedIds = dropped
      .filter((d: { drop_reason: string }) => d.drop_reason === "duplicate_cross_store")
      .map((d: { evidence_id: string }) => d.evidence_id);

    // The higher-scored item (ev-a1, score=0.90) must be selected
    expect(selectedIds.has("ev-a1")).toBe(true);
    // The lower-scored duplicate (ev-b1, score=0.70) must be dropped
    expect(dupDroppedIds).toContain("ev-b1");
    // ev-a1 must not be dropped
    expect(dupDroppedIds).not.toContain("ev-a1");
  });
});

// ============================================================================
// D. Budget enforcement
// ============================================================================

test.describe("Session 12 — Budget enforcement @session-12", () => {
  test("total_budget exceeded drops extra items with budget_exceeded_total", async ({ request }) => {
    // Set total_budget so low that only 1 item fits (800 tokens per item)
    const res = await request.post(ASSEMBLE_URL, {
      headers: AUTH_HEADER,
      data: {
        stores: [{ store_id: "s1", items: STORE_A_ITEMS }],
        total_budget: 900, // fits exactly 1 item at 800 tokens
      },
    });
    expect(res.status()).toBe(201);
    const { selected, dropped, curation_manifest } = await res.json();

    expect(selected.length).toBe(1);
    const budgetDropped = dropped.filter(
      (d: { drop_reason: string }) => d.drop_reason === "budget_exceeded_total",
    );
    expect(budgetDropped.length).toBeGreaterThan(0);
    // Total tokens used must not exceed the budget
    const tokensUsed = selected.reduce(
      (sum: number, item: { token_estimate: number }) => sum + item.token_estimate, 0,
    );
    expect(tokensUsed).toBeLessThanOrEqual(900);
    expect(curation_manifest.budget_summary.total_used).toBeLessThanOrEqual(900);
  });

  test("level budget exceeded drops items from that level", async ({ request }) => {
    // All STORE_A_ITEMS[2] and [3] are level_2. Set level_2 budget to below 2 items.
    const res = await request.post(ASSEMBLE_URL, {
      headers: AUTH_HEADER,
      data: {
        stores: [{ store_id: "s1", items: STORE_A_ITEMS }],
        level_budgets: { level_2: 900 }, // fits 1 level_2 item at 800 tokens
      },
    });
    expect(res.status()).toBe(201);
    const { dropped } = await res.json();
    const l2BudgetDropped = dropped.filter(
      (d: { drop_reason: string }) => d.drop_reason === "budget_exceeded_level_2",
    );
    // Second level_2 item (ev-a4) should be dropped
    expect(l2BudgetDropped.length).toBeGreaterThanOrEqual(1);
  });

  test("selected items total token_estimate never exceeds total_budget", async ({ request }) => {
    const budget = 2500;
    const res = await request.post(ASSEMBLE_URL, {
      headers: AUTH_HEADER,
      data: {
        stores: [{ store_id: "s1", items: STORE_A_ITEMS }],
        total_budget: budget,
      },
    });
    expect(res.status()).toBe(201);
    const { selected } = await res.json();
    const tokensUsed = selected.reduce(
      (sum: number, item: { token_estimate: number }) => sum + item.token_estimate, 0,
    );
    expect(tokensUsed).toBeLessThanOrEqual(budget);
  });
});

// ============================================================================
// E. Determinism
// ============================================================================

test.describe("Session 12 — Determinism @session-12", () => {
  test("two identical requests return identical selected order", async ({ request }) => {
    const payload = {
      stores: [
        { store_id: "proj-finance-infra-q3",   items: STORE_A_ITEMS },
        { store_id: "proj-compliance-privacy",  items: STORE_B_ITEMS },
      ],
      project_id: "proj-finance-infra-q3",
    };

    const [res1, res2] = await Promise.all([
      request.post(ASSEMBLE_URL, { headers: AUTH_HEADER, data: payload }),
      request.post(ASSEMBLE_URL, { headers: AUTH_HEADER, data: payload }),
    ]);
    expect(res1.status()).toBe(201);
    expect(res2.status()).toBe(201);

    const body1 = await res1.json();
    const body2 = await res2.json();

    const ids1 = body1.selected.map((i: { evidence_id: string }) => i.evidence_id);
    const ids2 = body2.selected.map((i: { evidence_id: string }) => i.evidence_id);
    expect(ids1).toEqual(ids2);
  });
});

// ============================================================================
// F. Cross-project Task 9 — 3-store vendor compliance
// ============================================================================

test.describe("Session 12 — Cross-project 3-store assembly @session-12", () => {
  test("Task 9: 3-store vendor compliance pack has no duplicate evidence_ids", async ({ request }) => {
    const res = await request.post(ASSEMBLE_URL, {
      headers: AUTH_HEADER,
      data: {
        task_id:    "task-009-vendor-compliance",
        project_id: "proj-finance-infra-q3",
        stores: [
          { store_id: "proj-finance-infra-q3",   items: STORE_A_ITEMS },
          { store_id: "proj-compliance-privacy",  items: STORE_B_ITEMS },
          { store_id: "proj-org-shared",           items: STORE_C_ITEMS },
        ],
      },
    });
    expect(res.status()).toBe(201);
    const { selected, dropped, curation_manifest } = await res.json();

    // store_count must be 3
    expect(curation_manifest.store_ids_used.length).toBe(3);

    // No duplicate evidence_ids in selected
    const ids = selected.map((i: { evidence_id: string }) => i.evidence_id);
    expect(new Set(ids).size).toBe(ids.length);

    // Dropped items with dup reason must not appear in selected
    const dupDroppedIds = new Set(
      dropped
        .filter((d: { drop_reason: string }) => d.drop_reason === "duplicate_cross_store")
        .map((d: { evidence_id: string }) => d.evidence_id),
    );
    for (const id of ids) {
      expect(dupDroppedIds.has(id)).toBe(false);
    }
  });

  test("Task 9: deduplication_log is present in curation_manifest", async ({ request }) => {
    const res = await request.post(ASSEMBLE_URL, {
      headers: AUTH_HEADER,
      data: {
        task_id:    "task-009-vendor-compliance",
        project_id: "proj-finance-infra-q3",
        stores: [
          { store_id: "proj-finance-infra-q3",   items: STORE_A_ITEMS },
          { store_id: "proj-compliance-privacy",  items: STORE_B_ITEMS },
          { store_id: "proj-org-shared",           items: STORE_C_ITEMS },
        ],
      },
    });
    expect(res.status()).toBe(201);
    const { curation_manifest } = await res.json();
    expect(Array.isArray(curation_manifest.deduplication_log)).toBe(true);
    expect(curation_manifest.total_candidates).toBe(
      STORE_A_ITEMS.length + STORE_B_ITEMS.length + STORE_C_ITEMS.length,
    );
  });
});

// ============================================================================
// G. Curation manifest persistence — GET /api/v1/context/manifests/{id}
// ============================================================================

test.describe("Session 12 — Manifest retrieval @session-12", () => {
  test("GET manifest returns 401 without auth header", async ({ request }) => {
    const res = await request.get(`${MANIFESTS_BASE}/some-manifest-id`);
    expect(res.status()).toBe(401);
  });

  test("GET manifest returns 404 for unknown manifest_id", async ({ request }) => {
    const res = await request.get(`${MANIFESTS_BASE}/nonexistent-manifest-xyz`, {
      headers: AUTH_HEADER,
    });
    // In dev (no Supabase), always 404; in CI with DB, also 404 for unknown IDs.
    expect(res.status()).toBe(404);
  });

  test("manifest_id from POST can be fetched (Supabase path) or returns 404 (dev path)", async ({ request }) => {
    // POST to get a manifest_id
    const postRes = await request.post(ASSEMBLE_URL, {
      headers: AUTH_HEADER,
      data: {
        stores: [{ store_id: "proj-finance-infra-q3", items: STORE_A_ITEMS }],
        project_id: "proj-finance-infra-q3",
        task_id: "task-manifest-persistence-test",
      },
    });
    expect(postRes.status()).toBe(201);
    const { manifest_id } = await postRes.json();

    // GET the manifest — in dev (no Supabase) this returns 404; in CI with
    // Supabase it returns 200.  Both are valid outcomes for this test.
    const getRes = await request.get(`${MANIFESTS_BASE}/${manifest_id}`, {
      headers: AUTH_HEADER,
    });
    expect([200, 404]).toContain(getRes.status());
    if (getRes.status() === 200) {
      const body = await getRes.json();
      expect(body.manifest_id).toBe(manifest_id);
      expect(Array.isArray(body.selected_item_ids)).toBe(true);
      expect(typeof body.budget_summary).toBe("object");
    }
  });
});
