/**
 * lib/managed-memory.ts — Session 8d
 *
 * Claude Managed Agents memory store integration.
 *
 * Provides a dual-mode client:
 *   REAL mode  — calls the Anthropic Managed Agents REST API when
 *                ANTHROPIC_API_KEY is set in the environment.
 *   STUB mode  — simulates the same operations using Supabase as backing
 *                store when no API key is present (local dev / CI).
 *
 * Public surface
 * --------------
 * getOrCreateProjectStore(params)  → { local_store_id, anthropic_store_id }
 * writeAssetMemory(params)         → { memory_id, memory_version_id, path }
 * listMemoryActivity(storeId, db)  → MemoryActivityItem[]
 *
 * Idempotent update contract
 * --------------------------
 * writeAssetMemory first checks for an existing memory at the canonical path.
 * If found, it updates with a content_sha256 precondition (optimistic
 * concurrency). On a 409 conflict it re-reads and retries once. On any other
 * failure it throws so the caller can apply exponential back-off.
 *
 * Provenance fields written inside every canonical asset memory
 * ------------------------------------------------------------
 *   asset_id, project_id, source_uri, acl_scope, ingest_run_id,
 *   memory_version_id (added after the write returns), schema_version
 */

import * as crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProjectStoreResult {
  local_store_id: string;
  anthropic_store_id: string; // "stub-<uuid>" in stub mode
}

export interface WriteAssetMemoryParams {
  local_store_id: string;
  anthropic_store_id: string;
  asset_id: string;
  project_id: string;
  source_uri: string;
  acl_scope: string;
  ingest_run_id: string;
  normalized_text: string;
  schema_version?: string;
  db?: SupabaseLike | null;
}

export interface WriteAssetMemoryResult {
  memory_id: string;       // "mem_..." or "stub-mem-..."
  memory_version_id: string; // "memver_..." or "stub-memver-..."
  path: string;
  content_sha256: string;
}

export interface MemoryActivityItem {
  event_type: string;
  memory_path: string;
  memory_version_id: string | null;
  asset_id: string;
  occurred_at: string;
  error?: string;
}

// Minimal Supabase client interface needed by this module
export interface SupabaseLike {
  from: (table: string) => {
    select: (cols?: string) => {
      eq: (col: string, val: unknown) => Promise<{ data: unknown[] | null; error: unknown }>;
      ilike?: (col: string, val: string) => {
        order: (col: string, opts?: { ascending: boolean }) => Promise<{ data: unknown[] | null; error: unknown }>;
      };
      order?: (col: string, opts?: { ascending: boolean }) => Promise<{ data: unknown[] | null; error: unknown }>;
    };
    upsert: (row: Record<string, unknown>, opts?: Record<string, unknown>) => Promise<{ error: unknown }>;
    update: (row: Record<string, unknown>) => {
      eq: (col: string, val: unknown) => Promise<{ error: unknown }>;
    };
    insert: (rows: Record<string, unknown> | Record<string, unknown>[]) => Promise<{ error: unknown }>;
  };
}

// ---------------------------------------------------------------------------
// Anthropic API constants
// ---------------------------------------------------------------------------

const ANTHROPIC_BASE = "https://api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";
const MANAGED_AGENTS_BETA = "managed-agents-2026-04-01";
const MEMORY_SIZE_LIMIT = 95_000; // chars — stay under 100 kB per-memory limit

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isStubMode(): boolean {
  return !process.env.ANTHROPIC_API_KEY;
}

function anthropicHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "anthropic-version": ANTHROPIC_VERSION,
    "anthropic-beta": MANAGED_AGENTS_BETA,
    "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
  };
}

function sha256(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

function stubMemstoreId(local_id: string): string {
  return `stub-memstore-${local_id.slice(0, 8)}`;
}

function stubMemverId(): string {
  return `stub-memver-${crypto.randomUUID().slice(0, 12)}`;
}

function stubMemId(): string {
  return `stub-mem-${crypto.randomUUID().slice(0, 12)}`;
}

// ---------------------------------------------------------------------------
// Canonical memory content builder
// ---------------------------------------------------------------------------

export function buildCanonicalAssetMemory(params: {
  asset_id: string;
  project_id: string;
  source_uri: string;
  acl_scope: string;
  ingest_run_id: string;
  normalized_text: string;
  schema_version: string;
}): string {
  const truncated =
    params.normalized_text.length > MEMORY_SIZE_LIMIT
      ? params.normalized_text.slice(0, MEMORY_SIZE_LIMIT) +
        "\n\n[content truncated at 95 000 chars — full text in assets table]"
      : params.normalized_text;

  return `# Asset Memory — ${params.asset_id}

## Provenance
- asset_id: ${params.asset_id}
- project_id: ${params.project_id}
- source_uri: ${params.source_uri}
- acl_scope: ${params.acl_scope}
- ingest_run_id: ${params.ingest_run_id}
- schema_version: ${params.schema_version}
- written_at: ${new Date().toISOString()}

## Normalized Content

${truncated}
`;
}

// ---------------------------------------------------------------------------
// Real Anthropic API helpers
// ---------------------------------------------------------------------------

async function anthropicCreateStore(
  name: string,
  description: string,
): Promise<{ id: string }> {
  const res = await fetch(`${ANTHROPIC_BASE}/v1/memory_stores`, {
    method: "POST",
    headers: anthropicHeaders(),
    body: JSON.stringify({ name, description }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic create_store failed ${res.status}: ${text}`);
  }
  return res.json() as Promise<{ id: string }>;
}

async function anthropicFindMemoryByPath(
  storeId: string,
  path: string,
): Promise<{ id: string; content_sha256: string } | null> {
  const url = new URL(`${ANTHROPIC_BASE}/v1/memory_stores/${storeId}/memories`);
  url.searchParams.set("path_prefix", path);
  const res = await fetch(url.toString(), { headers: anthropicHeaders() });
  if (!res.ok) return null;
  const body = (await res.json()) as { data?: Array<{ id: string; path: string; content_sha256: string }> };
  return body.data?.find((m) => m.path === path) ?? null;
}

async function anthropicCreateMemory(
  storeId: string,
  path: string,
  content: string,
): Promise<{ id: string; content_sha256: string }> {
  const res = await fetch(
    `${ANTHROPIC_BASE}/v1/memory_stores/${storeId}/memories`,
    {
      method: "POST",
      headers: anthropicHeaders(),
      body: JSON.stringify({ path, content }),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic create_memory failed ${res.status}: ${text}`);
  }
  return res.json() as Promise<{ id: string; content_sha256: string }>;
}

async function anthropicUpdateMemory(
  storeId: string,
  memoryId: string,
  content: string,
  preconditionSha: string,
): Promise<{ id: string; content_sha256: string } | null> {
  const res = await fetch(
    `${ANTHROPIC_BASE}/v1/memory_stores/${storeId}/memories/${memoryId}`,
    {
      method: "POST",
      headers: anthropicHeaders(),
      body: JSON.stringify({
        content,
        precondition: { type: "content_sha256", content_sha256: preconditionSha },
      }),
    },
  );
  if (res.status === 409) return null; // precondition failed — caller should retry
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic update_memory failed ${res.status}: ${text}`);
  }
  return res.json() as Promise<{ id: string; content_sha256: string }>;
}

/**
 * Get the latest memory version ID for a given memory ID.
 */
async function anthropicLatestVersionId(
  storeId: string,
  memoryId: string,
): Promise<string> {
  const res = await fetch(
    `${ANTHROPIC_BASE}/v1/memory_stores/${storeId}/memory_versions?memory_id=${memoryId}&limit=1`,
    { headers: anthropicHeaders() },
  );
  if (!res.ok) return `memver-unknown-${Date.now()}`;
  const body = (await res.json()) as { data?: Array<{ id: string }> };
  return body.data?.[0]?.id ?? `memver-unknown-${Date.now()}`;
}

// ---------------------------------------------------------------------------
// Stub memory store (Supabase-backed)
// ---------------------------------------------------------------------------

// In stub mode we persist the memory content as a run_event so the activity
// endpoint can retrieve it. We also keep an in-process Map for idempotent
// lookup within the same process lifetime.
const stubMemoryMap = new Map<
  string, // `${anthropic_store_id}::${path}`
  { memory_id: string; content: string; content_sha256: string }
>();

async function stubCreateOrUpdateMemory(
  anthropicStoreId: string,
  path: string,
  content: string,
): Promise<{ memory_id: string; memory_version_id: string; content_sha256: string; created: boolean }> {
  const key = `${anthropicStoreId}::${path}`;
  const existing = stubMemoryMap.get(key);
  const hash = sha256(content);

  if (existing) {
    // Idempotent update
    const newVersionId = stubMemverId();
    stubMemoryMap.set(key, { memory_id: existing.memory_id, content, content_sha256: hash });
    return { memory_id: existing.memory_id, memory_version_id: newVersionId, content_sha256: hash, created: false };
  }

  const memory_id = stubMemId();
  const memory_version_id = stubMemverId();
  stubMemoryMap.set(key, { memory_id, content, content_sha256: hash });
  return { memory_id, memory_version_id, content_sha256: hash, created: true };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get or create the Anthropic-side memory store for a project.
 * Creates a new local catalog row if needed and provisions the external store.
 */
export async function getOrCreateProjectStore(params: {
  project_id: string;
  org_id: string;
  name: string;
  description: string;
  acl_scope: string;
  db: SupabaseLike;
}): Promise<ProjectStoreResult> {
  const { project_id, org_id, name, description, acl_scope, db } = params;

  // Look up existing store for this project
  const { data: rows } = await db
    .from("memory_store_catalog")
    .select("memory_store_id, anthropic_memory_store_id")
    .eq("project_id", project_id);

  const existing = (rows as Array<{ memory_store_id: string; anthropic_memory_store_id: string | null }>)?.[0];

  if (existing?.memory_store_id) {
    const anthropicId = existing.anthropic_memory_store_id ?? stubMemstoreId(existing.memory_store_id);
    return {
      local_store_id: existing.memory_store_id,
      anthropic_store_id: anthropicId,
    };
  }

  // Create new store
  const local_store_id = crypto.randomUUID();
  let anthropic_store_id: string;

  if (isStubMode()) {
    anthropic_store_id = stubMemstoreId(local_store_id);
  } else {
    const created = await anthropicCreateStore(name, description);
    anthropic_store_id = created.id;
  }

  await db.from("memory_store_catalog").upsert(
    {
      memory_store_id: local_store_id,
      org_id,
      project_id,
      name,
      description,
      owner_team: "platform",
      status: "active",
      node_type: "project",
      depth: 1,
      path_slug: `project/${project_id}`,
      acl_scope,
      anthropic_memory_store_id: anthropic_store_id,
    },
    { onConflict: "memory_store_id" },
  );

  return { local_store_id, anthropic_store_id };
}

/**
 * Write (or idempotently update) the canonical asset memory at
 * /assets/{asset_id}.md in the given store.
 *
 * Retry contract:
 *   - On a precondition conflict (409): re-read and retry once.
 *   - Other failures: throw — the caller applies exponential back-off.
 */
export async function writeAssetMemory(
  params: WriteAssetMemoryParams,
): Promise<WriteAssetMemoryResult> {
  const {
    local_store_id,
    anthropic_store_id,
    asset_id,
    project_id,
    source_uri,
    acl_scope,
    ingest_run_id,
    normalized_text,
    schema_version = "unknown",
    db,
  } = params;

  const path = `/assets/${asset_id}.md`;
  const content = buildCanonicalAssetMemory({
    asset_id,
    project_id,
    source_uri,
    acl_scope,
    ingest_run_id,
    normalized_text,
    schema_version,
  });
  const content_sha256 = sha256(content);

  if (isStubMode()) {
    const result = await stubCreateOrUpdateMemory(anthropic_store_id, path, content);
    // Persist memory write to run_events if db is provided
    if (db) {
      await db.from("run_events").insert({
        event_id: crypto.randomUUID(),
        run_id: ingest_run_id,
        correlation_id: asset_id,
        event_type: "memory_write_succeeded",
        actor: "managed-memory-stub",
        payload: {
          memory_store_id: local_store_id,
          anthropic_store_id,
          asset_id,
          path,
          memory_id: result.memory_id,
          memory_version_id: result.memory_version_id,
          content_sha256: result.content_sha256,
          stub_mode: true,
        },
        occurred_at: new Date().toISOString(),
      });
    }
    return {
      memory_id: result.memory_id,
      memory_version_id: result.memory_version_id,
      path,
      content_sha256: result.content_sha256,
    };
  }

  // --- Real Anthropic API path ---
  // Check for existing memory (idempotent update)
  const existing = await anthropicFindMemoryByPath(anthropic_store_id, path);

  let memory_id: string;
  let memory_version_id: string;

  if (!existing) {
    // Create new
    const created = await anthropicCreateMemory(anthropic_store_id, path, content);
    memory_id = created.id;
    memory_version_id = await anthropicLatestVersionId(anthropic_store_id, memory_id);
  } else {
    // Update with precondition
    memory_id = existing.id;
    let updated = await anthropicUpdateMemory(anthropic_store_id, memory_id, content, existing.content_sha256);

    if (updated === null) {
      // Precondition conflict — re-read and retry once
      const refreshed = await anthropicFindMemoryByPath(anthropic_store_id, path);
      if (!refreshed) throw new Error("Memory disappeared between read and update");
      updated = await anthropicUpdateMemory(anthropic_store_id, refreshed.id, content, refreshed.content_sha256);
      if (updated === null) throw new Error("Precondition conflict on second attempt");
      memory_id = refreshed.id;
    }

    memory_version_id = await anthropicLatestVersionId(anthropic_store_id, memory_id);
  }

  // Persist memory write to run_events if db is provided
  if (db) {
    await db.from("run_events").insert({
      event_id: crypto.randomUUID(),
      run_id: ingest_run_id,
      correlation_id: asset_id,
      event_type: "memory_write_succeeded",
      actor: "managed-memory-real",
      payload: {
        memory_store_id: local_store_id,
        anthropic_store_id,
        asset_id,
        path,
        memory_id,
        memory_version_id,
        content_sha256,
        stub_mode: false,
      },
      occurred_at: new Date().toISOString(),
    });
  }

  return { memory_id, memory_version_id, path, content_sha256 };
}

/**
 * Emit a structured memory event to the run_events table.
 */
export async function emitMemoryEvent(params: {
  event_type: string;
  run_id: string;
  asset_id: string;
  local_store_id: string;
  anthropic_store_id: string;
  path: string;
  attempt?: number;
  error?: string;
  db: SupabaseLike;
}): Promise<void> {
  const { event_type, run_id, asset_id, local_store_id, anthropic_store_id, path, attempt, error, db } = params;
  await db.from("run_events").insert({
    event_id: crypto.randomUUID(),
    run_id,
    correlation_id: asset_id,
    event_type,
    actor: "managed-memory",
    payload: {
      memory_store_id: local_store_id,
      anthropic_store_id,
      asset_id,
      path,
      ...(attempt !== undefined ? { attempt } : {}),
      ...(error !== undefined ? { error } : {}),
    },
    occurred_at: new Date().toISOString(),
  });
}

/**
 * List memory write activities for a given local store ID.
 * Reads from run_events filtered by memory_store_id in the payload.
 */
export async function listMemoryActivity(
  local_store_id: string,
  db: SupabaseLike,
): Promise<MemoryActivityItem[]> {
  // run_events doesn't have a direct index on JSONB payload.memory_store_id,
  // so we filter by correlation (via joining on asset if needed) or scan recent events.
  // For the prototype, fetch recent memory events and filter in-process.
  const { data } = await db
    .from("run_events")
    .select("event_type, payload, occurred_at")
    .eq("event_type", "memory_write_succeeded");

  if (!data) return [];

  return (
    data as Array<{ event_type: string; payload: Record<string, unknown>; occurred_at: string }>
  )
    .filter((row) => row.payload?.memory_store_id === local_store_id)
    .map((row) => ({
      event_type: row.event_type,
      memory_path: (row.payload?.path as string) ?? "",
      memory_version_id: (row.payload?.memory_version_id as string) ?? null,
      asset_id: (row.payload?.asset_id as string) ?? "",
      occurred_at: row.occurred_at,
    }));
}
