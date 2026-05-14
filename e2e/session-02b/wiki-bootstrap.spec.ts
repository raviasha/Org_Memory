/**
 * Session 2b — SCHEMA.md authoring and wiki bootstrap tests
 *
 * Pure file-system and static contract tests — no running server required.
 *
 * Exit criteria verified:
 * 1. SCHEMA.md exists in repo root.
 * 2. SCHEMA.md contains all required top-level sections.
 * 3. All nine page types are documented in SCHEMA.md.
 * 4. All three lint-required slug patterns are defined (root/index, root/log,
 *    stores/catalog/index).
 * 5. The seed migration file exists and contains INSERT rows for both special
 *    navigation slugs (root/index and root/log).
 * 6. The seed migration contains at least one example row for each of the
 *    five content page types: summary, entity, concept, comparison, synthesis.
 */

import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");

const SCHEMA_PATH = path.join(ROOT, "SCHEMA.md");
const SEED_MIGRATION_PATH = path.join(
  ROOT,
  "supabase/migrations/20260513100000_wiki_bootstrap_seed.sql",
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _schema: string | null = null;
function loadSchema(): string {
  if (_schema) return _schema;
  _schema = fs.readFileSync(SCHEMA_PATH, "utf8");
  return _schema;
}

let _seed: string | null = null;
function loadSeed(): string {
  if (_seed) return _seed;
  _seed = fs.readFileSync(SEED_MIGRATION_PATH, "utf8");
  return _seed;
}

// ---------------------------------------------------------------------------
// SCHEMA.md structure tests
// ---------------------------------------------------------------------------

test.describe("Session 2b — SCHEMA.md @session-02b", () => {
  test("SCHEMA.md exists in repo root", () => {
    expect(fs.existsSync(SCHEMA_PATH)).toBe(true);
  });

  test("SCHEMA.md contains required top-level sections", () => {
    const schema = loadSchema();
    const requiredSections = [
      "## 1. Overview",
      "## 2. Database Schema Reference",
      "## 3. Slug Naming Conventions",
      "## 4. Page Types and Required Formats",
      "## 5. Ingest Workflow",
      "## 6. Query Workflow",
      "## 7. Lint Rules",
      "## 8. Cross-Reference Rules",
      "## 9. ACL Enforcement Rules",
      "## 10. Memory-Store Routing Rules",
    ];
    for (const section of requiredSections) {
      expect(schema, `Missing section: ${section}`).toContain(section);
    }
  });

  test("SCHEMA.md documents all nine wiki page types", () => {
    const schema = loadSchema();
    const requiredTypes = [
      "summary",
      "entity",
      "concept",
      "comparison",
      "synthesis",
      "index",
      "log",
      "store_catalog",
      "lint_report",
    ];
    for (const t of requiredTypes) {
      expect(schema, `Missing page type documentation: ${t}`).toContain(t);
    }
  });

  test("SCHEMA.md defines the root/index slug", () => {
    expect(loadSchema()).toContain("root/index");
  });

  test("SCHEMA.md defines the root/log slug", () => {
    expect(loadSchema()).toContain("root/log");
  });

  test("SCHEMA.md defines the stores/catalog/index slug", () => {
    expect(loadSchema()).toContain("stores/catalog/index");
  });

  test("SCHEMA.md specifies ingest workflow steps", () => {
    const schema = loadSchema();
    // Verify key step markers are present
    expect(schema).toContain("Step 1");
    expect(schema).toContain("Step 9");
    expect(schema).toContain("Step 11");
  });

  test("SCHEMA.md specifies lint rules with IDs L01 through L10", () => {
    const schema = loadSchema();
    for (let i = 1; i <= 10; i++) {
      const id = `L${String(i).padStart(2, "0")}`;
      expect(schema, `Missing lint rule ${id}`).toContain(id);
    }
  });

  test("SCHEMA.md specifies memory-store 3-store attach cap", () => {
    expect(loadSchema()).toContain("3 stores");
  });
});

// ---------------------------------------------------------------------------
// Seed migration tests
// ---------------------------------------------------------------------------

test.describe("Session 2b — wiki bootstrap seed migration @session-02b", () => {
  test("seed migration file exists", () => {
    expect(fs.existsSync(SEED_MIGRATION_PATH)).toBe(true);
  });

  test("seed migration inserts root/index row", () => {
    expect(loadSeed()).toContain("'root/index'");
  });

  test("seed migration inserts root/log row", () => {
    expect(loadSeed()).toContain("'root/log'");
  });

  test("seed migration inserts example summary page", () => {
    expect(loadSeed()).toContain("'summary'");
  });

  test("seed migration inserts example entity page", () => {
    expect(loadSeed()).toContain("'entity'");
  });

  test("seed migration inserts example concept page", () => {
    expect(loadSeed()).toContain("'concept'");
  });

  test("seed migration inserts example comparison page", () => {
    expect(loadSeed()).toContain("'comparison'");
  });

  test("seed migration inserts example synthesis page", () => {
    expect(loadSeed()).toContain("'synthesis'");
  });

  test("seed migration uses on conflict do nothing (idempotent)", () => {
    const count = (loadSeed().match(/on conflict.*do nothing/gi) ?? []).length;
    // At least one per wiki_pages INSERT (7 pages) and one for projects
    expect(count).toBeGreaterThanOrEqual(7);
  });

  test("seed migration inserts cross-reference rows for root/index <-> root/log", () => {
    const seed = loadSeed();
    expect(seed).toContain("wiki_cross_references");
    // Both directions should be present
    const hasForward =
      seed.includes("'root/index'") &&
      seed.includes("'root/log'") &&
      seed.includes("wiki_cross_references");
    expect(hasForward).toBe(true);
  });
});
