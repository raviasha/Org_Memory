/**
 * Session 15 — Provider adapter abstraction
 *
 * Exit criteria:
 * - POST /api/v1/provider/validate returns valid=true for claude and openai
 *   with correct keys; returns valid=false with clear error when openai is
 *   requested without a Claude key (dual-key constraint).
 * - POST /api/v1/subtasks/:id/execute runs the stub adapter and returns an
 *   answer with the correct provider and stub_mode=true when no keys given.
 * - Provider switch: the same context pack runs against both claude and openai
 *   stub adapters.
 * - Missing-key error: POST /execute with provider=openai and no claude_api_key
 *   returns 400 with a message referencing the dual-key requirement.
 * - UI: provider selection screen renders with both radio buttons; dual-key
 *   notice is visible when OpenAI is selected; prototype mode banner is visible.
 */

import { test, expect, type APIRequestContext } from "@playwright/test";

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
      task_text: "What are the key risks in acquiring TargetCo?",
      project_id: "proj-corpdev-targetco-dd",
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
// POST /api/v1/provider/validate — auth
// ---------------------------------------------------------------------------

test.describe("POST /api/v1/provider/validate — auth", () => {
  test("returns 401 without auth header", async ({ request }) => {
    const res = await request.post("/api/v1/provider/validate", {
      data: { provider: "claude" },
    });
    expect(res.status()).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/provider/validate — stub mode
// ---------------------------------------------------------------------------

test.describe("POST /api/v1/provider/validate — stub mode", () => {
  test("valid=true for claude with no keys (stub mode)", async ({ request }) => {
    const res = await request.post("/api/v1/provider/validate", {
      headers: { Authorization: AUTH, "Content-Type": "application/json" },
      data: { provider: "claude" },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(true);
    expect(body.provider).toBe("claude");
    expect(body.stub_mode).toBe(true);
    expect(Array.isArray(body.errors) || body.errors === undefined).toBe(true);
  });

  test("valid=true for openai with no keys (stub mode)", async ({ request }) => {
    const res = await request.post("/api/v1/provider/validate", {
      headers: { Authorization: AUTH, "Content-Type": "application/json" },
      data: { provider: "openai" },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(true);
    expect(body.provider).toBe("openai");
    expect(body.stub_mode).toBe(true);
    // Even in stub mode the dual-key requirement is noted
    expect(body.dual_key_required).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/provider/validate — dual-key constraint
// ---------------------------------------------------------------------------

test.describe("POST /api/v1/provider/validate — dual-key constraint", () => {
  test("returns 400 when openai selected with openai key but NO claude key", async ({
    request,
  }) => {
    const res = await request.post("/api/v1/provider/validate", {
      headers: { Authorization: AUTH, "Content-Type": "application/json" },
      data: {
        provider: "openai",
        openai_api_key: "sk-fake-openai-key",
        // claude_api_key intentionally omitted
      },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.valid).toBe(false);
    expect(Array.isArray(body.errors)).toBe(true);
    expect(body.errors.length).toBeGreaterThan(0);
    // Error must reference the memory store requirement
    const errorText = body.errors.join(" ").toLowerCase();
    expect(
      errorText.includes("claude") || errorText.includes("memory"),
    ).toBe(true);
  });

  test("returns 400 when openai selected with claude key but NO openai key", async ({
    request,
  }) => {
    const res = await request.post("/api/v1/provider/validate", {
      headers: { Authorization: AUTH, "Content-Type": "application/json" },
      data: {
        provider: "openai",
        claude_api_key: "sk-ant-fake-claude-key",
        // openai_api_key intentionally omitted
      },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.valid).toBe(false);
    expect(Array.isArray(body.errors)).toBe(true);
    const errorText = body.errors.join(" ").toLowerCase();
    expect(errorText.includes("openai")).toBe(true);
  });

  test("returns 200 valid for openai when both keys provided", async ({ request }) => {
    const res = await request.post("/api/v1/provider/validate", {
      headers: { Authorization: AUTH, "Content-Type": "application/json" },
      data: {
        provider: "openai",
        claude_api_key: "sk-ant-fake-claude-key",
        openai_api_key: "sk-fake-openai-key",
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(true);
    expect(body.provider).toBe("openai");
    expect(body.stub_mode).toBe(false);
    expect(body.dual_key_required).toBe(true);
    expect(body.memory_provider).toBe("claude");
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/subtasks/:id/execute — auth
// ---------------------------------------------------------------------------

test.describe("POST /api/v1/subtasks/:id/execute — auth", () => {
  test("returns 401 without auth header", async ({ request }) => {
    const res = await request.post("/api/v1/subtasks/fake-subtask/execute");
    expect(res.status()).toBe(401);
  });

  test("returns 404 for unknown subtask", async ({ request }) => {
    const res = await request.post(
      "/api/v1/subtasks/completely-unknown-subtask-id-session15/execute",
      { headers: { Authorization: AUTH, "Content-Type": "application/json" }, data: {} },
    );
    expect(res.status()).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/subtasks/:id/execute — missing-key error (dual-key constraint)
// ---------------------------------------------------------------------------

test.describe("POST /api/v1/subtasks/:id/execute — missing-key error", () => {
  test("returns 400 when provider=openai without claude_api_key", async ({ request }) => {
    const { subtaskId } = await createAndCurateSubtask(request);

    const res = await request.post(`/api/v1/subtasks/${subtaskId}/execute`, {
      headers: { Authorization: AUTH, "Content-Type": "application/json" },
      data: {
        provider: "openai",
        openai_api_key: "sk-fake-openai-key",
        // claude_api_key intentionally omitted
      },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty("error");
    const errorText = (body.error as string).toLowerCase();
    // Must mention Claude and memory store requirement
    expect(
      errorText.includes("claude") || errorText.includes("memory"),
    ).toBe(true);
    expect(body.dual_key_required).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/subtasks/:id/execute — provider switch
// ---------------------------------------------------------------------------

test.describe("POST /api/v1/subtasks/:id/execute — provider switch", () => {
  test("executes via claude stub adapter and returns answer", async ({ request }) => {
    const { subtaskId } = await createAndCurateSubtask(request);

    const res = await request.post(`/api/v1/subtasks/${subtaskId}/execute`, {
      headers: { Authorization: AUTH, "Content-Type": "application/json" },
      data: { provider: "claude" },
    });
    expect([200, 201]).toContain(res.status());
    const body = await res.json();

    expect(body).toHaveProperty("subtask_id", subtaskId);
    expect(body).toHaveProperty("provider", "claude");
    expect(body.stub_mode).toBe(true);
    expect(typeof body.answer).toBe("string");
    expect(body.answer.length).toBeGreaterThan(0);
    expect(body).toHaveProperty("token_usage");
    expect(body.token_usage).toHaveProperty("total_tokens");
    expect(body).toHaveProperty("model");
    expect(body).toHaveProperty("executed_at");
    expect(Array.isArray(body.evidence_ids)).toBe(true);
    // No memory_provider_note for claude-only runs
    expect(body.memory_provider_note ?? null).toBeNull();
  });

  test("executes via openai stub adapter and returns answer", async ({ request }) => {
    const { subtaskId } = await createAndCurateSubtask(request);

    const res = await request.post(`/api/v1/subtasks/${subtaskId}/execute`, {
      headers: { Authorization: AUTH, "Content-Type": "application/json" },
      data: { provider: "openai" },
    });
    expect([200, 201]).toContain(res.status());
    const body = await res.json();

    expect(body).toHaveProperty("subtask_id", subtaskId);
    expect(body).toHaveProperty("provider", "openai");
    expect(body.stub_mode).toBe(true);
    expect(typeof body.answer).toBe("string");
    expect(body.answer.length).toBeGreaterThan(0);
    expect(body).toHaveProperty("token_usage");
    // OpenAI path must include memory_provider_note
    expect(typeof body.memory_provider_note).toBe("string");
    expect(body.memory_provider_note.toLowerCase()).toContain("claude");
  });

  test("same context pack produces answers from both providers", async ({ request }) => {
    // Create one subtask, curate once, run through both adapters
    const { subtaskId, snapshotId } = await createAndCurateSubtask(request);

    const claudeRes = await request.post(`/api/v1/subtasks/${subtaskId}/execute`, {
      headers: { Authorization: AUTH, "Content-Type": "application/json" },
      data: { provider: "claude", snapshot_id: snapshotId },
    });
    expect([200, 201]).toContain(claudeRes.status());
    const claudeBody = await claudeRes.json();

    const openaiRes = await request.post(`/api/v1/subtasks/${subtaskId}/execute`, {
      headers: { Authorization: AUTH, "Content-Type": "application/json" },
      data: { provider: "openai", snapshot_id: snapshotId },
    });
    expect([200, 201]).toContain(openaiRes.status());
    const openaiBody = await openaiRes.json();

    // Both use the same snapshot
    expect(claudeBody.snapshot_id).toBe(snapshotId);
    expect(openaiBody.snapshot_id).toBe(snapshotId);

    // Both return non-empty answers
    expect(claudeBody.answer.length).toBeGreaterThan(0);
    expect(openaiBody.answer.length).toBeGreaterThan(0);

    // Provider labels differ
    expect(claudeBody.provider).toBe("claude");
    expect(openaiBody.provider).toBe("openai");
  });
});

// ---------------------------------------------------------------------------
// UI — provider selection screen
// ---------------------------------------------------------------------------

test.describe("UI — provider selection screen", () => {
  test("tasks page loads with provider panel and prototype banner", async ({ page }) => {
    await page.goto("/tasks");

    // Prototype mode banner is visible
    const banner = page.getByRole("status", { name: /prototype mode banner/i });
    await expect(banner).toBeVisible();

    // Provider panel renders
    const providerPanel = page.getByRole("group").filter({ hasText: /execution provider/i }).or(
      page.locator('[aria-label="Provider selection panel"]'),
    );
    await expect(providerPanel).toBeVisible();

    // Both Claude and OpenAI radio buttons are present
    const claudeRadio = page.locator('input[type="radio"][value="claude"]');
    const openaiRadio = page.locator('input[type="radio"][value="openai"]');
    await expect(claudeRadio).toBeVisible();
    await expect(openaiRadio).toBeVisible();
  });

  test("dual-key notice appears when OpenAI is selected", async ({ page }) => {
    await page.goto("/tasks");

    // Select OpenAI
    await page.locator('input[type="radio"][value="openai"]').click();

    // Dual-key notice should appear
    const notice = page.getByRole("alert", { name: /dual-key requirement/i });
    await expect(notice).toBeVisible();

    // Notice must mention Claude and memory
    const noticeText = await notice.textContent();
    expect(noticeText?.toLowerCase()).toContain("claude");
  });

  test("dual-key notice is NOT shown when Claude is selected", async ({ page }) => {
    await page.goto("/tasks");

    // Claude is the default; ensure openai was not selected
    await page.locator('input[type="radio"][value="claude"]').click();

    // No dual-key notice
    const notice = page.locator('[aria-label="Dual-key requirement notice"]');
    await expect(notice).not.toBeVisible();
  });

  test("OpenAI key input appears when OpenAI is selected", async ({ page }) => {
    await page.goto("/tasks");

    // Initially no OpenAI key input
    const openaiInput = page.locator('[aria-label="OpenAI API key input"]');
    await expect(openaiInput).not.toBeVisible();

    // Select OpenAI
    await page.locator('input[type="radio"][value="openai"]').click();

    // OpenAI key input now visible
    await expect(openaiInput).toBeVisible();
  });
});
