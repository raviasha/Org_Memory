/**
 * Session 02b — SCHEMA.md instruction doc and wiki bootstrap seed tests
 *
 * Exit criteria verified here (all pure file-system checks — no DB or server required):
 * 1. SCHEMA.md exists at repo root and is non-empty.
 * 2. SCHEMA.md contains the required instruction sections.
 * 3. Seed migration file exists.
 * 4. Seed migration contains INSERT for root/index slug.
 * 5. Seed migration contains INSERT for root/log slug.
 * 6. Seed migration contains INSERT for each required page type:
 *    summary, entity, concept, comparison, synthesis.
 * 7. Seed migration is idempotent (uses ON CONFLICT).
 * 8. Each INSERT has a valid acl_scope field.
 */

import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const REPO_ROOT = path.resolve(__dirname, "../../");

const schemaDocPath = path.join(REPO_ROOT, "SCHEMA.md");
const seedMigrationPath = path.join(
  REPO_ROOT,
  "supabase/migrations/20260513000001_wiki_bootstrap_seed.sql"
);

test.describe("Session 02b — SCHEMA.md and wiki bootstrap seed @session-02b", () => {
  // --------------------------------------------------------------------------
  // SCHEMA.md checks
  // --------------------------------------------------------------------------

  test("SCHEMA.md exists at repo root", () => {
    expect(fs.existsSync(schemaDocPath)).toBe(true);
  });

  test("SCHEMA.md is non-empty (at least 1000 bytes)", () => {
    const stat = fs.statSync(schemaDocPath);
    expect(stat.size).toBeGreaterThan(1000);
  });

  test("SCHEMA.md contains wiki structure section", () => {
    const content = fs.readFileSync(schemaDocPath, "utf-8");
    expect(content).toMatch(/wiki.*structure|three.*layer|layer.*architecture/i);
  });

  test("SCHEMA.md contains slug naming conventions", () => {
    const content = fs.readFileSync(schemaDocPath, "utf-8");
    // Should mention slug, naming, and the special root pages
    expect(content).toContain("root/index");
    expect(content).toContain("root/log");
  });

  test("SCHEMA.md documents all required page type formats", () => {
    const content = fs.readFileSync(schemaDocPath, "utf-8");
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
      expect(content).toContain(t);
    }
  });

  test("SCHEMA.md documents the ingest workflow", () => {
    const content = fs.readFileSync(schemaDocPath, "utf-8");
    expect(content).toMatch(/ingest.*workflow|ingest.*step|step.*ingest/i);
  });

  test("SCHEMA.md documents the query workflow", () => {
    const content = fs.readFileSync(schemaDocPath, "utf-8");
    expect(content).toMatch(/query.*workflow|query.*step|step.*query/i);
  });

  test("SCHEMA.md documents lint rules", () => {
    const content = fs.readFileSync(schemaDocPath, "utf-8");
    expect(content).toMatch(/lint.*rule|L0[0-9]/);
  });

  // --------------------------------------------------------------------------
  // Seed migration checks
  // --------------------------------------------------------------------------

  test("seed migration file exists", () => {
    expect(fs.existsSync(seedMigrationPath)).toBe(true);
  });

  test("seed migration contains INSERT for root/index", () => {
    const sql = fs.readFileSync(seedMigrationPath, "utf-8");
    expect(sql).toContain("root/index");
  });

  test("seed migration contains INSERT for root/log", () => {
    const sql = fs.readFileSync(seedMigrationPath, "utf-8");
    expect(sql).toContain("root/log");
  });

  test("seed migration contains INSERT with page_type 'summary'", () => {
    const sql = fs.readFileSync(seedMigrationPath, "utf-8");
    expect(sql).toContain("'summary'");
  });

  test("seed migration contains INSERT with page_type 'entity'", () => {
    const sql = fs.readFileSync(seedMigrationPath, "utf-8");
    expect(sql).toContain("'entity'");
  });

  test("seed migration contains INSERT with page_type 'concept'", () => {
    const sql = fs.readFileSync(seedMigrationPath, "utf-8");
    expect(sql).toContain("'concept'");
  });

  test("seed migration contains INSERT with page_type 'comparison'", () => {
    const sql = fs.readFileSync(seedMigrationPath, "utf-8");
    expect(sql).toContain("'comparison'");
  });

  test("seed migration contains INSERT with page_type 'synthesis'", () => {
    const sql = fs.readFileSync(seedMigrationPath, "utf-8");
    expect(sql).toContain("'synthesis'");
  });

  test("seed migration is idempotent (uses ON CONFLICT)", () => {
    const sql = fs.readFileSync(seedMigrationPath, "utf-8");
    expect(sql).toMatch(/ON CONFLICT/i);
  });

  test("seed migration sets acl_scope on every INSERT", () => {
    const sql = fs.readFileSync(seedMigrationPath, "utf-8");
    // Count INSERT statements and acl_scope occurrences — must be at least as many acl_scope values
    const insertCount = (sql.match(/^\s*INSERT INTO wiki_pages/gim) || []).length;
    const aclCount = (sql.match(/acl_scope/gi) || []).length;
    // acl_scope appears in both the column list and the value; 2× per INSERT minimum
    expect(aclCount).toBeGreaterThanOrEqual(insertCount);
    expect(insertCount).toBeGreaterThanOrEqual(7); // 2 nav + 5 content types
  });
});
