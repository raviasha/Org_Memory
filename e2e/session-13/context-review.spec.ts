/**
 * Session 13 – Context review and override UX
 *
 * Exit criteria:
 * - User can inspect curated context items
 * - User can remove items; removals persist in confirmed payload
 * - User can add custom items; additions appear in confirmed payload
 * - Confirmed snapshot ID differs from original curated snapshot ID
 */

import { test, expect, type APIRequestContext } from "@playwright/test";

const AUTH = "Bearer prototype-dev-token";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createTaskAndSubtask(
  request: APIRequestContext
): Promise<{ taskId: string; subtaskId: string }> {
  const res = await request.post("/api/v1/tasks/curate", {
    headers: { Authorization: AUTH, "Content-Type": "application/json" },
    data: {
      task_text: "Assess GDPR compliance gaps for TargetCo acquisition",
      project_id: "proj-corpdev-targetco-dd",
    },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  const taskId: string = body.task_id;
  const subtaskId: string = body.subtasks[0].subtask_id;
  return { taskId, subtaskId };
}

async function curateSubtask(
  request: APIRequestContext,
  subtaskId: string
): Promise<{ snapshotId: string; items: { item_id: string }[] }> {
  const res = await request.post(`/api/v1/subtasks/${subtaskId}/curate`, {
    headers: { Authorization: AUTH },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  return { snapshotId: body.snapshot_id, items: body.selected_items };
}

// ---------------------------------------------------------------------------
// API – auth & input validation
// ---------------------------------------------------------------------------

test.describe("POST /api/v1/subtasks/:id/confirm – auth & validation", () => {
  test("returns 401 without auth header", async ({ request }) => {
    const res = await request.post("/api/v1/subtasks/fake-id/confirm", {
      data: {},
    });
    expect(res.status()).toBe(401);
  });

  test("returns 404 when subtask does not exist", async ({ request }) => {
    const res = await request.post("/api/v1/subtasks/non-existent-id/confirm", {
      headers: { Authorization: AUTH },
      data: {},
    });
    expect(res.status()).toBe(404);
  });

  test("returns 404 when subtask exists but has not been curated", async ({
    request,
  }) => {
    // Create a task to get a real subtask id, but don't curate it
    const res1 = await request.post("/api/v1/tasks/curate", {
      headers: { Authorization: AUTH, "Content-Type": "application/json" },
      data: {
        task_text: "Uncurated subtask test",
        project_id: "proj-org-shared",
      },
    });
    expect(res1.status()).toBe(200);
    const { subtasks } = await res1.json();
    const subtaskId: string = subtasks[0].subtask_id;

    const res2 = await request.post(`/api/v1/subtasks/${subtaskId}/confirm`, {
      headers: { Authorization: AUTH },
      data: {},
    });
    expect(res2.status()).toBe(404);
    const body = await res2.json();
    expect(body.error).toMatch(/not.*curated|curate.*first/i);
  });
});

// ---------------------------------------------------------------------------
// API – happy path: no overrides
// ---------------------------------------------------------------------------

test.describe("POST /api/v1/subtasks/:id/confirm – no overrides", () => {
  test("returns confirmed snapshot distinct from curated snapshot", async ({
    request,
  }) => {
    const { subtaskId } = await createTaskAndSubtask(request);
    const { snapshotId: originalSnapshotId } = await curateSubtask(request, subtaskId);

    const res = await request.post(`/api/v1/subtasks/${subtaskId}/confirm`, {
      headers: { Authorization: AUTH },
      data: {},
    });
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.subtask_id).toBe(subtaskId);
    expect(body.original_snapshot_id).toBe(originalSnapshotId);
    expect(body.confirmed_snapshot_id).toBeTruthy();
    expect(body.confirmed_snapshot_id).not.toBe(originalSnapshotId);
    expect(body.final_selected_items).toBeInstanceOf(Array);
    expect(body.confirmed_at).toBeTruthy();
  });

  test("all original items appear in final_selected_items when nothing is removed", async ({
    request,
  }) => {
    const { subtaskId } = await createTaskAndSubtask(request);
    const { items } = await curateSubtask(request, subtaskId);

    const res = await request.post(`/api/v1/subtasks/${subtaskId}/confirm`, {
      headers: { Authorization: AUTH },
      data: { removed_item_ids: [] },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();

    const finalIds = body.final_selected_items.map(
      (i: { item_id: string }) => i.item_id
    );
    for (const item of items) {
      expect(finalIds).toContain(item.item_id);
    }
  });
});

// ---------------------------------------------------------------------------
// API – removals
// ---------------------------------------------------------------------------

test.describe("POST /api/v1/subtasks/:id/confirm – removals", () => {
  test("removed items are absent from final_selected_items and listed in removed_items", async ({
    request,
  }) => {
    const { subtaskId } = await createTaskAndSubtask(request);
    const { items } = await curateSubtask(request, subtaskId);

    if (items.length === 0) {
      test.skip();
      return;
    }

    const toRemove = items[0].item_id;

    const res = await request.post(`/api/v1/subtasks/${subtaskId}/confirm`, {
      headers: { Authorization: AUTH },
      data: { removed_item_ids: [toRemove] },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();

    const finalIds = body.final_selected_items.map(
      (i: { item_id: string }) => i.item_id
    );
    expect(finalIds).not.toContain(toRemove);

    const removedIds = body.removed_items.map((i: { item_id: string }) => i.item_id);
    expect(removedIds).toContain(toRemove);
  });
});

// ---------------------------------------------------------------------------
// API – additions
// ---------------------------------------------------------------------------

test.describe("POST /api/v1/subtasks/:id/confirm – additions", () => {
  test("added items appear in final_selected_items", async ({ request }) => {
    const { subtaskId } = await createTaskAndSubtask(request);
    await curateSubtask(request, subtaskId);

    const res = await request.post(`/api/v1/subtasks/${subtaskId}/confirm`, {
      headers: { Authorization: AUTH },
      data: {
        added_items: [
          {
            title: "Manual GDPR checklist",
            content: "Article 30 record of processing activities requirement.",
            item_type: "manual",
          },
        ],
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();

    const addedTitles = body.added_items.map((i: { title: string }) => i.title);
    expect(addedTitles).toContain("Manual GDPR checklist");

    const finalTitles = body.final_selected_items.map(
      (i: { title: string }) => i.title
    );
    expect(finalTitles).toContain("Manual GDPR checklist");
  });
});

// ---------------------------------------------------------------------------
// API – combined remove + add
// ---------------------------------------------------------------------------

test.describe("POST /api/v1/subtasks/:id/confirm – combined override", () => {
  test("remove one item and add one custom item", async ({ request }) => {
    const { subtaskId } = await createTaskAndSubtask(request);
    const { items } = await curateSubtask(request, subtaskId);

    const toRemove = items.length > 0 ? items[0].item_id : null;

    const res = await request.post(`/api/v1/subtasks/${subtaskId}/confirm`, {
      headers: { Authorization: AUTH },
      data: {
        removed_item_ids: toRemove ? [toRemove] : [],
        added_items: [{ title: "Custom note", content: "Extra context.", item_type: "manual" }],
        override_reason: "Replacing first item with more relevant custom note.",
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();

    if (toRemove) {
      const finalIds = body.final_selected_items.map(
        (i: { item_id: string }) => i.item_id
      );
      expect(finalIds).not.toContain(toRemove);
    }

    const finalTitles = body.final_selected_items.map(
      (i: { title: string }) => i.title
    );
    expect(finalTitles).toContain("Custom note");
    expect(body.override_summary).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Browser E2E
// ---------------------------------------------------------------------------

test.describe("Context review panel – browser", () => {
  test("context review panel appears after curating a subtask", async ({ page }) => {
    await page.goto("/tasks");
    await page.waitForSelector("textarea");

    await page.fill("textarea", "Assess GDPR compliance for TargetCo DD");
    await page.click('button[type="submit"]');

    // Wait for subtask cards to appear
    await page.waitForSelector('[data-testid="subtask-card"], [aria-label="Subtask results"]', {
      timeout: 15000,
    });

    // Click the first "Curate Context" button
    const curateBtn = page.locator('button', { hasText: /curate context/i }).first();
    await curateBtn.waitFor({ timeout: 10000 });
    await curateBtn.click();

    // Context review panel should appear
    await expect(
      page.locator("text=/context review|token budget|selected items/i").first()
    ).toBeVisible({ timeout: 15000 });
  });

  test("token budget bar is visible in context review panel", async ({ page }) => {
    await page.goto("/tasks");
    await page.waitForSelector("textarea");

    await page.fill("textarea", "Assess financial risks in TargetCo acquisition");
    await page.click('button[type="submit"]');

    await page.waitForSelector('[aria-label="Subtask results"]', { timeout: 15000 });

    const curateBtn = page.locator('button', { hasText: /curate context/i }).first();
    await curateBtn.waitFor({ timeout: 10000 });
    await curateBtn.click();

    // Token budget bar (progress element or labelled region)
    await expect(
      page.locator('[role="progressbar"], [aria-label*="token"], text=/token/i').first()
    ).toBeVisible({ timeout: 15000 });
  });

  test("can remove an item and it shows restore state", async ({ page }) => {
    await page.goto("/tasks");
    await page.waitForSelector("textarea");

    await page.fill("textarea", "Review compliance documents for TargetCo DD");
    await page.click('button[type="submit"]');

    await page.waitForSelector('[aria-label="Subtask results"]', { timeout: 15000 });

    const curateBtn = page.locator('button', { hasText: /curate context/i }).first();
    await curateBtn.waitFor({ timeout: 10000 });
    await curateBtn.click();

    // Wait for Remove buttons
    const removeBtn = page.locator('button', { hasText: /^remove$/i }).first();
    await removeBtn.waitFor({ timeout: 15000 });
    await removeBtn.click();

    // Should now show a "Restore" button
    await expect(page.locator('button', { hasText: /^restore$/i }).first()).toBeVisible({
      timeout: 5000,
    });
  });

  test("can add a custom item via the add form", async ({ page }) => {
    await page.goto("/tasks");
    await page.waitForSelector("textarea");

    await page.fill("textarea", "Assess vendor compliance controls for TargetCo");
    await page.click('button[type="submit"]');

    await page.waitForSelector('[aria-label="Subtask results"]', { timeout: 15000 });

    const curateBtn = page.locator('button', { hasText: /curate context/i }).first();
    await curateBtn.waitFor({ timeout: 10000 });
    await curateBtn.click();

    // Fill in the add custom item form
    const titleInput = page
      .locator('input[placeholder*="title" i], input[aria-label*="title" i]')
      .first();
    await titleInput.waitFor({ timeout: 15000 });
    await titleInput.fill("My custom context note");

    const contentInput = page
      .locator('textarea[placeholder*="content" i], textarea[aria-label*="content" i]')
      .last();
    await contentInput.fill("This is additional context for the review.");

    const addBtn = page.locator('button', { hasText: /add item/i }).first();
    await addBtn.click();

    // The custom item title should appear in the pending additions section
    await expect(page.locator("text=My custom context note")).toBeVisible({ timeout: 5000 });
  });

  test("confirming context produces a confirmed snapshot ID", async ({ page }) => {
    await page.goto("/tasks");
    await page.waitForSelector("textarea");

    await page.fill("textarea", "Review GDPR Article 30 compliance for TargetCo");
    await page.click('button[type="submit"]');

    await page.waitForSelector('[aria-label="Subtask results"]', { timeout: 15000 });

    const curateBtn = page.locator('button', { hasText: /curate context/i }).first();
    await curateBtn.waitFor({ timeout: 10000 });
    await curateBtn.click();

    // Wait for context review to load
    const confirmBtn = page.locator('button', { hasText: /confirm context/i }).first();
    await confirmBtn.waitFor({ timeout: 15000 });
    await confirmBtn.click();

    // Confirmed state should appear (snapshot ID or "confirmed" label)
    await expect(
      page
        .locator("text=/confirmed snapshot|context confirmed|snapshot_id/i")
        .first()
    ).toBeVisible({ timeout: 10000 });
  });
});
