/**
 * e2e/session-11/specific-file-picker.spec.ts
 *
 * Session 11 — Level 2 specific-file picker
 * @session-11
 *
 * Exit criteria:
 *
 *  A. Guard paths — POST /api/v1/retrieval/level2:
 *     - 401 without auth header.
 *     - 400 when task_text is missing or empty.
 *     - 400 when limit is out of range (0, >50, non-integer).
 *     - 400 when candidate_evidence_ids is not an array.
 *
 *  B. Happy path — response shape:
 *     - 200 with all required top-level fields.
 *     - intent_classes is a non-empty array for a recognised task.
 *     - selected, forced_inclusions, missing_required_patterns, dropped
 *       are all arrays.
 *     - Each item in selected has: evidence_id, retrieval_level="level_2",
 *       forced (boolean), score (number 0–1), rationale (non-empty string).
 *     - Forced items have score=1.0.
 *
 *  C. NPV exit criteria — specificity enforcement:
 *     - specificity_enforced = true.
 *     - forced_inclusions contains an item whose file_path_or_url includes
 *       "infrastructure-investment-business-case" with forced=true and
 *       forced_by_rule="npv-business-case".
 *     - That item appears in selected (forced items listed first).
 *
 *  D. Vendor selection — specificity enforcement:
 *     - vendor-comparison-matrix appears in forced_inclusions.
 *
 *  E. Incident task — api-gateway-runbook is in forced_inclusions.
 *
 *  F. Project scoping:
 *     - All selected items belong to the requested project_id.
 *
 *  G. Limit enforcement:
 *     - selected.length ≤ requested limit.
 *
 *  H. Determinism:
 *     - Two identical requests return identical selected evidence_id order.
 *
 *  I. candidate_evidence_ids pre-filter:
 *     - Only items within the provided ID set appear in selected.
 */

import { test, expect } from "@playwright/test";

const AUTH_HEADER = { Authorization: "Bearer prototype-dev-token" };
const LEVEL2_ENDPOINT = "/api/v1/retrieval/level2";

const FINANCE_PROJECT = "proj-finance-infra-q3";
const ENG_PROJECT     = "proj-eng-incident-ops";

const NPV_TASK =
  "Calculate the NPV of the Q3 infrastructure investment at the CFO-specified discount rate and recommend whether to proceed. The proposal shows an IRR of 14.2%.";

const VENDOR_TASK =
  "Which vendor should we select based on cost, capabilities, and SLA alignment with our RFP requirements?";

const INCIDENT_TASK =
  "The API gateway is returning 502 errors in production. What are the immediate steps?";

// ---------------------------------------------------------------------------
// A. Guard paths
// ---------------------------------------------------------------------------

test.describe("Session 11 — Level 2 guard paths @session-11", () => {
  test("returns 401 without auth header", async ({ request }) => {
    const res = await request.post(LEVEL2_ENDPOINT, {
      data: { task_text: NPV_TASK },
    });
    expect(res.status()).toBe(401);
    expect(await res.json()).toMatchObject({ error: "Unauthorized" });
  });

  test("returns 400 when task_text is missing", async ({ request }) => {
    const res = await request.post(LEVEL2_ENDPOINT, {
      headers: AUTH_HEADER,
      data: { project_id: FINANCE_PROJECT },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).code).toBe("missing_task_text");
  });

  test("returns 400 when task_text is an empty string", async ({ request }) => {
    const res = await request.post(LEVEL2_ENDPOINT, {
      headers: AUTH_HEADER,
      data: { task_text: "   " },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).code).toBe("missing_task_text");
  });

  test("returns 400 when limit is 0", async ({ request }) => {
    const res = await request.post(LEVEL2_ENDPOINT, {
      headers: AUTH_HEADER,
      data: { task_text: NPV_TASK, limit: 0 },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).code).toBe("invalid_limit");
  });

  test("returns 400 when limit exceeds 50", async ({ request }) => {
    const res = await request.post(LEVEL2_ENDPOINT, {
      headers: AUTH_HEADER,
      data: { task_text: NPV_TASK, limit: 51 },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).code).toBe("invalid_limit");
  });

  test("returns 400 when candidate_evidence_ids is not an array", async ({
    request,
  }) => {
    const res = await request.post(LEVEL2_ENDPOINT, {
      headers: AUTH_HEADER,
      data: { task_text: NPV_TASK, candidate_evidence_ids: "not-an-array" },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).code).toBe("invalid_candidate_evidence_ids");
  });
});

// ---------------------------------------------------------------------------
// B. Happy path — response shape
// ---------------------------------------------------------------------------

test.describe("Session 11 — Level 2 response shape @session-11", () => {
  test("returns 200 with all required top-level fields", async ({ request }) => {
    const res = await request.post(LEVEL2_ENDPOINT, {
      headers: AUTH_HEADER,
      data: { task_text: NPV_TASK, project_id: FINANCE_PROJECT },
    });
    expect(res.status()).toBe(200);
    const json = await res.json();

    expect(typeof json.task_text).toBe("string");
    expect(json.task_text).toBe(NPV_TASK);
    expect(Array.isArray(json.intent_classes)).toBe(true);
    expect(typeof json.specificity_enforced).toBe("boolean");
    expect(Array.isArray(json.forced_inclusions)).toBe(true);
    expect(Array.isArray(json.missing_required_patterns)).toBe(true);
    expect(Array.isArray(json.selected)).toBe(true);
    expect(Array.isArray(json.dropped)).toBe(true);
    expect(typeof json.total_candidates).toBe("number");
  });

  test("each selected item has all required fields with correct types", async ({
    request,
  }) => {
    const res = await request.post(LEVEL2_ENDPOINT, {
      headers: AUTH_HEADER,
      data: { task_text: NPV_TASK, project_id: FINANCE_PROJECT },
    });
    const json = await res.json();

    for (const item of json.selected) {
      expect(typeof item.evidence_id).toBe("string");
      expect(item.evidence_id.length).toBeGreaterThan(0);
      expect(item.retrieval_level).toBe("level_2");
      expect(typeof item.forced).toBe("boolean");
      expect(typeof item.score).toBe("number");
      expect(item.score).toBeGreaterThanOrEqual(0);
      expect(item.score).toBeLessThanOrEqual(1);
      expect(typeof item.rationale).toBe("string");
      expect(item.rationale.length).toBeGreaterThan(0);
    }
  });

  test("intent_classes is non-empty and includes financial_analysis for NPV task", async ({
    request,
  }) => {
    const res = await request.post(LEVEL2_ENDPOINT, {
      headers: AUTH_HEADER,
      data: { task_text: NPV_TASK },
    });
    const json = await res.json();
    expect(json.intent_classes.length).toBeGreaterThan(0);
    expect(json.intent_classes).toContain("financial_analysis");
  });

  test("forced items have score=1.0", async ({ request }) => {
    const res = await request.post(LEVEL2_ENDPOINT, {
      headers: AUTH_HEADER,
      data: { task_text: NPV_TASK, project_id: FINANCE_PROJECT },
    });
    const json = await res.json();
    for (const item of json.forced_inclusions) {
      expect(item.score).toBe(1.0);
    }
  });
});

// ---------------------------------------------------------------------------
// C. NPV exit criteria — specificity enforcement
// ---------------------------------------------------------------------------

test.describe("Session 11 — NPV specificity enforcement (exit criteria) @session-11", () => {
  test("specificity_enforced is true for NPV task", async ({ request }) => {
    const res = await request.post(LEVEL2_ENDPOINT, {
      headers: AUTH_HEADER,
      data: { task_text: NPV_TASK, project_id: FINANCE_PROJECT },
    });
    expect((await res.json()).specificity_enforced).toBe(true);
  });

  test("forced_inclusions contains the business-case file with correct metadata", async ({
    request,
  }) => {
    const res = await request.post(LEVEL2_ENDPOINT, {
      headers: AUTH_HEADER,
      data: { task_text: NPV_TASK, project_id: FINANCE_PROJECT },
    });
    const json = await res.json();

    const businessCase = json.forced_inclusions.find(
      (f: { file_path_or_url?: string }) =>
        f.file_path_or_url?.includes("infrastructure-investment-business-case"),
    );
    expect(businessCase).toBeDefined();
    expect(businessCase.forced).toBe(true);
    expect(businessCase.forced_by_rule).toBe("npv-business-case");
    expect(businessCase.retrieval_level).toBe("level_2");
    expect(typeof businessCase.rationale).toBe("string");
    expect(businessCase.rationale.length).toBeGreaterThan(0);
  });

  test("business-case file appears in selected array", async ({ request }) => {
    const res = await request.post(LEVEL2_ENDPOINT, {
      headers: AUTH_HEADER,
      data: { task_text: NPV_TASK, project_id: FINANCE_PROJECT },
    });
    const json = await res.json();

    const businessCase = json.selected.find(
      (s: { file_path_or_url?: string }) =>
        s.file_path_or_url?.includes("infrastructure-investment-business-case"),
    );
    expect(businessCase).toBeDefined();
  });

  test("all forced items appear at the start of selected", async ({ request }) => {
    const res = await request.post(LEVEL2_ENDPOINT, {
      headers: AUTH_HEADER,
      data: { task_text: NPV_TASK, project_id: FINANCE_PROJECT },
    });
    const json = await res.json();

    const forcedCount = json.forced_inclusions.length;
    expect(forcedCount).toBeGreaterThan(0);
    for (let i = 0; i < forcedCount; i++) {
      expect(json.selected[i].forced).toBe(true);
    }
  });

  test("all forced inclusions are present in selected", async ({ request }) => {
    const res = await request.post(LEVEL2_ENDPOINT, {
      headers: AUTH_HEADER,
      data: { task_text: NPV_TASK, project_id: FINANCE_PROJECT },
    });
    const json = await res.json();

    const selectedIds = new Set<string>(
      json.selected.map((s: { evidence_id: string }) => s.evidence_id),
    );
    for (const forced of json.forced_inclusions) {
      expect(selectedIds.has(forced.evidence_id)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// D. Vendor selection — specificity enforcement
// ---------------------------------------------------------------------------

test.describe("Session 11 — Vendor selection specificity @session-11", () => {
  test("vendor-comparison-matrix is in forced_inclusions", async ({
    request,
  }) => {
    const res = await request.post(LEVEL2_ENDPOINT, {
      headers: AUTH_HEADER,
      data: { task_text: VENDOR_TASK, project_id: FINANCE_PROJECT },
    });
    const json = await res.json();

    const hasMatrix = json.forced_inclusions.some(
      (f: { file_path_or_url?: string }) =>
        f.file_path_or_url?.includes("vendor-comparison-matrix"),
    );
    expect(hasMatrix).toBe(true);
  });

  test("specificity_enforced is true for vendor task", async ({ request }) => {
    const res = await request.post(LEVEL2_ENDPOINT, {
      headers: AUTH_HEADER,
      data: { task_text: VENDOR_TASK, project_id: FINANCE_PROJECT },
    });
    expect((await res.json()).specificity_enforced).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// E. Incident task — api-gateway-runbook
// ---------------------------------------------------------------------------

test.describe("Session 11 — API gateway incident specificity @session-11", () => {
  test("api-gateway-runbook is in forced_inclusions for 502 incident", async ({
    request,
  }) => {
    const res = await request.post(LEVEL2_ENDPOINT, {
      headers: AUTH_HEADER,
      data: { task_text: INCIDENT_TASK, project_id: ENG_PROJECT },
    });
    const json = await res.json();

    const hasRunbook = json.forced_inclusions.some(
      (f: { file_path_or_url?: string }) =>
        f.file_path_or_url?.includes("api-gateway-runbook"),
    );
    expect(hasRunbook).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// F. Project scoping
// ---------------------------------------------------------------------------

test.describe("Session 11 — Project scoping @session-11", () => {
  test("all selected items belong to the requested project_id", async ({
    request,
  }) => {
    const res = await request.post(LEVEL2_ENDPOINT, {
      headers: AUTH_HEADER,
      data: { task_text: NPV_TASK, project_id: FINANCE_PROJECT },
    });
    const json = await res.json();

    for (const item of json.selected) {
      expect(item.project_id).toBe(FINANCE_PROJECT);
    }
  });

  test("project_id is echoed in the result", async ({ request }) => {
    const res = await request.post(LEVEL2_ENDPOINT, {
      headers: AUTH_HEADER,
      data: { task_text: NPV_TASK, project_id: FINANCE_PROJECT },
    });
    expect((await res.json()).project_id).toBe(FINANCE_PROJECT);
  });
});

// ---------------------------------------------------------------------------
// G. Limit enforcement
// ---------------------------------------------------------------------------

test.describe("Session 11 — Limit enforcement @session-11", () => {
  test("selected.length is ≤ requested limit", async ({ request }) => {
    const res = await request.post(LEVEL2_ENDPOINT, {
      headers: AUTH_HEADER,
      data: { task_text: NPV_TASK, project_id: FINANCE_PROJECT, limit: 3 },
    });
    expect((await res.json()).selected.length).toBeLessThanOrEqual(3);
  });

  test("limit=1 returns at most 1 item", async ({ request }) => {
    const res = await request.post(LEVEL2_ENDPOINT, {
      headers: AUTH_HEADER,
      data: { task_text: NPV_TASK, project_id: FINANCE_PROJECT, limit: 1 },
    });
    expect((await res.json()).selected.length).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// H. Determinism
// ---------------------------------------------------------------------------

test.describe("Session 11 — Determinism @session-11", () => {
  test("two identical requests return identical selected evidence_id order", async ({
    request,
  }) => {
    const payload = { task_text: NPV_TASK, project_id: FINANCE_PROJECT };

    const [res1, res2] = await Promise.all([
      request.post(LEVEL2_ENDPOINT, { headers: AUTH_HEADER, data: payload }),
      request.post(LEVEL2_ENDPOINT, { headers: AUTH_HEADER, data: payload }),
    ]);

    const ids1 = (await res1.json()).selected.map(
      (s: { evidence_id: string }) => s.evidence_id,
    );
    const ids2 = (await res2.json()).selected.map(
      (s: { evidence_id: string }) => s.evidence_id,
    );
    expect(ids1).toEqual(ids2);
  });
});

// ---------------------------------------------------------------------------
// I. candidate_evidence_ids pre-filter
// ---------------------------------------------------------------------------

test.describe("Session 11 — candidate_evidence_ids pre-filter @session-11", () => {
  test("only returns items whose IDs are in the provided candidate set", async ({
    request,
  }) => {
    // a1001 = infrastructure-investment-business-case (static corpus ID)
    // a1002 = cfo-q3-guidance (static corpus ID)
    const res = await request.post(LEVEL2_ENDPOINT, {
      headers: AUTH_HEADER,
      data: {
        task_text: NPV_TASK,
        project_id: FINANCE_PROJECT,
        candidate_evidence_ids: ["a1001", "a1002"],
      },
    });
    const json = await res.json();

    for (const item of json.selected) {
      expect(["a1001", "a1002"]).toContain(item.evidence_id);
    }
    expect(json.total_candidates).toBeLessThanOrEqual(2);
  });

  test("returns empty selected when candidate set has no matching IDs", async ({
    request,
  }) => {
    const res = await request.post(LEVEL2_ENDPOINT, {
      headers: AUTH_HEADER,
      data: {
        task_text: NPV_TASK,
        project_id: FINANCE_PROJECT,
        candidate_evidence_ids: ["nonexistent-id-xyz-abc"],
      },
    });
    const json = await res.json();
    expect(json.selected).toHaveLength(0);
    expect(json.total_candidates).toBe(0);
  });
});
