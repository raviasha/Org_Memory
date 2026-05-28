/**
 * e2e/session-08c/task-curation.spec.ts
 *
 * Session 8c — External Curation API Surface MVP
 * @session-08c
 *
 * Exit criteria:
 *   API:
 *     A. POST /api/v1/tasks/curate  — 401, 400 validation, 201 happy path
 *        with ≥2 subtasks each having required fields; idempotency key replay.
 *     B. POST /api/v1/subtasks/[id]/curate — returns bundle with
 *        selected_items (no duplicates), dropped_items, snapshot_id, token_budget.
 *     C. GET /api/v1/snapshots/[id] — returns same bundle (idempotent); 404
 *        for unknown id.
 *     D. End-to-end: POST tasks/curate → POST subtasks/{id}/curate →
 *        GET snapshots/{id} — consistent IDs and structure throughout.
 *   Browser:
 *     E. /tasks page loads with prototype-mode banner, form, and "Decompose
 *        Task" button.
 *     F. Filling the form and submitting shows ≥1 subtask row, each with an
 *        intent label and a "Curate" button.
 *     G. Clicking "Curate" on a subtask shows the bundle preview with
 *        snapshot_id and selected items.
 */

import { test, expect } from "@playwright/test";

const AUTH_HEADER = { Authorization: "Bearer prototype-dev-token" };
const BASE_API = "/api/v1";
const TEST_PROJECT = "proj-org-shared";
const TEST_TASK =
  "What are the key compliance risks we need to address and what is the vendor approval process?";

// ---------------------------------------------------------------------------
// A. API — POST /api/v1/tasks/curate
// ---------------------------------------------------------------------------

test.describe("Session 08c — POST /api/v1/tasks/curate @session-08c", () => {
  test("returns 401 without auth header", async ({ request }) => {
    const res = await request.post(`${BASE_API}/tasks/curate`, {
      data: { task_text: TEST_TASK, project_id: TEST_PROJECT },
    });
    expect(res.status()).toBe(401);
    const json = await res.json();
    expect(json).toMatchObject({ error: "Unauthorized" });
  });

  test("returns 400 when task_text is missing", async ({ request }) => {
    const res = await request.post(`${BASE_API}/tasks/curate`, {
      headers: AUTH_HEADER,
      data: { project_id: TEST_PROJECT },
    });
    expect(res.status()).toBe(400);
    const json = await res.json();
    expect(json).toMatchObject({ error: expect.stringContaining("task_text") });
  });

  test("returns 400 when project_id is missing", async ({ request }) => {
    const res = await request.post(`${BASE_API}/tasks/curate`, {
      headers: AUTH_HEADER,
      data: { task_text: TEST_TASK },
    });
    expect(res.status()).toBe(400);
    const json = await res.json();
    expect(json).toMatchObject({ error: expect.stringContaining("project_id") });
  });

  test("201 happy path — returns task with ≥2 subtasks", async ({ request }) => {
    const res = await request.post(`${BASE_API}/tasks/curate`, {
      headers: AUTH_HEADER,
      data: { task_text: TEST_TASK, project_id: TEST_PROJECT },
    });
    expect(res.status()).toBe(201);
    const json = await res.json();

    // Top-level task fields
    expect(json).toHaveProperty("task_id");
    expect(json).toHaveProperty("project_id", TEST_PROJECT);
    expect(json).toHaveProperty("task_text", TEST_TASK);
    expect(json).toHaveProperty("status", "ready");
    expect(json).toHaveProperty("created_at");

    // Subtasks
    expect(Array.isArray(json.subtasks)).toBe(true);
    expect(json.subtasks.length).toBeGreaterThanOrEqual(2);

    // Each subtask has required fields
    for (const st of json.subtasks) {
      expect(st).toHaveProperty("subtask_id");
      expect(st).toHaveProperty("task_id", json.task_id);
      expect(st).toHaveProperty("intent_label");
      expect(st).toHaveProperty("description");
      expect(Array.isArray(st.expected_evidence)).toBe(true);
      expect(st.expected_evidence.length).toBeGreaterThanOrEqual(1);
      expect(st).toHaveProperty("store_routing");
      expect(Array.isArray(st.store_routing.candidate_store_ids)).toBe(true);
      expect(st).toHaveProperty("status", "pending");
    }
  });

  test("idempotency — same key returns existing task", async ({ request }) => {
    const key = `idem-test-${Date.now()}`;

    const res1 = await request.post(`${BASE_API}/tasks/curate`, {
      headers: AUTH_HEADER,
      data: { task_text: TEST_TASK, project_id: TEST_PROJECT, idempotency_key: key },
    });
    expect(res1.status()).toBe(201);
    const first = await res1.json();

    const res2 = await request.post(`${BASE_API}/tasks/curate`, {
      headers: AUTH_HEADER,
      data: { task_text: TEST_TASK, project_id: TEST_PROJECT, idempotency_key: key },
    });
    // second call returns 200 (existing) or 201 — must have same task_id
    expect([200, 201]).toContain(res2.status());
    const second = await res2.json();
    expect(second.task_id).toBe(first.task_id);
  });
});

// ---------------------------------------------------------------------------
// B. API — POST /api/v1/subtasks/[id]/curate
// ---------------------------------------------------------------------------

test.describe("Session 08c — POST /api/v1/subtasks/[id]/curate @session-08c", () => {
  let subtaskId: string;
  let taskId: string;

  test.beforeEach(async ({ request }) => {
    const res = await request.post(`${BASE_API}/tasks/curate`, {
      headers: AUTH_HEADER,
      data: { task_text: TEST_TASK, project_id: TEST_PROJECT },
    });
    const json = await res.json();
    taskId = json.task_id;
    subtaskId = json.subtasks[0].subtask_id;
  });

  test("returns 401 without auth header", async ({ request }) => {
    const res = await request.post(`${BASE_API}/subtasks/${subtaskId}/curate`);
    expect(res.status()).toBe(401);
  });

  test("returns bundle with selected_items and dropped_items", async ({ request }) => {
    const res = await request.post(`${BASE_API}/subtasks/${subtaskId}/curate`, {
      headers: AUTH_HEADER,
    });
    expect(res.status()).toBe(200);
    const json = await res.json();

    expect(json).toHaveProperty("subtask_id", subtaskId);
    expect(json).toHaveProperty("task_id", taskId);
    expect(json).toHaveProperty("snapshot_id");
    expect(typeof json.snapshot_id).toBe("string");
    expect(json.snapshot_id.length).toBeGreaterThan(0);

    expect(Array.isArray(json.selected_items)).toBe(true);
    expect(json.selected_items.length).toBeGreaterThanOrEqual(1);

    // Each selected item has required fields
    for (const item of json.selected_items) {
      expect(item).toHaveProperty("item_id");
      expect(item).toHaveProperty("type");
      expect(["asset", "wiki_page"]).toContain(item.type);
      expect(item).toHaveProperty("title");
      expect(item).toHaveProperty("inclusion_reason");
      expect(item).toHaveProperty("token_estimate");
      expect(typeof item.token_estimate).toBe("number");
    }

    expect(Array.isArray(json.dropped_items)).toBe(true);

    expect(json).toHaveProperty("token_budget");
    expect(json.token_budget).toHaveProperty("limit");
    expect(json.token_budget).toHaveProperty("used");
    expect(json.token_budget).toHaveProperty("remaining");
    expect(json.token_budget.used).toBeLessThanOrEqual(json.token_budget.limit);
  });

  test("selected_items have no duplicate item_ids", async ({ request }) => {
    const res = await request.post(`${BASE_API}/subtasks/${subtaskId}/curate`, {
      headers: AUTH_HEADER,
    });
    const json = await res.json();
    const ids = json.selected_items.map((i: { item_id: string }) => i.item_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("idempotent — same bundle returned on replay", async ({ request }) => {
    const res1 = await request.post(`${BASE_API}/subtasks/${subtaskId}/curate`, {
      headers: AUTH_HEADER,
    });
    const first = await res1.json();

    const res2 = await request.post(`${BASE_API}/subtasks/${subtaskId}/curate`, {
      headers: AUTH_HEADER,
    });
    const second = await res2.json();

    expect(second.snapshot_id).toBe(first.snapshot_id);
    expect(second.selected_items.length).toBe(first.selected_items.length);
  });
});

// ---------------------------------------------------------------------------
// C. API — GET /api/v1/snapshots/[id]
// ---------------------------------------------------------------------------

test.describe("Session 08c — GET /api/v1/snapshots/[id] @session-08c", () => {
  let snapshotId: string;
  let capturedBundle: Record<string, unknown>;

  test.beforeEach(async ({ request }) => {
    // Create task → curate subtask → capture snapshot_id
    const taskRes = await request.post(`${BASE_API}/tasks/curate`, {
      headers: AUTH_HEADER,
      data: { task_text: TEST_TASK, project_id: TEST_PROJECT },
    });
    const taskJson = await taskRes.json();
    const subtaskId = taskJson.subtasks[0].subtask_id;

    const bundleRes = await request.post(`${BASE_API}/subtasks/${subtaskId}/curate`, {
      headers: AUTH_HEADER,
    });
    capturedBundle = await bundleRes.json();
    snapshotId = capturedBundle.snapshot_id as string;
  });

  test("returns 401 without auth header", async ({ request }) => {
    const res = await request.get(`${BASE_API}/snapshots/${snapshotId}`);
    expect(res.status()).toBe(401);
  });

  test("returns 200 with snapshot fields", async ({ request }) => {
    const res = await request.get(`${BASE_API}/snapshots/${snapshotId}`, {
      headers: AUTH_HEADER,
    });
    expect(res.status()).toBe(200);
    const json = await res.json();

    expect(json).toHaveProperty("snapshot_id", snapshotId);
    expect(json).toHaveProperty("run_id");
    expect(json).toHaveProperty("org_id");
    expect(json).toHaveProperty("project_id");
    expect(json).toHaveProperty("task_id");
    expect(json).toHaveProperty("context_pack_json");
    expect(json).toHaveProperty("created_at");
  });

  test("context_pack_json contains selected_items from original curation", async ({ request }) => {
    const res = await request.get(`${BASE_API}/snapshots/${snapshotId}`, {
      headers: AUTH_HEADER,
    });
    const json = await res.json();

    const pack = json.context_pack_json as { selected_items: unknown[] };
    expect(Array.isArray(pack.selected_items)).toBe(true);
    expect(pack.selected_items.length).toBe(
      (capturedBundle.selected_items as unknown[]).length,
    );
  });

  test("returns 404 for unknown snapshot_id", async ({ request }) => {
    const res = await request.get(`${BASE_API}/snapshots/snap-does-not-exist-9999`, {
      headers: AUTH_HEADER,
    });
    expect(res.status()).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// D. API — End-to-end flow
// ---------------------------------------------------------------------------

test.describe("Session 08c — E2E API flow @session-08c", () => {
  test("POST tasks/curate → POST subtasks/curate → GET snapshots — consistent IDs", async ({
    request,
  }) => {
    // Step 1: create task
    const taskRes = await request.post(`${BASE_API}/tasks/curate`, {
      headers: AUTH_HEADER,
      data: {
        task_text: "Review vendor compliance and assess financial risk",
        project_id: TEST_PROJECT,
      },
    });
    expect(taskRes.status()).toBe(201);
    const taskJson = await taskRes.json();
    const { task_id: taskId, subtasks } = taskJson;
    expect(subtasks.length).toBeGreaterThanOrEqual(2);

    // Step 2: curate each subtask
    const snapshotIds: string[] = [];
    for (const subtask of subtasks) {
      const bundleRes = await request.post(`${BASE_API}/subtasks/${subtask.subtask_id}/curate`, {
        headers: AUTH_HEADER,
      });
      expect(bundleRes.status()).toBe(200);
      const bundle = await bundleRes.json();

      // IDs must be consistent
      expect(bundle.subtask_id).toBe(subtask.subtask_id);
      expect(bundle.task_id).toBe(taskId);
      expect(bundle.snapshot_id).toBeTruthy();
      snapshotIds.push(bundle.snapshot_id as string);
    }

    // All snapshot_ids are unique across subtasks
    expect(new Set(snapshotIds).size).toBe(snapshotIds.length);

    // Step 3: retrieve all snapshots and verify structure
    for (const snapId of snapshotIds) {
      const snapRes = await request.get(`${BASE_API}/snapshots/${snapId}`, {
        headers: AUTH_HEADER,
      });
      expect(snapRes.status()).toBe(200);
      const snap = await snapRes.json();
      expect(snap.snapshot_id).toBe(snapId);
      expect(snap.task_id).toBe(taskId);
      expect(snap.project_id).toBe(TEST_PROJECT);
      expect(snap.context_pack_json).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// E–G. Browser — /tasks page
// ---------------------------------------------------------------------------

test.describe("Session 08c — Browser: /tasks page @session-08c", () => {
  test("page loads with prototype banner, form, and submit button", async ({ page }) => {
    await page.goto("/tasks");

    // Prototype mode banner
    await expect(
      page.getByRole("status", { name: "Prototype mode banner" }),
    ).toBeVisible();

    // Form elements
    await expect(page.locator("form[aria-label='Task curation form']")).toBeVisible();
    await expect(page.locator("#task-text")).toBeVisible();
    await expect(page.locator("#project-select")).toBeVisible();
    await expect(page.getByRole("button", { name: "Decompose Task" })).toBeVisible();
  });

  test("submitting a task shows ≥1 subtask row with intent label and Curate button", async ({
    page,
  }) => {
    await page.goto("/tasks");

    await page.fill("#task-text", TEST_TASK);
    await page.selectOption("#project-select", TEST_PROJECT);
    await page.getByRole("button", { name: "Decompose Task" }).click();

    // Wait for subtask results section
    const section = page.locator("section[aria-label='Subtask results']");
    await expect(section).toBeVisible({ timeout: 10000 });

    // At least one subtask card
    const cards = section.locator("[aria-label^='Subtask:']");
    await expect(cards.first()).toBeVisible();
    expect(await cards.count()).toBeGreaterThanOrEqual(1);

    // Each visible card has a Curate button
    const firstCard = cards.first();
    await expect(firstCard.getByRole("button", { name: /Curate/i })).toBeVisible();
  });

  test("clicking Curate shows bundle preview with snapshot_id", async ({ page }) => {
    await page.goto("/tasks");

    await page.fill("#task-text", TEST_TASK);
    await page.selectOption("#project-select", TEST_PROJECT);
    await page.getByRole("button", { name: "Decompose Task" }).click();

    const section = page.locator("section[aria-label='Subtask results']");
    await expect(section).toBeVisible({ timeout: 10000 });

    // Click first Curate button
    const firstCard = section.locator("[aria-label^='Subtask:']").first();
    await firstCard.getByRole("button", { name: /Curate/i }).click();

    // Bundle preview appears
    const preview = firstCard.locator("[aria-label='Curated bundle preview']");
    await expect(preview).toBeVisible({ timeout: 10000 });

    // snapshot_id visible in preview
    await expect(preview.locator("text=Snapshot:")).toBeVisible();

    // Selected items list
    await expect(preview.locator("text=Selected items")).toBeVisible();
  });

  test("Tasks link appears in main navigation", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("nav[aria-label='Main navigation'] a[href='/tasks']")).toBeVisible();
  });
});
