/**
 * Session 03 — UI shell smoke tests
 *
 * These tests validate the Next.js UI shell:
 *   1. Home page renders the Dashboard heading.
 *   2. The navigation sidebar is present and contains the expected links.
 *   3. Each top-level route (/projects, /assets, /wiki) renders its heading.
 *   4. Clicking a nav link navigates to the correct page.
 *
 * Requires the Next.js dev server (configured via playwright.config.ts webServer).
 */

import { test, expect } from "@playwright/test";

test.describe("Session 03 — UI shell @session-03", () => {
  test("home page renders Dashboard heading", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  });

  test("navigation sidebar is present", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
  });

  test("nav contains Dashboard link", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("navigation").getByRole("link", { name: "Dashboard" })
    ).toBeVisible();
  });

  test("nav contains Projects link", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("navigation").getByRole("link", { name: "Projects" })
    ).toBeVisible();
  });

  test("nav contains Assets link", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("navigation").getByRole("link", { name: "Assets" })
    ).toBeVisible();
  });

  test("nav contains Wiki link", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("navigation").getByRole("link", { name: "Wiki" })
    ).toBeVisible();
  });

  test("Projects page renders heading", async ({ page }) => {
    await page.goto("/projects");
    await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  });

  test("Assets page renders heading", async ({ page }) => {
    await page.goto("/assets");
    await expect(page.getByRole("heading", { name: "Assets" })).toBeVisible();
  });

  test("Wiki page renders heading", async ({ page }) => {
    await page.goto("/wiki");
    await expect(page.getByRole("heading", { name: "Wiki" })).toBeVisible();
  });

  test("clicking Projects nav link navigates to /projects", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("navigation").getByRole("link", { name: "Projects" }).click();
    await expect(page).toHaveURL("/projects");
    await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  });

  test("clicking Assets nav link navigates to /assets", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("navigation").getByRole("link", { name: "Assets" }).click();
    await expect(page).toHaveURL("/assets");
    await expect(page.getByRole("heading", { name: "Assets" })).toBeVisible();
  });

  test("clicking Wiki nav link navigates to /wiki", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("navigation").getByRole("link", { name: "Wiki" }).click();
    await expect(page).toHaveURL("/wiki");
    await expect(page.getByRole("heading", { name: "Wiki" })).toBeVisible();
  });

  test("home page section cards link to correct routes", async ({ page }) => {
    await page.goto("/");
    const projectsCard = page.getByRole("main").getByRole("link", { name: "Projects" });
    const assetsCard = page.getByRole("main").getByRole("link", { name: "Assets" });
    const wikiCard = page.getByRole("main").getByRole("link", { name: "Wiki" });

    await expect(projectsCard).toHaveAttribute("href", "/projects");
    await expect(assetsCard).toHaveAttribute("href", "/assets");
    await expect(wikiCard).toHaveAttribute("href", "/wiki");
  });
});
