/**
 * Session 01b — tech stack and API verification smoke tests
 *
 * These tests validate:
 * 1. TECH_STACK.md is present in the repo root and contains required sections.
 * 2. The resolved tech-stack decisions are consistent with the existing scaffold
 *    (package.json, turbo.json, playwright.config.ts, supabase/config.toml).
 * 3. The Claude Managed Agents memory API surface is documented with the
 *    verified go/no-go decision recorded.
 *
 * All assertions run with Playwright's `request` context only — no browser or
 * running server is required.
 */

import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const REPO_ROOT = path.resolve(__dirname, "../..");

function readRepoFile(relative: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

test.describe("Session 01b — tech stack and API verification @session-01b", () => {
  test("TECH_STACK.md exists in repo root", () => {
    const filePath = path.join(REPO_ROOT, "TECH_STACK.md");
    expect(fs.existsSync(filePath)).toBe(true);
  });

  test("TECH_STACK.md contains required top-level sections", () => {
    const content = readRepoFile("TECH_STACK.md");

    const requiredSections = [
      "Frontend",
      "Backend",
      "Database",
      "Monorepo",
      "Testing",
      "CI",
    ];

    for (const section of requiredSections) {
      expect(
        content,
        `TECH_STACK.md must contain a "${section}" section`
      ).toContain(section);
    }
  });

  test("TECH_STACK.md records Claude Managed Agents API findings", () => {
    const content = readRepoFile("TECH_STACK.md");

    // Verify the exact Anthropic product name is documented
    expect(content).toContain("Managed Agents");

    // Verify the beta header requirement is documented
    expect(content).toContain("managed-agents-2026-04-01");

    // Verify memory store operations are documented
    expect(content).toContain("memory-stores");

    // Verify deterministic file-path model is confirmed
    expect(content).toContain("/assets/{asset_id}.md");

    // Verify seeding is confirmed
    expect(content).toContain("Seed");

    // Verify optimistic concurrency is documented
    expect(content).toContain("content_sha256");
  });

  test("TECH_STACK.md records an explicit go/no-go decision", () => {
    const content = readRepoFile("TECH_STACK.md");
    // Must contain an explicit go decision
    expect(content).toMatch(/go.*no.?go|go\/no.?go/i);
    // The decision must be GO (not NO-GO)
    expect(content).toMatch(/\bGO\b.*✅|\bGO\b.*confirmed/i);
  });

  test("scaffold is consistent with tech-stack decisions: Next.js in apps/web", () => {
    const pkg = JSON.parse(readRepoFile("apps/web/package.json"));
    expect(pkg.dependencies).toHaveProperty("next");
    expect(pkg.name).toBe("@org-memory/web");
  });

  test("scaffold is consistent with tech-stack decisions: Turborepo configured", () => {
    const turbo = JSON.parse(readRepoFile("turbo.json"));
    expect(turbo).toHaveProperty("tasks");
    expect(turbo.tasks).toHaveProperty("build");
  });

  test("scaffold is consistent with tech-stack decisions: Playwright configured", () => {
    // playwright.config.ts exists and references ./e2e as testDir
    const configPath = path.join(REPO_ROOT, "playwright.config.ts");
    expect(fs.existsSync(configPath)).toBe(true);
    const configContent = fs.readFileSync(configPath, "utf8");
    expect(configContent).toContain("testDir");
    expect(configContent).toContain("e2e");
  });

  test("scaffold is consistent with tech-stack decisions: Supabase configured", () => {
    const configPath = path.join(REPO_ROOT, "supabase/config.toml");
    expect(fs.existsSync(configPath)).toBe(true);
    const configContent = fs.readFileSync(configPath, "utf8");
    expect(configContent).toContain("project_id");
  });

  test("scaffold is consistent with tech-stack decisions: TypeScript enforced", () => {
    const rootPkg = JSON.parse(readRepoFile("package.json"));
    expect(rootPkg.devDependencies).toHaveProperty("typescript");
  });

  test("TECH_STACK.md documents 8-store per session limit and 100 kB memory cap", () => {
    const content = readRepoFile("TECH_STACK.md");
    expect(content).toContain("8 memory stores");
    expect(content).toContain("100 kB");
  });

  test("TECH_STACK.md documents that stores can only be attached at session creation", () => {
    const content = readRepoFile("TECH_STACK.md");
    expect(content).toMatch(/cannot be attached to a running session/i);
  });
});
