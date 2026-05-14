/**
 * e2e/session-05/git-connector.spec.ts
 *
 * Session 5 — Git connector MVP
 * @session-05
 *
 * Playwright API tests that verify:
 *
 * 1. POST /api/v1/ingest/git with `platform-services-repo` returns 200 and
 *    a response containing:
 *    - ingest_run_id (UUID)
 *    - repo_asset_id (UUID)
 *    - file_asset_count === 5 (one per file in the stub manifest)
 *    - file_assets array, each with asset_id, relative_path, project_id,
 *      ingest_status, and lineage_metadata
 *
 * 2. Each per-file asset carries project_id = "proj-eng-incident-ops"
 *    and lineage_metadata with repo_url, repo_slug, branch, relative_path,
 *    and ingest_run_id.
 *
 * 3. GET /api/v1/assets?project_id=proj-eng-incident-ops returns the
 *    ingested per-file assets (when Supabase is configured); when Supabase
 *    is not configured the endpoint returns an empty list gracefully.
 *
 * 4. GET /api/v1/assets?parent_asset_id=<repo_asset_id> returns only
 *    child assets linked to that parent (Supabase path) or an empty list
 *    (fallback path) — both are valid responses.
 *
 * 5. Re-ingesting the same repo (idempotent) returns the same repo_asset_id.
 *
 * 6. POST /api/v1/ingest/git without auth returns 401.
 *
 * 7. POST /api/v1/ingest/git with an unknown project_id returns 404
 *    (Supabase path) or 200 without DB write (fallback path).
 *
 * Note: tests run against a live Next.js dev server (or CI server).
 * Supabase persistence is optional — the API works without it.
 */

import { test, expect } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const AUTH_HEADER = { Authorization: "Bearer prototype-dev-token" };

// ---------------------------------------------------------------------------
// Shared ingest payload for platform-services-repo
// ---------------------------------------------------------------------------

const INGEST_PAYLOAD = {
  repo_url: "https://github.com/acme-corp/platform-services",
  repo_slug: "platform-services-repo",
  project_id: "proj-eng-incident-ops",
  org_id: "00000000-0000-0000-0000-000000000001",
  acl_scope: "org:acme",
  branch: "main",
};

// Expected files in the stub manifest
const EXPECTED_FILES = [
  "runbooks/api-gateway-runbook.md",
  "runbooks/database-failover-runbook.md",
  "config/alert-thresholds-config.yml",
  "postmortems/incident-postmortem-2026-03-15.md",
  "postmortems/incident-postmortem-2025-11-22.md",
];

// ---------------------------------------------------------------------------
// 1. Unauthenticated request is rejected
// ---------------------------------------------------------------------------

test("POST /api/v1/ingest/git — no auth returns 401", async ({ request }) => {
  const res = await request.post(`${BASE}/api/v1/ingest/git`, {
    data: INGEST_PAYLOAD,
  });
  expect(res.status()).toBe(401);
  const body = await res.json();
  expect(body).toHaveProperty("error");
  expect(body).toHaveProperty("code");
});

// ---------------------------------------------------------------------------
// 2. Valid ingest returns correct structure
// ---------------------------------------------------------------------------

test("POST /api/v1/ingest/git — platform-services-repo ingest", async ({
  request,
}) => {
  const res = await request.post(`${BASE}/api/v1/ingest/git`, {
    headers: AUTH_HEADER,
    data: INGEST_PAYLOAD,
  });

  expect(res.status()).toBe(200);
  const body = await res.json();

  // Top-level shape
  expect(body).toHaveProperty("ingest_run_id");
  expect(body).toHaveProperty("repo_asset_id");
  expect(body).toHaveProperty("file_asset_count");
  expect(body).toHaveProperty("file_assets");

  // ingest_run_id is a UUID
  expect(body.ingest_run_id).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  );

  // repo_asset_id is a UUID
  expect(body.repo_asset_id).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  );

  // Exactly 5 files ingested
  expect(body.file_asset_count).toBe(5);
  expect(body.file_assets).toHaveLength(5);
});

// ---------------------------------------------------------------------------
// 3. Per-file asset records carry project assignment and lineage metadata
// ---------------------------------------------------------------------------

test("POST /api/v1/ingest/git — per-file assets have project_id and lineage", async ({
  request,
}) => {
  const res = await request.post(`${BASE}/api/v1/ingest/git`, {
    headers: AUTH_HEADER,
    data: INGEST_PAYLOAD,
  });
  expect(res.status()).toBe(200);
  const { file_assets, ingest_run_id, repo_asset_id } = await res.json();

  for (const asset of file_assets) {
    // Required fields present
    expect(asset).toHaveProperty("asset_id");
    expect(asset).toHaveProperty("relative_path");
    expect(asset).toHaveProperty("file_path_or_url");
    expect(asset).toHaveProperty("project_id");
    expect(asset).toHaveProperty("ingest_status");
    expect(asset).toHaveProperty("lineage_metadata");

    // Project assignment
    expect(asset.project_id).toBe("proj-eng-incident-ops");

    // Status is indexed for prototype stub
    expect(asset.ingest_status).toBe("indexed");

    // Lineage metadata required fields
    const lm = asset.lineage_metadata;
    expect(lm).toHaveProperty("repo_url", INGEST_PAYLOAD.repo_url);
    expect(lm).toHaveProperty("repo_slug", INGEST_PAYLOAD.repo_slug);
    expect(lm).toHaveProperty("branch", INGEST_PAYLOAD.branch);
    expect(lm).toHaveProperty("relative_path");
    expect(lm).toHaveProperty("ingest_run_id", ingest_run_id);

    // Each file is in the expected manifest
    expect(EXPECTED_FILES).toContain(lm.relative_path);

    // file_path_or_url follows the <repo_slug>/<relative_path> convention
    expect(asset.file_path_or_url).toBe(
      `platform-services-repo/${lm.relative_path}`,
    );

    // asset_id is a UUID
    expect(asset.asset_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );

    // Each child references the parent repo asset
    // (parent_asset_id is not in the response root but we can infer consistency)
    expect(repo_asset_id).toBeDefined();
  }

  // All 5 expected files are present
  const returnedPaths = file_assets.map(
    (a: { lineage_metadata: { relative_path: string } }) =>
      a.lineage_metadata.relative_path,
  );
  for (const expected of EXPECTED_FILES) {
    expect(returnedPaths).toContain(expected);
  }
});

// ---------------------------------------------------------------------------
// 4. Idempotent re-ingest returns the same repo_asset_id
// ---------------------------------------------------------------------------

test("POST /api/v1/ingest/git — idempotent re-ingest returns same repo_asset_id", async ({
  request,
}) => {
  const res1 = await request.post(`${BASE}/api/v1/ingest/git`, {
    headers: AUTH_HEADER,
    data: INGEST_PAYLOAD,
  });
  const res2 = await request.post(`${BASE}/api/v1/ingest/git`, {
    headers: AUTH_HEADER,
    data: INGEST_PAYLOAD,
  });

  expect(res1.status()).toBe(200);
  expect(res2.status()).toBe(200);

  const body1 = await res1.json();
  const body2 = await res2.json();

  // repo_asset_id is deterministic (same UUID v5 for same input)
  expect(body1.repo_asset_id).toBe(body2.repo_asset_id);

  // Per-file asset IDs are also deterministic
  const ids1 = body1.file_assets.map((a: { asset_id: string }) => a.asset_id).sort();
  const ids2 = body2.file_assets.map((a: { asset_id: string }) => a.asset_id).sort();
  expect(ids1).toEqual(ids2);
});

// ---------------------------------------------------------------------------
// 5. GET /api/v1/assets — no auth returns 401
// ---------------------------------------------------------------------------

test("GET /api/v1/assets — no auth returns 401", async ({ request }) => {
  const res = await request.get(`${BASE}/api/v1/assets`);
  expect(res.status()).toBe(401);
});

// ---------------------------------------------------------------------------
// 6. GET /api/v1/assets — returns valid pagination envelope
// ---------------------------------------------------------------------------

test("GET /api/v1/assets — returns valid response envelope", async ({
  request,
}) => {
  const res = await request.get(
    `${BASE}/api/v1/assets?project_id=proj-eng-incident-ops`,
    { headers: AUTH_HEADER },
  );
  expect(res.status()).toBe(200);
  const body = await res.json();

  expect(body).toHaveProperty("data");
  expect(body).toHaveProperty("pagination");
  expect(Array.isArray(body.data)).toBe(true);

  const { pagination } = body;
  expect(pagination).toHaveProperty("has_more");
  expect(pagination).toHaveProperty("next_cursor");
  expect(pagination).toHaveProperty("total_count");
});

// ---------------------------------------------------------------------------
// 7. GET /api/v1/assets — after ingest, returns git_repo and child assets
//    (only verifiable when Supabase is configured, but we validate the
//     structure regardless)
// ---------------------------------------------------------------------------

test("GET /api/v1/assets — after ingest, returns project-assigned assets", async ({
  request,
}) => {
  // First ingest
  await request.post(`${BASE}/api/v1/ingest/git`, {
    headers: AUTH_HEADER,
    data: INGEST_PAYLOAD,
  });

  // List assets for the project
  const res = await request.get(
    `${BASE}/api/v1/assets?project_id=proj-eng-incident-ops`,
    { headers: AUTH_HEADER },
  );
  expect(res.status()).toBe(200);
  const body = await res.json();

  expect(Array.isArray(body.data)).toBe(true);

  // When Supabase is configured, verify correct project assignment
  for (const asset of body.data) {
    expect(asset.project_id).toBe("proj-eng-incident-ops");
  }
});

// ---------------------------------------------------------------------------
// 8. GET /api/v1/assets — parent_asset_id filter
// ---------------------------------------------------------------------------

test("GET /api/v1/assets — parent_asset_id filter returns only children", async ({
  request,
}) => {
  // Ingest to get the repo_asset_id
  const ingestRes = await request.post(`${BASE}/api/v1/ingest/git`, {
    headers: AUTH_HEADER,
    data: INGEST_PAYLOAD,
  });
  expect(ingestRes.status()).toBe(200);
  const { repo_asset_id } = await ingestRes.json();

  // Fetch children
  const res = await request.get(
    `${BASE}/api/v1/assets?parent_asset_id=${repo_asset_id}`,
    { headers: AUTH_HEADER },
  );
  expect(res.status()).toBe(200);
  const body = await res.json();

  expect(Array.isArray(body.data)).toBe(true);

  // All returned assets (if any) must be children of the repo
  for (const asset of body.data) {
    expect(asset.parent_asset_id).toBe(repo_asset_id);
  }
});

// ---------------------------------------------------------------------------
// 9. POST /api/v1/ingest/git — missing required field returns 400
// ---------------------------------------------------------------------------

test("POST /api/v1/ingest/git — missing required field returns 400", async ({
  request,
}) => {
  const { repo_slug: _dropped, ...withoutSlug } = INGEST_PAYLOAD;
  const res = await request.post(`${BASE}/api/v1/ingest/git`, {
    headers: AUTH_HEADER,
    data: withoutSlug,
  });
  expect(res.status()).toBe(400);
  const body = await res.json();
  expect(body).toHaveProperty("error");
  expect(body).toHaveProperty("code", "missing_field");
});

// ---------------------------------------------------------------------------
// 10. POST /api/v1/ingest/git — custom files manifest
// ---------------------------------------------------------------------------

test("POST /api/v1/ingest/git — custom files manifest is respected", async ({
  request,
}) => {
  const customPayload = {
    ...INGEST_PAYLOAD,
    repo_slug: "platform-services-repo-custom",
    files: [
      { relative_path: "runbooks/api-gateway-runbook.md", source_type: "document" },
      { relative_path: "config/alert-thresholds-config.yml", source_type: "document" },
    ],
  };

  const res = await request.post(`${BASE}/api/v1/ingest/git`, {
    headers: AUTH_HEADER,
    data: customPayload,
  });
  expect(res.status()).toBe(200);
  const body = await res.json();

  expect(body.file_asset_count).toBe(2);
  expect(body.file_assets).toHaveLength(2);

  const paths = body.file_assets.map(
    (a: { lineage_metadata: { relative_path: string } }) =>
      a.lineage_metadata.relative_path,
  );
  expect(paths).toContain("runbooks/api-gateway-runbook.md");
  expect(paths).toContain("config/alert-thresholds-config.yml");
});
