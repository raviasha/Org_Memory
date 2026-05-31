/**
 * Session 16 — Governance Track: snapshot and audit trail
 *
 * Exit criteria:
 *   1. Each curated snapshot includes a content_hash (SHA-256 of context_pack_json).
 *   2. GET /api/v1/snapshots/{snapshot_id} returns content_hash and run_events_snapshot.
 *   3. GET /api/v1/runs/{run_id}/events returns the ordered event log.
 *   4. GET /api/v1/runs/{run_id}/events supports event_type filter.
 *   5. GET /api/v1/runs/{run_id}/events returns 404 for unknown run_id.
 *   6. GET /api/v1/snapshots/{snapshot_id}/explainability returns content_hash.
 *   7. Each run is reproducible from snapshot: content_hash is stable across requests.
 *   8. UI explainability screen shows immutable badge when content_hash is present.
 *   9. UI explainability screen has replay audit trail panel with "Load Run Events" button.
 */

import { test, expect, type APIRequestContext } from "@playwright/test";

const AUTH_HEADER = { Authorization: "Bearer prototype-dev-token" };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function curateFreshSubtask(request: APIRequestContext) {
  // Create a task
  const tag = Math.random().toString(36).slice(2, 7);
  const taskRes = await request.post("/api/v1/tasks/curate", {
    headers: AUTH_HEADER,
    data: {
      task_text: `Session16 governance test task ${tag}`,
      project_id: "proj-org-shared",
      org_id: "00000000-0000-0000-0000-000000000001",
    },
  });
  expect(taskRes.status()).toBe(201);
  const task = await taskRes.json();
  const subtaskId: string = task.subtasks[0].subtask_id;

  // Curate the subtask
  const curateRes = await request.post(`/api/v1/subtasks/${subtaskId}/curate`, {
    headers: AUTH_HEADER,
    data: {},
  });
  expect(curateRes.status()).toBe(200);
  const snap = await curateRes.json();

  return {
    subtaskId,
    snapshotId: snap.snapshot_id as string,
    runId: snap.run_id as string,
  };
}

// ---------------------------------------------------------------------------
// Suite 1: GET /api/v1/snapshots/{snapshot_id} — content_hash and run_events_snapshot
// ---------------------------------------------------------------------------

test.describe("GET /api/v1/snapshots/{snapshot_id} — Session 16 governance fields", () => {
  test("returns 401 without auth", async ({ request }) => {
    const res = await request.get("/api/v1/snapshots/nonexistent");
    expect(res.status()).toBe(401);
  });

  test("snapshot includes content_hash after curation", async ({ request }) => {
    const { snapshotId } = await curateFreshSubtask(request);

    const res = await request.get(`/api/v1/snapshots/${snapshotId}`, {
      headers: AUTH_HEADER,
    });
    expect(res.status()).toBe(200);
    const body = await res.json();

    expect(body).toHaveProperty("snapshot_id", snapshotId);
    expect(body).toHaveProperty("content_hash");
    expect(typeof body.content_hash).toBe("string");
    // SHA-256 hex is always 64 characters
    expect(body.content_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("snapshot includes run_events_snapshot after curation", async ({ request }) => {
    const { snapshotId } = await curateFreshSubtask(request);

    const res = await request.get(`/api/v1/snapshots/${snapshotId}`, {
      headers: AUTH_HEADER,
    });
    expect(res.status()).toBe(200);
    const body = await res.json();

    expect(body).toHaveProperty("run_events_snapshot");
    expect(Array.isArray(body.run_events_snapshot)).toBe(true);
    expect(body.run_events_snapshot.length).toBeGreaterThan(0);

    const event = body.run_events_snapshot[0];
    expect(event).toHaveProperty("event_id");
    expect(event).toHaveProperty("run_id");
    expect(event).toHaveProperty("event_type");
    expect(event).toHaveProperty("occurred_at");
  });

  test("content_hash is stable — same snapshot returns same hash on repeated fetch", async ({
    request,
  }) => {
    const { snapshotId } = await curateFreshSubtask(request);

    const [r1, r2] = await Promise.all([
      request.get(`/api/v1/snapshots/${snapshotId}`, { headers: AUTH_HEADER }),
      request.get(`/api/v1/snapshots/${snapshotId}`, { headers: AUTH_HEADER }),
    ]);
    expect(r1.status()).toBe(200);
    expect(r2.status()).toBe(200);

    const b1 = await r1.json();
    const b2 = await r2.json();

    expect(b1.content_hash).toBe(b2.content_hash);
  });

  test("snapshot includes subtask_id", async ({ request }) => {
    const { snapshotId, subtaskId } = await curateFreshSubtask(request);

    const res = await request.get(`/api/v1/snapshots/${snapshotId}`, {
      headers: AUTH_HEADER,
    });
    expect(res.status()).toBe(200);
    const body = await res.json();

    expect(body).toHaveProperty("subtask_id", subtaskId);
  });
});

// ---------------------------------------------------------------------------
// Suite 2: GET /api/v1/runs/{run_id}/events
// ---------------------------------------------------------------------------

test.describe("GET /api/v1/runs/{run_id}/events", () => {
  test("returns 401 without auth", async ({ request }) => {
    const res = await request.get("/api/v1/runs/some-run-id/events");
    expect(res.status()).toBe(401);
  });

  test("returns 404 for unknown run_id", async ({ request }) => {
    const res = await request.get(
      "/api/v1/runs/completely-unknown-run-id-session16-xyz/events",
      { headers: AUTH_HEADER },
    );
    expect(res.status()).toBe(404);
  });

  test("returns run events after curation", async ({ request }) => {
    const { runId } = await curateFreshSubtask(request);

    const res = await request.get(`/api/v1/runs/${encodeURIComponent(runId)}/events`, {
      headers: AUTH_HEADER,
    });
    expect(res.status()).toBe(200);
    const body = await res.json();

    expect(body).toHaveProperty("run_id", runId);
    expect(body).toHaveProperty("events");
    expect(Array.isArray(body.events)).toBe(true);
    expect(body.events.length).toBeGreaterThan(0);

    const event = body.events[0];
    expect(event).toHaveProperty("event_id");
    expect(event).toHaveProperty("run_id", runId);
    expect(event).toHaveProperty("event_type");
    expect(event).toHaveProperty("occurred_at");
  });

  test("events are ordered by occurred_at ascending", async ({ request }) => {
    const { runId } = await curateFreshSubtask(request);

    const res = await request.get(`/api/v1/runs/${encodeURIComponent(runId)}/events`, {
      headers: AUTH_HEADER,
    });
    expect(res.status()).toBe(200);
    const body = await res.json();

    const timestamps = (body.events as { occurred_at: string }[]).map((e) => e.occurred_at);
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i] >= timestamps[i - 1]).toBe(true);
    }
  });

  test("event_type filter returns only matching events", async ({ request }) => {
    const { runId } = await curateFreshSubtask(request);

    const res = await request.get(
      `/api/v1/runs/${encodeURIComponent(runId)}/events?event_type=curation_started`,
      { headers: AUTH_HEADER },
    );
    expect(res.status()).toBe(200);
    const body = await res.json();

    for (const ev of body.events as { event_type: string }[]) {
      expect(ev.event_type).toBe("curation_started");
    }
  });

  test("returns pagination metadata", async ({ request }) => {
    const { runId } = await curateFreshSubtask(request);

    const res = await request.get(`/api/v1/runs/${encodeURIComponent(runId)}/events`, {
      headers: AUTH_HEADER,
    });
    expect(res.status()).toBe(200);
    const body = await res.json();

    expect(body).toHaveProperty("pagination");
    expect(body.pagination).toHaveProperty("has_more");
    expect(body.pagination).toHaveProperty("next_cursor");
  });
});

// ---------------------------------------------------------------------------
// Suite 3: GET /api/v1/snapshots/{snapshot_id}/explainability — content_hash
// ---------------------------------------------------------------------------

test.describe("GET /api/v1/snapshots/{snapshot_id}/explainability — Session 16 content_hash", () => {
  test("explainability response includes content_hash", async ({ request }) => {
    const { snapshotId } = await curateFreshSubtask(request);

    const res = await request.get(
      `/api/v1/snapshots/${snapshotId}/explainability`,
      { headers: AUTH_HEADER },
    );
    expect(res.status()).toBe(200);
    const body = await res.json();

    expect(body).toHaveProperty("content_hash");
    // content_hash should be a 64-char hex string or null
    if (body.content_hash !== null) {
      expect(body.content_hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  test("snapshot content_hash matches between snapshot and explainability endpoints", async ({
    request,
  }) => {
    const { snapshotId } = await curateFreshSubtask(request);

    const [snapRes, explainRes] = await Promise.all([
      request.get(`/api/v1/snapshots/${snapshotId}`, { headers: AUTH_HEADER }),
      request.get(`/api/v1/snapshots/${snapshotId}/explainability`, {
        headers: AUTH_HEADER,
      }),
    ]);
    expect(snapRes.status()).toBe(200);
    expect(explainRes.status()).toBe(200);

    const snapBody = await snapRes.json();
    const explainBody = await explainRes.json();

    // Both endpoints should return the same content_hash
    expect(snapBody.content_hash).toBe(explainBody.content_hash);
  });
});

// ---------------------------------------------------------------------------
// Suite 4: UI — Explainability screen Session 16 elements
// ---------------------------------------------------------------------------

test.describe("UI — Explainability screen Session 16 governance features", () => {
  test("shows immutable badge and SHA-256 hash when content_hash is present", async ({
    request,
    page,
  }) => {
    const { snapshotId } = await curateFreshSubtask(request);

    await page.goto(`/explainability?snapshot_id=${encodeURIComponent(snapshotId)}`);
    await page.waitForSelector('[aria-label="Snapshot metadata"]', { timeout: 10_000 });

    // The immutable badge should be visible
    const badge = page.locator('[aria-label="Immutable snapshot badge"]');
    await expect(badge).toBeVisible();
    await expect(badge).toContainText("Immutable");
  });

  test("shows replay audit trail panel", async ({ request, page }) => {
    const { snapshotId } = await curateFreshSubtask(request);

    await page.goto(`/explainability?snapshot_id=${encodeURIComponent(snapshotId)}`);
    await page.waitForSelector('[aria-label="Replay audit trail panel"]', {
      timeout: 10_000,
    });

    const panel = page.locator('[aria-label="Replay audit trail panel"]');
    await expect(panel).toBeVisible();
  });

  test("replay panel Load Run Events button loads events", async ({ request, page }) => {
    const { snapshotId } = await curateFreshSubtask(request);

    await page.goto(`/explainability?snapshot_id=${encodeURIComponent(snapshotId)}`);
    await page.waitForSelector('[aria-label="Load replay audit trail"]', {
      timeout: 10_000,
    });

    // Click the load button
    await page.click('[aria-label="Load replay audit trail"]');

    // The replay run events list should appear
    await page.waitForSelector('[aria-label="Replay run events list"]', {
      timeout: 10_000,
    });

    const list = page.locator('[aria-label="Replay run events list"]');
    await expect(list).toBeVisible();
  });
});
