/**
 * Session 01c — DB schema and auth-gated endpoint tests
 *
 * Exit criteria verified here:
 * 1. `blocked_on_memory_write` status value is present in the validator
 *    (contract test — no DB required).
 * 2. GET /api/v1/health returns 401 for unauthenticated callers.
 * 3. GET /api/v1/health returns 200 when a Bearer token is supplied.
 *
 * Tests 2 and 3 require the Next.js dev server (configured in
 * playwright.config.ts webServer). When running in CI without a running
 * server these tests are skipped; a full E2E pass is expected in local dev.
 */

import { test, expect } from "@playwright/test";
import { AssetIngestStatusSchema } from "../../packages/validators/src/index";

test.describe("Session 01c — schema and auth-gated endpoint @session-01c", () => {
  // ------------------------------------------------------------------
  // Contract test: blocked_on_memory_write enum value
  // ------------------------------------------------------------------
  test("AssetIngestStatusSchema includes blocked_on_memory_write", () => {
    const values = AssetIngestStatusSchema.options;
    expect(values).toContain("blocked_on_memory_write");
  });

  test("AssetIngestStatusSchema includes all standard ingest lifecycle values", () => {
    const values = AssetIngestStatusSchema.options;
    const required = [
      "pending",
      "processing",
      "indexed",
      "failed",
      "deleted",
      "blocked_on_memory_write",
    ];
    for (const v of required) {
      expect(values).toContain(v);
    }
  });

  // ------------------------------------------------------------------
  // API tests: auth gate on /api/v1/health
  // ------------------------------------------------------------------
  test("GET /api/v1/health returns 401 without Authorization header", async ({
    request,
  }) => {
    const response = await request.get("/api/v1/health");
    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body).toHaveProperty("error", "Unauthorized");
  });

  test("GET /api/v1/health returns 401 with malformed Authorization header", async ({
    request,
  }) => {
    const response = await request.get("/api/v1/health", {
      headers: { Authorization: "Basic dXNlcjpwYXNz" },
    });
    expect(response.status()).toBe(401);
  });

  test("GET /api/v1/health returns 200 when a Bearer token is supplied", async ({
    request,
  }) => {
    // In prototype mode (Supabase env vars absent), the endpoint returns 200
    // for any non-empty Bearer token. Once Supabase Auth is fully wired this
    // test must supply a real JWT from the test user fixture.
    const response = await request.get("/api/v1/health", {
      headers: { Authorization: "Bearer prototype-dev-token" },
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty("status", "ok");
    expect(body).toHaveProperty("service", "org-memory-api");
    expect(body).toHaveProperty("timestamp");
  });
});
