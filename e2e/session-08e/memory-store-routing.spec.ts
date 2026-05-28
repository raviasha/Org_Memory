/**
 * e2e/session-08e/memory-store-routing.spec.ts
 *
 * Session 8e — Memory-store routing catalog and scoring layer
 * @session-08e
 *
 * Exit criteria:
 *
 *  A. Happy path — POST /api/v1/stores/route:
 *     - Given a task anchored to a project, returns ranked_stores list with
 *       per-store evidence targets and token budget estimates.
 *     - Response shape matches the routing contract.
 *     - routing_id is present and non-empty.
 *     - routing_events array is non-empty.
 *
 *  B. Determinism — scoring is stable for the same input:
 *     - Two identical requests return the same ranked_stores ordering and
 *       the same scores.
 *
 *  C. ACL filtering:
 *     - A request with acl_scope that does not match any store's scope
 *       results in acl_filtered_count === total_candidates and an empty
 *       ranked_stores array.
 *     - "org:acme:legal" sub-scope satisfies "org:acme" stores (prefix match).
 *
 *  D. Store-count cap enforcement:
 *     - Requesting max_stores=1 returns exactly 1 store in ranked_stores.
 *     - applied_cap matches the requested max_stores.
 *     - routing_events include a "cap_applied" entry.
 *
 *  E. Budget-exceeded escalation:
 *     - memory_file_budget=1 (1 000 tokens total) with 5 candidate stores
 *       (each with memory_count > 1) triggers budget_status = "exceeded".
 *     - escalation_message is non-null and non-empty.
 *     - ranking and routing_events are still present (escalation ≠ failure).
 *
 *  F. Guard paths:
 *     - 401 without auth header.
 *     - 400 when task_text is missing.
 *     - 400 when project_id is missing.
 *     - 400 when max_stores is 0 or negative.
 *     - 400 when memory_file_budget is 0 or negative.
 */

import { test, expect } from "@playwright/test";

const AUTH_HEADER = { Authorization: "Bearer prototype-dev-token" };
const BASE_API = "/api/v1";
const ENDPOINT = `${BASE_API}/stores/route`;

const TEST_PROJECT = "proj-finance-infra-q3";
const TEST_TASK = "Calculate the NPV of the Q3 infrastructure investment at the CFO discount rate and recommend the best vendor.";

// ---------------------------------------------------------------------------
// F. Guard paths
// ---------------------------------------------------------------------------

test.describe("Session 08e — Guard paths @session-08e", () => {
  test("returns 401 without auth header", async ({ request }) => {
    const res = await request.post(ENDPOINT, {
      data: { task_text: TEST_TASK, project_id: TEST_PROJECT },
    });
    expect(res.status()).toBe(401);
    const json = await res.json();
    expect(json).toMatchObject({ error: "Unauthorized" });
  });

  test("returns 400 when task_text is missing", async ({ request }) => {
    const res = await request.post(ENDPOINT, {
      headers: AUTH_HEADER,
      data: { project_id: TEST_PROJECT },
    });
    expect(res.status()).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/task_text/i);
  });

  test("returns 400 when project_id is missing", async ({ request }) => {
    const res = await request.post(ENDPOINT, {
      headers: AUTH_HEADER,
      data: { task_text: TEST_TASK },
    });
    expect(res.status()).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/project_id/i);
  });

  test("returns 400 when max_stores is 0", async ({ request }) => {
    const res = await request.post(ENDPOINT, {
      headers: AUTH_HEADER,
      data: { task_text: TEST_TASK, project_id: TEST_PROJECT, max_stores: 0 },
    });
    expect(res.status()).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/max_stores/i);
  });

  test("returns 400 when max_stores is negative", async ({ request }) => {
    const res = await request.post(ENDPOINT, {
      headers: AUTH_HEADER,
      data: { task_text: TEST_TASK, project_id: TEST_PROJECT, max_stores: -1 },
    });
    expect(res.status()).toBe(400);
  });

  test("returns 400 when memory_file_budget is 0", async ({ request }) => {
    const res = await request.post(ENDPOINT, {
      headers: AUTH_HEADER,
      data: {
        task_text: TEST_TASK,
        project_id: TEST_PROJECT,
        memory_file_budget: 0,
      },
    });
    expect(res.status()).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/memory_file_budget/i);
  });
});

// ---------------------------------------------------------------------------
// A. Happy path
// ---------------------------------------------------------------------------

test.describe("Session 08e — Happy path @session-08e", () => {
  test("returns 201 with ranked_stores, events, and budget for financial task", async ({
    request,
  }) => {
    const res = await request.post(ENDPOINT, {
      headers: AUTH_HEADER,
      data: {
        task_text: TEST_TASK,
        project_id: TEST_PROJECT,
        acl_scope: "org:acme",
      },
    });
    expect(res.status()).toBe(201);
    const json = await res.json();

    // Top-level shape
    expect(json).toHaveProperty("routing_id");
    expect(typeof json.routing_id).toBe("string");
    expect(json.routing_id.length).toBeGreaterThan(0);

    expect(json).toHaveProperty("task_intent");
    expect(typeof json.task_intent).toBe("string");

    expect(json).toHaveProperty("task_intent_label");
    expect(typeof json.task_intent_label).toBe("string");

    expect(Array.isArray(json.task_entities)).toBe(true);

    expect(Array.isArray(json.ranked_stores)).toBe(true);
    expect(json.ranked_stores.length).toBeGreaterThanOrEqual(1);
    expect(json.ranked_stores.length).toBeLessThanOrEqual(3); // default cap

    // Each ranked store has required fields
    for (const store of json.ranked_stores) {
      expect(store).toHaveProperty("rank");
      expect(typeof store.rank).toBe("number");
      expect(store).toHaveProperty("memory_store_id");
      expect(typeof store.memory_store_id).toBe("string");
      expect(store).toHaveProperty("project_id");
      expect(store).toHaveProperty("name");
      expect(store).toHaveProperty("score");
      expect(typeof store.score).toBe("number");
      expect(store.score).toBeGreaterThan(0);
      expect(store.score).toBeLessThanOrEqual(1);
      expect(store).toHaveProperty("score_breakdown");
      expect(store.score_breakdown).toHaveProperty("intent_match");
      expect(store.score_breakdown).toHaveProperty("hierarchy_proximity");
      expect(store.score_breakdown).toHaveProperty("freshness");
      expect(store.score_breakdown).toHaveProperty("historical_helpfulness");
      expect(Array.isArray(store.evidence_targets)).toBe(true);
      expect(store).toHaveProperty("token_budget_estimate");
      expect(typeof store.token_budget_estimate).toBe("number");
      expect(store.token_budget_estimate).toBeGreaterThan(0);
      expect(store).toHaveProperty("attach_mode");
      expect(store.acl_eligible).toBe(true);
    }

    // Ranking is ordered by score descending
    for (let i = 1; i < json.ranked_stores.length; i++) {
      expect(json.ranked_stores[i - 1].score).toBeGreaterThanOrEqual(
        json.ranked_stores[i].score,
      );
    }

    // Anti-bloat fields
    expect(json).toHaveProperty("applied_cap");
    expect(json).toHaveProperty("total_candidates");
    expect(json.total_candidates).toBeGreaterThan(0);
    expect(json).toHaveProperty("acl_filtered_count");
    expect(json).toHaveProperty("budget_status");
    expect(["ok", "exceeded"]).toContain(json.budget_status);
    expect(json).toHaveProperty("created_at");

    // Routing events
    expect(Array.isArray(json.routing_events)).toBe(true);
    expect(json.routing_events.length).toBeGreaterThan(0);
    for (const ev of json.routing_events) {
      expect(ev).toHaveProperty("event_type");
      expect(ev).toHaveProperty("detail");
      expect(ev).toHaveProperty("occurred_at");
    }

    // Should contain intent_parsed event
    const intentEvent = json.routing_events.find(
      (e: { event_type: string }) => e.event_type === "intent_parsed",
    );
    expect(intentEvent).toBeDefined();

    // Should contain cap_applied event
    const capEvent = json.routing_events.find(
      (e: { event_type: string }) => e.event_type === "cap_applied",
    );
    expect(capEvent).toBeDefined();
  });

  test("finance task anchored to proj-finance-infra-q3 ranks Finance store first", async ({
    request,
  }) => {
    const res = await request.post(ENDPOINT, {
      headers: AUTH_HEADER,
      data: {
        task_text: "Calculate the NPV and recommend whether to proceed with the infrastructure investment.",
        project_id: "proj-finance-infra-q3",
        acl_scope: "org:acme",
      },
    });
    expect(res.status()).toBe(201);
    const json = await res.json();
    expect(json.ranked_stores.length).toBeGreaterThanOrEqual(1);
    // Finance store (same project) should be ranked #1
    expect(json.ranked_stores[0].project_id).toBe("proj-finance-infra-q3");
    expect(json.ranked_stores[0].rank).toBe(1);
    expect(json.task_intent).toBe("financial_analysis");
  });

  test("compliance task anchored to proj-compliance-privacy ranks Compliance store first", async ({
    request,
  }) => {
    const res = await request.post(ENDPOINT, {
      headers: AUTH_HEADER,
      data: {
        task_text: "Draft a data processing agreement for our new analytics vendor ensuring GDPR compliance.",
        project_id: "proj-compliance-privacy",
        acl_scope: "org:acme",
      },
    });
    expect(res.status()).toBe(201);
    const json = await res.json();
    expect(json.ranked_stores[0].project_id).toBe("proj-compliance-privacy");
    expect(json.task_intent).toBe("compliance_check");
  });

  test("incident ops task anchored to proj-eng-incident-ops ranks Eng Ops store first", async ({
    request,
  }) => {
    const res = await request.post(ENDPOINT, {
      headers: AUTH_HEADER,
      data: {
        task_text: "The API gateway is returning 502 errors. What are the immediate runbook steps?",
        project_id: "proj-eng-incident-ops",
        acl_scope: "org:acme",
      },
    });
    expect(res.status()).toBe(201);
    const json = await res.json();
    expect(json.ranked_stores[0].project_id).toBe("proj-eng-incident-ops");
    expect(json.task_intent).toBe("operations_review");
  });
});

// ---------------------------------------------------------------------------
// B. Determinism
// ---------------------------------------------------------------------------

test.describe("Session 08e — Determinism @session-08e", () => {
  test("identical requests return the same ranked_stores order and scores", async ({
    request,
  }) => {
    const body = {
      task_text: TEST_TASK,
      project_id: TEST_PROJECT,
      acl_scope: "org:acme",
    };

    const [res1, res2] = await Promise.all([
      request.post(ENDPOINT, { headers: AUTH_HEADER, data: body }),
      request.post(ENDPOINT, { headers: AUTH_HEADER, data: body }),
    ]);

    expect(res1.status()).toBe(201);
    expect(res2.status()).toBe(201);

    const j1 = await res1.json();
    const j2 = await res2.json();

    // Same intent
    expect(j1.task_intent).toBe(j2.task_intent);

    // Same number of stores
    expect(j1.ranked_stores.length).toBe(j2.ranked_stores.length);

    // Same ordering and scores (routing_id will differ — that is expected)
    for (let i = 0; i < j1.ranked_stores.length; i++) {
      expect(j1.ranked_stores[i].memory_store_id).toBe(
        j2.ranked_stores[i].memory_store_id,
      );
      expect(j1.ranked_stores[i].score).toBe(j2.ranked_stores[i].score);
    }
  });
});

// ---------------------------------------------------------------------------
// C. ACL filtering
// ---------------------------------------------------------------------------

test.describe("Session 08e — ACL filtering @session-08e", () => {
  test("acl_scope that matches no store returns empty ranked_stores", async ({
    request,
  }) => {
    const res = await request.post(ENDPOINT, {
      headers: AUTH_HEADER,
      data: {
        task_text: TEST_TASK,
        project_id: TEST_PROJECT,
        acl_scope: "org:competitor:secret", // no store has this scope
      },
    });
    expect(res.status()).toBe(201);
    const json = await res.json();

    expect(json.ranked_stores).toHaveLength(0);
    expect(json.acl_filtered_count).toBe(json.total_candidates);
    // budget_status is ok (nothing selected)
    expect(json.budget_status).toBe("ok");

    // Should have acl_rejected events
    const rejectedEvents = json.routing_events.filter(
      (e: { event_type: string }) => e.event_type === "acl_rejected",
    );
    expect(rejectedEvents.length).toBeGreaterThan(0);
  });

  test("sub-scope prefix match: org:acme:legal satisfies org:acme stores", async ({
    request,
  }) => {
    const res = await request.post(ENDPOINT, {
      headers: AUTH_HEADER,
      data: {
        task_text: "Review GDPR compliance checklist and data retention policy.",
        project_id: "proj-compliance-privacy",
        acl_scope: "org:acme:legal", // prefix match against "org:acme"
      },
    });
    expect(res.status()).toBe(201);
    const json = await res.json();

    // All "org:acme" stores should be eligible for "org:acme:legal"
    expect(json.ranked_stores.length).toBeGreaterThan(0);
    expect(json.acl_filtered_count).toBe(0);
  });

  test("acl_filtered_count reflects number of ACL-ineligible stores", async ({
    request,
  }) => {
    // Use "org:acme" which matches all 5 seeded stores
    const res = await request.post(ENDPOINT, {
      headers: AUTH_HEADER,
      data: {
        task_text: TEST_TASK,
        project_id: TEST_PROJECT,
        acl_scope: "org:acme",
      },
    });
    expect(res.status()).toBe(201);
    const json = await res.json();

    // All 5 stores have acl_scope "org:acme" → acl_filtered_count = 0
    expect(json.acl_filtered_count).toBe(0);
    expect(json.total_candidates).toBeGreaterThanOrEqual(5);
  });
});

// ---------------------------------------------------------------------------
// D. Store-count cap enforcement
// ---------------------------------------------------------------------------

test.describe("Session 08e — Cap enforcement @session-08e", () => {
  test("max_stores=1 returns exactly 1 store", async ({ request }) => {
    const res = await request.post(ENDPOINT, {
      headers: AUTH_HEADER,
      data: {
        task_text: TEST_TASK,
        project_id: TEST_PROJECT,
        acl_scope: "org:acme",
        max_stores: 1,
      },
    });
    expect(res.status()).toBe(201);
    const json = await res.json();

    expect(json.ranked_stores).toHaveLength(1);
    expect(json.applied_cap).toBe(1);

    // cap_applied event present
    const capEvent = json.routing_events.find(
      (e: { event_type: string }) => e.event_type === "cap_applied",
    );
    expect(capEvent).toBeDefined();
    expect(capEvent.detail).toMatch(/cap.*1/i);
  });

  test("max_stores=2 returns at most 2 stores", async ({ request }) => {
    const res = await request.post(ENDPOINT, {
      headers: AUTH_HEADER,
      data: {
        task_text: TEST_TASK,
        project_id: TEST_PROJECT,
        acl_scope: "org:acme",
        max_stores: 2,
      },
    });
    expect(res.status()).toBe(201);
    const json = await res.json();

    expect(json.ranked_stores.length).toBeLessThanOrEqual(2);
    expect(json.applied_cap).toBe(2);
  });

  test("default cap (3) is applied when max_stores not specified", async ({
    request,
  }) => {
    const res = await request.post(ENDPOINT, {
      headers: AUTH_HEADER,
      data: {
        task_text: TEST_TASK,
        project_id: TEST_PROJECT,
        acl_scope: "org:acme",
      },
    });
    expect(res.status()).toBe(201);
    const json = await res.json();

    expect(json.ranked_stores.length).toBeLessThanOrEqual(3);
    expect(json.applied_cap).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// E. Budget-exceeded escalation
// ---------------------------------------------------------------------------

test.describe("Session 08e — Budget escalation @session-08e", () => {
  test("memory_file_budget=1 triggers budget_status=exceeded with escalation_message", async ({
    request,
  }) => {
    // The Finance store alone has 8 memory files × 1000 tokens = 8000 tokens.
    // budget limit = 1 file × 1000 tokens = 1000 tokens → should be exceeded.
    const res = await request.post(ENDPOINT, {
      headers: AUTH_HEADER,
      data: {
        task_text: TEST_TASK,
        project_id: TEST_PROJECT,
        acl_scope: "org:acme",
        memory_file_budget: 1,
      },
    });
    expect(res.status()).toBe(201);
    const json = await res.json();

    expect(json.budget_status).toBe("exceeded");
    expect(typeof json.escalation_message).toBe("string");
    expect(json.escalation_message.length).toBeGreaterThan(0);

    // ranked_stores still present (escalation ≠ empty response)
    expect(json.ranked_stores.length).toBeGreaterThan(0);

    // routing_events include budget_exceeded
    const budgetEvent = json.routing_events.find(
      (e: { event_type: string }) => e.event_type === "budget_exceeded",
    );
    expect(budgetEvent).toBeDefined();
  });

  test("generous budget (1000 files) results in budget_status=ok", async ({
    request,
  }) => {
    const res = await request.post(ENDPOINT, {
      headers: AUTH_HEADER,
      data: {
        task_text: TEST_TASK,
        project_id: TEST_PROJECT,
        acl_scope: "org:acme",
        memory_file_budget: 1000,
      },
    });
    expect(res.status()).toBe(201);
    const json = await res.json();

    expect(json.budget_status).toBe("ok");
    expect(json.escalation_message).toBeNull();

    // budget_ok event present
    const budgetOkEvent = json.routing_events.find(
      (e: { event_type: string }) => e.event_type === "budget_ok",
    );
    expect(budgetOkEvent).toBeDefined();
  });

  test("escalation_message includes token count and budget limit details", async ({
    request,
  }) => {
    const res = await request.post(ENDPOINT, {
      headers: AUTH_HEADER,
      data: {
        task_text: TEST_TASK,
        project_id: TEST_PROJECT,
        acl_scope: "org:acme",
        memory_file_budget: 1,
      },
    });
    const json = await res.json();
    // escalation_message should mention tokens and budget
    expect(json.escalation_message).toMatch(/token/i);
    expect(json.escalation_message).toMatch(/budget|limit/i);
  });
});
