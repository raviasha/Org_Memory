/**
 * lib/schema-injection.ts — Session 8d
 *
 * SCHEMA.md injection contract.
 *
 * SCHEMA.md is loaded as a system prompt prefix on every Claude API call
 * that touches the org memory wiki. This ensures Claude knows the wiki
 * structure, naming conventions, page formats, ingest workflow, query
 * workflow, and lint rules before generating any wiki content.
 *
 * Loading strategy
 * ----------------
 * 1. Read SCHEMA.md from the repo root (two levels above apps/web).
 * 2. Return the full text as a string to be prepended to the system prompt.
 * 3. Extract the session tag / version so callers can verify the schema
 *    version matches an expected value before starting a session.
 *
 * Version validation
 * ------------------
 * Call validateSchemaVersion(expected) before each Claude session to assert
 * the loaded file version matches the expected tag. A mismatch logs a warning
 * but does not throw — the prototype should continue with the available schema
 * rather than failing hard. In production, treat a mismatch as a blocking error.
 */

import { join } from "node:path";
import { readFileSync, existsSync } from "node:fs";

// ---------------------------------------------------------------------------
// Resolve SCHEMA.md path
// ---------------------------------------------------------------------------

/**
 * Resolve the absolute path to SCHEMA.md, searching from the process cwd
 * upward until found or the search depth is exhausted.
 */
function resolveSchemaPath(): string | null {
  // When running under Next.js dev server, cwd() is apps/web; climb up.
  const candidates: string[] = [];
  let dir = process.cwd();
  for (let i = 0; i < 4; i++) {
    candidates.push(join(dir, "SCHEMA.md"));
    const parent = join(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return candidates.find(existsSync) ?? null;
}

let _cachedContent: string | null = null;
let _cachedPath: string | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Return the full text of SCHEMA.md.
 * Result is cached after the first successful read.
 * Returns an empty string if the file cannot be found (never throws).
 */
export function getSchemaContent(): string {
  if (_cachedContent !== null) return _cachedContent;

  const schemaPath = resolveSchemaPath();
  if (!schemaPath) {
    console.warn("[schema-injection] SCHEMA.md not found — schema will not be injected.");
    _cachedContent = "";
    return "";
  }

  try {
    _cachedContent = readFileSync(schemaPath, "utf-8");
    _cachedPath = schemaPath;
    return _cachedContent;
  } catch (err) {
    console.warn("[schema-injection] Failed to read SCHEMA.md:", err);
    _cachedContent = "";
    return "";
  }
}

/**
 * Extract the session tag / version from SCHEMA.md.
 * Looks for a line containing "Session tag: Session N" or "_Session tag: ..._".
 * Returns "unknown" if not found.
 */
export function getSchemaVersion(): string {
  const content = getSchemaContent();
  const match = content.match(/Session tag:\s*(Session\s+\S+)/i);
  return match ? match[1] : "unknown";
}

/**
 * Build a system prompt prefix that injects SCHEMA.md.
 * Returns an empty string when SCHEMA.md is unavailable so callers can
 * concatenate safely.
 */
export function buildSchemaSystemPrefix(): string {
  const content = getSchemaContent();
  if (!content) return "";

  return [
    "# Org Memory Wiki — Schema Instructions",
    "",
    "The following is the current SCHEMA.md that governs how this wiki works.",
    "Follow its conventions exactly when creating or updating wiki pages.",
    "",
    "---",
    "",
    content,
    "",
    "---",
    "",
    "End of SCHEMA.md. Proceed with the task below.",
    "",
  ].join("\n");
}

/**
 * Validate that the loaded SCHEMA.md version matches the expected version tag.
 *
 * @param expected - e.g. "Session 2b" or "unknown" to skip validation
 * @returns { ok: boolean; loaded: string; expected: string; path: string | null }
 */
export function validateSchemaVersion(expected: string): {
  ok: boolean;
  loaded: string;
  expected: string;
  path: string | null;
} {
  const loaded = getSchemaVersion();
  const ok = expected === "unknown" || loaded === expected;

  if (!ok) {
    console.warn(
      `[schema-injection] Schema version mismatch: expected="${expected}" loaded="${loaded}" path="${_cachedPath}"`,
    );
  }

  return { ok, loaded, expected, path: _cachedPath };
}
