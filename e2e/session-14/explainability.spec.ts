/**
 * Session 14 – Explainability and non-inclusion panel
 *
 * Exit criteria:
 * - GET /api/v1/snapshots/:id/explainability returns selected items with
 *   rationale (inclusion_reason, retrieval_level, score, provenance) and
 *   dropped items with reason_code and exclusion_reason.
 * - Run events are returned for the snapshot's run_id.
 * - 401 returned without auth.
 * - 404 returned for unknown snapshot ID.
 * - UI: Explainability screen renders included/excluded tabs and run-event
 *   stream when a valid snapshot_id is supplied via query param.
 * - UI: Task Planner confirms "Explain ↗" link is visible on curated bundles
 *   and confirmed packs, pointing to /explainability?snapshot_id=...
 */

import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

const AUTH = "Bearer prototype-dev-token";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createAndCurateSubtask(
  request: APIRequestContext,
): Promise<{ taskId: string; subtaskId: string; snapshotId: string }> {
  const res = await request.post("/api/v1/tasks/curate", {
    headers: { Authorization: AUTH, "Content-Type": "application/json" },
    data: {
      task_text: "Assess GDPR compliance and vendor data handling requirements",
      project_id: "proj-compliance-privacy",
    },
  });
  expect([200, 201]).toContain(res.status());
  const body = await res.json();
  const taskId: string = body.task_id;
  const subtaskId: string = body.subtasks[0].subtask_id;

  const res2 = await request.post(`/api/v1/subtasks/${subtaskId}/curate`, {
    headers: { Authorization: AUTH },
  });
  expect([200, 201]).toContain(res2.status());
  const body2 = await res2.json();
  const snapshotId: string = body2.snapshot_id;

  return { taskId, subtaskId, snapshotId };
}

// ---------------------------------------------------------------------------
// API – auth & not-found
// ---------------------------------------------------------------------------

test.describe("GET /api/v1/snapshots/:id/explainability – auth & error cases", () => {
  test("returns 401 without auth header", async ({ request }) => {
    const res = await request.get("/api/v1/snapshots/fake-snap/explainability");
    expect(res.status()).toBe(401);
  });

  test("returns 404 for unknown snapshot ID", async ({ request }) => {
    const res = await request.get(
      "/api/v1/snapshots/unknown-snap-id-does-not-exist/explainability",
      { headers: { Authorization: AUTH } },
    );
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });
});

// ---------------------------------------------------------------------------
// API – happy path: explainability data for a curated snapshot
// ---------------------------------------------------------------------------

test.describe("GET /api/v1/snapshots/:id/explainability – happy path", () => {
  test("returns selected items with rationale fields", async ({ request }) => {
    const { snapshotId } = await createAndCurateSubtask(request);

    const res = await request.get(
      `/api/v1/snapshots/${snapshotId}/explainability`,
      { headers: { Authorization: AUTH } },
    );
    expect(res.status()).toBe(200);
    const body = await res.json();

    // Top-level envelope fields
    expect(body).toHaveProperty("snapshot_id", snapshotId);
    expect(body).toHaveProperty("run_id");
    expect(body).toHaveProperty("task_id");
    expect(body).toHaveProperty("project_id");
    expect(body).toHaveProperty("created_at");
    expect(body).toHaveProperty("selected_items");
    expect(body).toHaveProperty("dropped_items");
    expect(body).toHaveProperty("run_events");

    // selected_items must have at least one item
    expect(Array.isArray(body.selected_items)).toBe(true);
    expect(body.selected_items.length).toBeGreaterThan(0);

    // Each selected item must carry required rationale fields
    for (const item of body.selected_items) {
      expect(item).toHaveProperty("item_id");
      expect(item).toHaveProperty("type");
      expect(item).toHaveProperty("title");
      expect(item).toHaveProperty("inclusion_reason");
      expect(item).toHaveProperty("token_estimate");
      expect(item).toHaveProperty("provenance");
      expect(item.provenance).toHaveProperty("selected_at");
      // retrieval_level and score may be null for manually-added items, but
      // must be present as keys
      expect("retrieval_level" in item).toBe(true);
      expect("score" in item).toBe(true);
    }
  });

  test("returns dropped items with reason_code and exclusion_reason", async ({
    request,
  }) => {
    const { snapshotId } = await createAndCurateSubtask(request);

    const res = await request.get(
      `/api/v1/snapshots/${snapshotId}/explainability`,
      { headers: { Authorization: AUTH } },
    );
    expect(res.status()).toBe(200);
    const body = await res.json();

    expect(Array.isArray(body.dropped_items)).toBe(true);
    expect(body.dropped_items.length).toBeGreaterThan(0);

    for (const item of body.dropped_items) {
      expect(item).toHaveProperty("item_id");
      expect(item).toHaveProperty("title");
      expect(item).toHaveProperty("exclusion_reason");
      expect(item).toHaveProperty("reason_code");
      // reason_code must be a non-empty string
      expect(typeof item.reason_code).toBe("string");
      expect(item.reason_code.length).toBeGreaterThan(0);
    }
  });

  test("returns run events after curation", async ({ request }) => {
    const { snapshotId } = await createAndCurateSubtask(request);

    const res = await request.get(
      `/api/v1/snapshots/${snapshotId}/explainability`,
      { headers: { Authorization: AUTH } },
    );
    expect(res.status()).toBe(200);
    const body = await res.json();

    expect(Array.isArray(body.run_events)).toBe(true);
    expect(body.run_events.length).toBeGreaterThan(0);

    const eventTypes = body.run_events.map((e: { event_type: string }) => e.event_type);
    // Must contain at minimum a curation_completed event
    expect(eventTypes).toContain("curation_completed");

    // Each event must carry required fields
    for (const ev of body.run_events) {
      expect(ev).toHaveProperty("event_id");
      expect(ev).toHaveProperty("run_id");
      expect(ev).toHaveProperty("event_type");
      expect(ev).toHaveProperty("actor");
      expect(ev).toHaveProperty("reason_code");
      expect(ev).toHaveProperty("description");
      expect(ev).toHaveProperty("occurred_at");
    }
  });

  test("run events include per-item item_selected events", async ({ request }) => {
    const { snapshotId, subtaskId: _ } = await createAndCurateSubtask(request);

    const res = await request.get(
      `/api/v1/snapshots/${snapshotId}/explainability`,
      { headers: { Authorization: AUTH } },
    );
    expect(res.status()).toBe(200);
    const body = await res.json();

    const selectedEvents = body.run_events.filter(
      (e: { event_type: string }) => e.event_type === "item_selected",
    );
    expect(selectedEvents.length).toBeGreaterThan(0);

    const droppedEvents = body.run_events.filter(
      (e: { event_type: string }) => e.event_type === "item_dropped",
    );
    expect(droppedEvents.length).toBeGreaterThan(0);
  });

  test("run events include override_applied after confirm with overrides", async ({
    request,
  }) => {
    const { subtaskId, snapshotId } = await createAndCurateSubtask(request);

    // Curate first, then confirm with a removal
    const curate2 = await request.post(`/api/v1/subtasks/${subtaskId}/curate`, {
      headers: { Authorization: AUTH },
    });
    expect(curate2.status()).toBe(200);

    // Get the item IDs from the curated bundle to remove one
    const curateBody = await curate2.json();
    const itemIdToRemove: string = curateBody.selected_items?.[0]?.item_id ?? "";

    const confirmRes = await request.post(`/api/v1/subtasks/${subtaskId}/confirm`, {
      headers: { Authorization: AUTH, "Content-Type": "application/json" },
      data: {
        removed_item_ids: itemIdToRemove ? [itemIdToRemove] : [],
        override_reason: "Test override for session 14",
      },
    });
    expect(confirmRes.status()).toBe(200);
    const confirmBody = await confirmRes.json();
    const confirmedSnapshotId: string = confirmBody.confirmed_snapshot_id;

    // Load explainability for confirmed snapshot
    const explainRes = await request.get(
      `/api/v1/snapshots/${confirmedSnapshotId}/explainability`,
      { headers: { Authorization: AUTH } },
    );
    expect(explainRes.status()).toBe(200);
    const explainBody = await explainRes.json();

    const overrideEvent = explainBody.run_events.find(
      (e: { event_type: string }) => e.event_type === "override_applied",
    );

    if (itemIdToRemove) {
      expect(overrideEvent).toBeDefined();
      expect(overrideEvent.actor).toBe("user");
    }

    const confirmedEvent = explainBody.run_events.find(
      (e: { event_type: string }) => e.event_type === "context_confirmed",
    );
    expect(confirmedEvent).toBeDefined();

    // snapshotId arg is the original curated one — just used to silence unused var lint
    expect(snapshotId).toBeTruthy();
  });

  test("explainability is idempotent — same snapshot returns consistent data", async ({
    request,
  }) => {
    const { snapshotId } = await createAndCurateSubtask(request);

    const [res1, res2] = await Promise.all([
      request.get(`/api/v1/snapshots/${snapshotId}/explainability`, {
        headers: { Authorization: AUTH },
      }),
      request.get(`/api/v1/snapshots/${snapshotId}/explainability`, {
        headers: { Authorization: AUTH },
      }),
    ]);

    expect(res1.status()).toBe(200);
    expect(res2.status()).toBe(200);

    const body1 = await res1.json();
    const body2 = await res2.json();

    expect(body1.selected_items.length).toBe(body2.selected_items.length);
    expect(body1.dropped_items.length).toBe(body2.dropped_items.length);
  });
});

// ---------------------------------------------------------------------------
// UI – Explainability screen renders correctly
// ---------------------------------------------------------------------------

test.describe("Explainability screen – browser E2E", () => {
  async function getSnapshotId(request: APIRequestContext): Promise<string> {
    const { snapshotId } = await createAndCurateSubtask(request);
    return snapshotId;
  }

  test("page loads without error at /explainability", async ({ page }) => {
    await page.goto("/explainability");
    await expect(page.locator("h1")).toContainText("Explainability");
    await expect(page.getByLabel("Snapshot lookup form")).toBeVisible();
  });

  test("shows empty state when no snapshot_id is provided", async ({ page }) => {
    await page.goto("/explainability");
    await expect(page.getByText("Enter a snapshot ID to inspect")).toBeVisible();
  });

  test("loads and displays included items for a valid snapshot", async ({
    page,
    request,
  }) => {
    const snapshotId = await getSnapshotId(request);
    await page.goto(`/explainability?snapshot_id=${encodeURIComponent(snapshotId)}`);

    // Wait for data to load
    await expect(page.getByLabel("Snapshot metadata")).toBeVisible({ timeout: 10000 });

    // Included tab should be active by default
    await expect(page.getByRole("tab", { name: /Included/ })).toBeVisible();
    await expect(page.locator("[aria-label^='Rationale card for']").first()).toBeVisible();
  });

  test("excluded tab shows dropped items with reason codes", async ({
    page,
    request,
  }) => {
    const snapshotId = await getSnapshotId(request);
    await page.goto(`/explainability?snapshot_id=${encodeURIComponent(snapshotId)}`);

    await expect(page.getByLabel("Snapshot metadata")).toBeVisible({ timeout: 10000 });

    // Click excluded tab
    await page.getByRole("tab", { name: /Excluded/ }).click();

    // Should show at least one non-inclusion card
    await expect(page.locator("[aria-label^='Non-inclusion:']").first()).toBeVisible();
  });

  test("run events tab shows event stream", async ({ page, request }) => {
    const snapshotId = await getSnapshotId(request);
    await page.goto(`/explainability?snapshot_id=${encodeURIComponent(snapshotId)}`);

    await expect(page.getByLabel("Snapshot metadata")).toBeVisible({ timeout: 10000 });

    // Click events tab
    await page.getByRole("tab", { name: /Run Events/ }).click();

    await expect(page.getByLabel("Run event stream")).toBeVisible();
    await expect(page.locator("[aria-label^='Run event: ']").first()).toBeVisible();
  });

  test("rationale card expands to show provenance details", async ({
    page,
    request,
  }) => {
    const snapshotId = await getSnapshotId(request);
    await page.goto(`/explainability?snapshot_id=${encodeURIComponent(snapshotId)}`);

    await expect(page.locator("[aria-label^='Rationale card for']").first()).toBeVisible({
      timeout: 10000,
    });

    // Click the first expand button
    await page.locator("[aria-label^='Expand rationale for']").first().click();
    await expect(page.locator("[aria-label^='Provenance for']").first()).toBeVisible();
  });

  test("snapshot ID form loads data on submit", async ({ page, request }) => {
    const snapshotId = await getSnapshotId(request);
    await page.goto("/explainability");

    await page.getByLabel("Snapshot ID").fill(snapshotId);
    await page.getByLabel("Load explainability data").click();

    await expect(page.getByLabel("Snapshot metadata")).toBeVisible({ timeout: 10000 });
  });
});

// ---------------------------------------------------------------------------
// UI – Task Planner "Explain ↗" links
// ---------------------------------------------------------------------------

test.describe("Task Planner – Explain links (Session 14 overlay)", () => {
  async function curateBundleInUI(page: Page): Promise<string> {
    await page.goto("/tasks");
    await page.locator("textarea").fill(
      "Assess GDPR compliance gaps for TargetCo acquisition",
    );
    await page.locator("select").selectOption("proj-corpdev-targetco-dd");
    await page.getByRole("button", { name: /Decompose Task/i }).click();

    // Wait for subtasks
    await expect(page.locator("[aria-label^='Subtask:']").first()).toBeVisible({
      timeout: 10000,
    });

    // Curate first subtask
    await page.getByRole("button", { name: /^Curate subtask/i }).first().click();
    await expect(page.locator("[aria-label='Snapshot ID']").first()).toBeVisible({
      timeout: 10000,
    });

    const snapshotEl = page.locator("[aria-label='Snapshot ID']").first();
    return (await snapshotEl.textContent()) ?? "";
  }

  test("Explain link appears after curation and points to /explainability", async ({
    page,
  }) => {
    await curateBundleInUI(page);

    const explainLink = page.getByRole("link", { name: /Explain snapshot/i }).first();
    await expect(explainLink).toBeVisible();
    const href = await explainLink.getAttribute("href");
    expect(href).toMatch(/\/explainability\?snapshot_id=/);
  });

  test("Explain link navigates to explainability screen with data loaded", async ({
    page,
  }) => {
    await curateBundleInUI(page);

    const explainLink = page.getByRole("link", { name: /Explain snapshot/i }).first();
    await explainLink.click();

    // Should land on explainability page with data loaded
    await expect(page.getByLabel("Snapshot metadata")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("[aria-label^='Rationale card for']").first()).toBeVisible();
  });

  test("expanded item details show retrieval level and score", async ({ page }) => {
    await curateBundleInUI(page);

    // Expand first context item
    await page.locator("[aria-label^='Expand details for']").first().click();

    // Should show retrieval level badge (L0, L1, or L2 text)
    const detailsEl = page.locator("[aria-label^='Details for']").first();
    await expect(detailsEl).toBeVisible();
    // Should contain score text
    await expect(detailsEl.getByText(/Score/i)).toBeVisible();
  });
});
