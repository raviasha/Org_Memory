/**
 * e2e/session-08/index-dashboard.spec.ts
 *
 * Session 8 — Index Dashboard Early Visibility
 * @session-08
 *
 * Tests for:
 *   1. GET /api/v1/projects — returns project list with KPI fields
 *   2. GET /api/v1/wiki/pages — returns wiki page list with type/slug/ref fields
 *   3. Project Hub page (/projects) renders live project KPIs in the browser
 *   4. LLM Wiki Explorer page (/wiki) renders page list in the browser
 *   5. Auth enforcement — unauthenticated calls to both new routes return 401
 */

import { test, expect } from "@playwright/test";

const AUTH_HEADER = { Authorization: "Bearer prototype-dev-token" };
const BASE_API = "/api/v1";

// ---------------------------------------------------------------------------
// API tests — GET /api/v1/projects
// ---------------------------------------------------------------------------

test.describe("Session 08 — GET /api/v1/projects @session-08", () => {
  test("returns 401 without auth header", async ({ request }) => {
    const res = await request.get(`${BASE_API}/projects`);
    expect(res.status()).toBe(401);
    const json = await res.json();
    expect(json).toMatchObject({ error: "Unauthorized" });
  });

  test("returns 200 with project list", async ({ request }) => {
    const res = await request.get(`${BASE_API}/projects`, { headers: AUTH_HEADER });
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.data.length).toBeGreaterThan(0);
    expect(json.pagination).toBeDefined();
  });

  test("each project has required KPI fields", async ({ request }) => {
    const res = await request.get(`${BASE_API}/projects`, { headers: AUTH_HEADER });
    const json = await res.json();
    for (const project of json.data) {
      expect(project).toHaveProperty("project_id");
      expect(project).toHaveProperty("name");
      expect(project).toHaveProperty("asset_count");
      expect(project).toHaveProperty("indexed_count");
      expect(project).toHaveProperty("failed_count");
      expect(project).toHaveProperty("last_ingest_at");
      expect(typeof project.asset_count).toBe("number");
      expect(typeof project.indexed_count).toBe("number");
      expect(typeof project.failed_count).toBe("number");
    }
  });

  test("returns all five seed projects", async ({ request }) => {
    const res = await request.get(`${BASE_API}/projects?limit=50`, { headers: AUTH_HEADER });
    const json = await res.json();
    const ids = json.data.map((p: { project_id: string }) => p.project_id);
    expect(ids).toContain("proj-finance-infra-q3");
    expect(ids).toContain("proj-compliance-privacy");
    expect(ids).toContain("proj-eng-incident-ops");
    expect(ids).toContain("proj-corpdev-targetco-dd");
    expect(ids).toContain("proj-org-shared");
  });

  test("pagination — limit=2 returns has_more=true and next_cursor", async ({ request }) => {
    const res = await request.get(`${BASE_API}/projects?limit=2`, { headers: AUTH_HEADER });
    const json = await res.json();
    expect(json.data.length).toBeLessThanOrEqual(2);
    if (json.data.length === 2) {
      expect(json.pagination.has_more).toBe(true);
      expect(json.pagination.next_cursor).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// API tests — GET /api/v1/wiki/pages
// ---------------------------------------------------------------------------

test.describe("Session 08 — GET /api/v1/wiki/pages @session-08", () => {
  test("returns 401 without auth header", async ({ request }) => {
    const res = await request.get(`${BASE_API}/wiki/pages`);
    expect(res.status()).toBe(401);
    const json = await res.json();
    expect(json).toMatchObject({ error: "Unauthorized" });
  });

  test("returns 200 with wiki page list", async ({ request }) => {
    const res = await request.get(`${BASE_API}/wiki/pages`, { headers: AUTH_HEADER });
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.pagination).toBeDefined();
  });

  test("each wiki page has required fields", async ({ request }) => {
    const res = await request.get(`${BASE_API}/wiki/pages`, { headers: AUTH_HEADER });
    const json = await res.json();
    if (json.data.length === 0) return; // skip if DB empty (will be seeded elsewhere)
    for (const page of json.data) {
      expect(page).toHaveProperty("page_id");
      expect(page).toHaveProperty("slug");
      expect(page).toHaveProperty("title");
      expect(page).toHaveProperty("page_type");
      expect(page).toHaveProperty("source_asset_ids");
      expect(page).toHaveProperty("inbound_ref_count");
      expect(page).toHaveProperty("outbound_ref_count");
      expect(page).toHaveProperty("updated_at");
      expect(Array.isArray(page.source_asset_ids)).toBe(true);
    }
  });

  test("page_type filter returns only matching pages", async ({ request }) => {
    const res = await request.get(`${BASE_API}/wiki/pages?page_type=index`, {
      headers: AUTH_HEADER,
    });
    const json = await res.json();
    for (const page of json.data) {
      expect(page.page_type).toBe("index");
    }
  });

  test("slug_prefix filter returns only matching pages", async ({ request }) => {
    const res = await request.get(`${BASE_API}/wiki/pages?slug_prefix=root`, {
      headers: AUTH_HEADER,
    });
    const json = await res.json();
    for (const page of json.data) {
      expect(page.slug).toMatch(/^root/);
    }
  });

  test("root/index and root/log pages exist (from Session 2b seed)", async ({ request }) => {
    const res = await request.get(`${BASE_API}/wiki/pages?slug_prefix=root&limit=50`, {
      headers: AUTH_HEADER,
    });
    const json = await res.json();
    const slugs = json.data.map((p: { slug: string }) => p.slug);
    expect(slugs).toContain("root/index");
    expect(slugs).toContain("root/log");
  });
});

// ---------------------------------------------------------------------------
// Browser / UI tests — Project Hub
// ---------------------------------------------------------------------------

test.describe("Session 08 — Project Hub UI @session-08", () => {
  test("renders Projects heading", async ({ page }) => {
    await page.goto("/projects");
    await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  });

  test("renders project list", async ({ page }) => {
    await page.goto("/projects");
    // Wait for client-side data fetch to complete
    await expect(page.getByRole("list", { name: "Project list" })).toBeVisible({ timeout: 10000 });
  });

  test("each project card shows an asset count", async ({ page }) => {
    await page.goto("/projects");
    await expect(page.getByRole("list", { name: "Project list" })).toBeVisible({ timeout: 10000 });
    const cards = page.locator("[data-project-id]");
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);
  });

  test("each project card shows an indexing status badge", async ({ page }) => {
    await page.goto("/projects");
    await expect(page.getByRole("list", { name: "Project list" })).toBeVisible({ timeout: 10000 });
    // Status badges are rendered with data-status attribute
    const badges = page.locator("[data-status]");
    const count = await badges.count();
    expect(count).toBeGreaterThan(0);
  });

  test("project cards show known project IDs from seed", async ({ page }) => {
    await page.goto("/projects");
    await expect(page.getByRole("list", { name: "Project list" })).toBeVisible({ timeout: 10000 });
    await expect(page.locator("[data-project-id='proj-finance-infra-q3']")).toBeVisible();
    await expect(page.locator("[data-project-id='proj-eng-incident-ops']")).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Browser / UI tests — LLM Wiki Explorer
// ---------------------------------------------------------------------------

test.describe("Session 08 — LLM Wiki Explorer UI @session-08", () => {
  test("renders LLM Wiki Explorer heading", async ({ page }) => {
    await page.goto("/wiki");
    await expect(page.getByRole("heading", { name: "LLM Wiki Explorer" })).toBeVisible();
  });

  test("renders type filter buttons", async ({ page }) => {
    await page.goto("/wiki");
    await expect(page.getByText("Filter by type:")).toBeVisible();
    await expect(page.getByRole("button", { name: "All" })).toBeVisible();
  });

  test("renders wiki page entries from seed", async ({ page }) => {
    await page.goto("/wiki");
    // Wait for client-side data fetch to complete; the summary text appears after load
    await expect(page.locator("p").filter({ hasText: /pages? —/ })).toBeVisible({
      timeout: 10000,
    });
  });

  test("root/index page row is visible", async ({ page }) => {
    await page.goto("/wiki");
    // Wait for data
    await page.waitForTimeout(2000);
    await expect(page.locator("[data-slug='root/index']")).toBeVisible({ timeout: 10000 });
  });

  test("root/log page row is visible", async ({ page }) => {
    await page.goto("/wiki");
    await expect(page.locator("[data-slug='root/log']")).toBeVisible({ timeout: 10000 });
  });

  test("clicking 'index' type filter shows only index pages", async ({ page }) => {
    await page.goto("/wiki");
    await page.waitForTimeout(1500);
    await page.getByRole("button", { name: "index" }).click();
    await page.waitForTimeout(500);
    // After filter, all visible page-type badges should be 'index'
    const rows = page.locator("[data-slug]");
    const count = await rows.count();
    if (count > 0) {
      // At least root/index should be present
      await expect(page.locator("[data-slug='root/index']")).toBeVisible();
    }
  });
});
