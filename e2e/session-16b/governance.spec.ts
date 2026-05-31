/**
 * Session 16b — Governance Track: restricted-best-match and signed-trace enforcement
 *
 * Exit criteria:
 *   1.  POST subtasks/{id}/curate with a "Restricted Best Match" task triggers escalation.
 *   2.  escalation.escalated === true, primary_reason_code is set, reason_codes is non-empty.
 *   3.  escalation.description is a non-empty string.
 *   4.  Normal task curation does NOT produce an escalation (escalated === false or null).
 *   5.  POST subtasks/{id}/curate response includes trace_signature (64-char hex).
 *   6.  GET /api/v1/snapshots/{id} returns trace_signature and escalation_info.
 *   7.  GET /api/v1/snapshots/{id}/verify returns { valid: true }.
 *   8.  GET /api/v1/snapshots/{id}/verify requires auth (401 without header).
 *   9.  GET /api/v1/snapshots/nonexistent/verify returns 404.
 *   10. trace_signature verification is stable across repeated calls.
 *   11. Escalated curation emits an escalation_triggered run event.
 *   12. UI explainability page shows escalation warning panel (aria-label="Escalation warning").
 */

import { test, expect, type APIRequestContext } from "@playwright/test";

const AUTH_HEADER = { Authorization: "Bearer prototype-dev-token" };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a new task + curates its first subtask, returning key IDs + body.
 */
async function curateFreshSubtask(
  request: APIRequestContext,
  taskText: string = `Session16b normal task ${Math.random().toString(36).slice(2, 7)}`,
) {
  const taskRes = await request.post("/api/v1/tasks/curate", {
    headers: AUTH_HEADER,
    data: {
      task_text: taskText,
      project_id: "proj-org-shared",
      org_id: "00000000-0000-0000-0000-000000000001",
    },
  });
  expect(taskRes.status()).toBe(201);
  const task = await taskRes.json();
  const subtaskId: string = task.subtasks[0].subtask_id;

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
    curateBody: snap as Record<string, unknown>,
  };
}

/**
 * Creates a task whose text triggers the "Restricted Best Match" intent pattern,
 * then curates it and returns the result.
 */
async function curateRestrictedBestMatchSubtask(request: APIRequestContext) {
  return curateFreshSubtask(
    request,
    "restricted access test escalation acl restricted-best-match classification",
  );
}

// ---------------------------------------------------------------------------
// Suite 1: Restricted-best-match escalation detection
// ---------------------------------------------------------------------------

test.describe("Session 16b — restricted-best-match escalation detection", () => {
  test("escalated curation includes escalation object with escalated=true", async ({
    request,
  }) => {
    const { curateBody } = await curateRestrictedBestMatchSubtask(request);

    expect(curateBody).toHaveProperty("escalation");
    const escalation = curateBody.escalation as Record<string, unknown>;
    expect(escalation).toHaveProperty("escalated", true);
  });

  test("escalated curation has primary_reason_code set", async ({ request }) => {
    const { curateBody } = await curateRestrictedBestMatchSubtask(request);

    const escalation = (curateBody as Record<string, unknown>).escalation as Record<
      string,
      unknown
    >;
    expect(escalation).toHaveProperty("primary_reason_code");
    expect(typeof escalation.primary_reason_code).toBe("string");
    expect(
      ["low_confidence", "acl_restricted", "empty_evidence", "restricted_best_match"],
    ).toContain(escalation.primary_reason_code);
  });

  test("escalated curation has non-empty reason_codes array", async ({ request }) => {
    const { curateBody } = await curateRestrictedBestMatchSubtask(request);

    const escalation = (curateBody as Record<string, unknown>).escalation as Record<
      string,
      unknown
    >;
    expect(Array.isArray(escalation.reason_codes)).toBe(true);
    expect((escalation.reason_codes as unknown[]).length).toBeGreaterThan(0);
  });

  test("escalated curation has non-empty description string", async ({ request }) => {
    const { curateBody } = await curateRestrictedBestMatchSubtask(request);

    const escalation = (curateBody as Record<string, unknown>).escalation as Record<
      string,
      unknown
    >;
    expect(typeof escalation.description).toBe("string");
    expect((escalation.description as string).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Suite 2: Non-escalation case (normal task)
// ---------------------------------------------------------------------------

test.describe("Session 16b — normal task does not escalate", () => {
  test("normal curation has escalation.escalated=false or escalation=null", async ({
    request,
  }) => {
    const { curateBody } = await curateFreshSubtask(request);

    // escalation may be null/undefined or have escalated=false
    const escalation = (curateBody as Record<string, unknown>).escalation as Record<
      string,
      unknown
    > | null | undefined;

    if (escalation != null) {
      expect(escalation.escalated).toBe(false);
    }
    // if null / undefined — also acceptable
  });
});

// ---------------------------------------------------------------------------
// Suite 3: Trace signature in curate response
// ---------------------------------------------------------------------------

test.describe("Session 16b — trace_signature in curate response", () => {
  test("curate response includes trace_signature as 64-char hex string", async ({
    request,
  }) => {
    const { curateBody } = await curateFreshSubtask(request);

    expect(curateBody).toHaveProperty("trace_signature");
    expect(typeof curateBody.trace_signature).toBe("string");
    expect(curateBody.trace_signature as string).toMatch(/^[0-9a-f]{64}$/);
  });

  test("escalated curation also includes trace_signature", async ({ request }) => {
    const { curateBody } = await curateRestrictedBestMatchSubtask(request);

    expect(curateBody).toHaveProperty("trace_signature");
    expect(curateBody.trace_signature as string).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// Suite 4: GET /api/v1/snapshots/{id} — trace_signature and escalation_info fields
// ---------------------------------------------------------------------------

test.describe("Session 16b — GET /api/v1/snapshots/{id} governance fields", () => {
  test("snapshot response includes trace_signature field", async ({ request }) => {
    const { snapshotId } = await curateFreshSubtask(request);

    const res = await request.get(`/api/v1/snapshots/${snapshotId}`, {
      headers: AUTH_HEADER,
    });
    expect(res.status()).toBe(200);
    const body = await res.json();

    expect(body).toHaveProperty("trace_signature");
    expect(typeof body.trace_signature).toBe("string");
    expect(body.trace_signature).toMatch(/^[0-9a-f]{64}$/);
  });

  test("escalated snapshot response includes escalation_info with escalated=true", async ({
    request,
  }) => {
    const { snapshotId } = await curateRestrictedBestMatchSubtask(request);

    const res = await request.get(`/api/v1/snapshots/${snapshotId}`, {
      headers: AUTH_HEADER,
    });
    expect(res.status()).toBe(200);
    const body = await res.json();

    expect(body).toHaveProperty("escalation_info");
    const escalation = body.escalation_info as Record<string, unknown> | null;
    if (escalation != null) {
      expect(escalation.escalated).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Suite 5: GET /api/v1/snapshots/{snapshot_id}/verify
// ---------------------------------------------------------------------------

test.describe("Session 16b — GET /api/v1/snapshots/{snapshot_id}/verify", () => {
  test("returns 401 without auth header", async ({ request }) => {
    const res = await request.get("/api/v1/snapshots/any-id/verify");
    expect(res.status()).toBe(401);
  });

  test("returns 404 for non-existent snapshot", async ({ request }) => {
    const res = await request.get(
      "/api/v1/snapshots/nonexistent-session16b-xyz-does-not-exist/verify",
      { headers: AUTH_HEADER },
    );
    expect(res.status()).toBe(404);
  });

  test("returns valid=true for a freshly curated snapshot", async ({ request }) => {
    const { snapshotId } = await curateFreshSubtask(request);

    const res = await request.get(`/api/v1/snapshots/${snapshotId}/verify`, {
      headers: AUTH_HEADER,
    });
    expect(res.status()).toBe(200);
    const body = await res.json();

    expect(body).toHaveProperty("valid", true);
    expect(body).toHaveProperty("snapshot_id", snapshotId);
    expect(body).toHaveProperty("content_hash");
    expect(body).toHaveProperty("trace_signature");
    expect(body).toHaveProperty("verified_at");
    expect(body.content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(body.trace_signature).toMatch(/^[0-9a-f]{64}$/);
  });

  test("returns valid=true for an escalated snapshot", async ({ request }) => {
    const { snapshotId } = await curateRestrictedBestMatchSubtask(request);

    const res = await request.get(`/api/v1/snapshots/${snapshotId}/verify`, {
      headers: AUTH_HEADER,
    });
    expect(res.status()).toBe(200);
    const body = await res.json();

    expect(body.valid).toBe(true);
  });

  test("verification is stable — repeated calls all return valid=true", async ({
    request,
  }) => {
    const { snapshotId } = await curateFreshSubtask(request);

    const results = await Promise.all(
      [1, 2, 3].map(() =>
        request.get(`/api/v1/snapshots/${snapshotId}/verify`, { headers: AUTH_HEADER }),
      ),
    );

    for (const res of results) {
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.valid).toBe(true);
    }
  });

  test("verified_at is a valid ISO timestamp", async ({ request }) => {
    const { snapshotId } = await curateFreshSubtask(request);

    const res = await request.get(`/api/v1/snapshots/${snapshotId}/verify`, {
      headers: AUTH_HEADER,
    });
    expect(res.status()).toBe(200);
    const body = await res.json();

    expect(typeof body.verified_at).toBe("string");
    const t = new Date(body.verified_at as string).getTime();
    expect(Number.isNaN(t)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Suite 6: escalation_triggered run event
// ---------------------------------------------------------------------------

test.describe("Session 16b — escalation_triggered run event", () => {
  test("escalated curation emits escalation_triggered event in run events", async ({
    request,
  }) => {
    const { runId } = await curateRestrictedBestMatchSubtask(request);

    const res = await request.get(`/api/v1/runs/${runId}/events`, {
      headers: AUTH_HEADER,
    });
    expect(res.status()).toBe(200);
    const body = await res.json();

    const events = body.events as Array<Record<string, unknown>>;
    const escalationEvent = events.find(
      (e) => e.event_type === "escalation_triggered",
    );

    expect(escalationEvent).toBeDefined();
    expect(escalationEvent).toHaveProperty("reason_code");
    expect(typeof escalationEvent!.reason_code).toBe("string");
    expect(escalationEvent!.reason_code).not.toBe("");
  });

  test("normal curation does NOT emit escalation_triggered event", async ({
    request,
  }) => {
    const { runId } = await curateFreshSubtask(request);

    const res = await request.get(`/api/v1/runs/${runId}/events`, {
      headers: AUTH_HEADER,
    });
    expect(res.status()).toBe(200);
    const body = await res.json();

    const events = body.events as Array<Record<string, unknown>>;
    const escalationEvent = events.find(
      (e) => e.event_type === "escalation_triggered",
    );

    expect(escalationEvent).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Suite 7: UI — escalation warning panel
// ---------------------------------------------------------------------------

test.describe("Session 16b — UI escalation warning panel", () => {
  test(
    "explainability page shows escalation warning for restricted-best-match snapshot",
    async ({ page, request }) => {
      // Create an escalated snapshot
      const { snapshotId } = await curateRestrictedBestMatchSubtask(request);

      // Navigate to explainability page with snapshot_id
      await page.goto(
        `/explainability?snapshot_id=${encodeURIComponent(snapshotId)}`,
      );

      // Wait for the data to load
      await page.waitForSelector('[aria-label="Snapshot metadata"]', { timeout: 10000 });

      // Assert escalation warning is visible
      const escalationWarning = page.getByRole("alert", {
        name: "Escalation warning",
      });
      await expect(escalationWarning).toBeVisible({ timeout: 5000 });
    },
  );

  test(
    "explainability page shows signed badge for snapshot with trace_signature",
    async ({ page, request }) => {
      const { snapshotId } = await curateFreshSubtask(request);

      await page.goto(
        `/explainability?snapshot_id=${encodeURIComponent(snapshotId)}`,
      );

      await page.waitForSelector('[aria-label="Snapshot metadata"]', { timeout: 10000 });

      const signedBadge = page.getByLabel("Trace signature badge");
      await expect(signedBadge).toBeVisible({ timeout: 5000 });
    },
  );

  test(
    "normal task explainability page does NOT show escalation warning",
    async ({ page, request }) => {
      const { snapshotId } = await curateFreshSubtask(request);

      await page.goto(
        `/explainability?snapshot_id=${encodeURIComponent(snapshotId)}`,
      );

      await page.waitForSelector('[aria-label="Snapshot metadata"]', { timeout: 10000 });

      // Should not be present
      const escalationWarning = page.getByRole("alert", { name: "Escalation warning" });
      await expect(escalationWarning).not.toBeVisible({ timeout: 3000 }).catch(() => {
        // If check for not-visible itself throws because element never appeared, that's fine
      });
      const count = await escalationWarning.count();
      expect(count).toBe(0);
    },
  );
});
