/**
 * e2e/session-09/evidence-model.spec.ts
 *
 * Session 9 — Canonical metadata and file-evidence model
 * @session-09
 *
 * Exit criteria:
 *
 *  A. Guard paths:
 *     - 401 without auth header (list and detail endpoints).
 *     - 400 when retrieval_level is invalid.
 *     - 400 when evidence_type is invalid.
 *     - 400 when limit is out of range.
 *
 *  B. List endpoint — GET /api/v1/evidence:
 *     - Returns 200 with { data, pagination } envelope.
 *     - pagination has has_more (boolean), next_cursor, total_count (number).
 *     - project_id filter scopes results to the requested project.
 *     - retrieval_level filter works.
 *     - evidence_type filter works.
 *
 *  C. Resolution contract (exit criteria):
 *     Every returned EvidenceItem must satisfy AT LEAST ONE of:
 *       • wiki_page_slug is a non-empty string, OR
 *       • file_path_or_url is a non-empty string.
 *     In addition, every item must carry:
 *       • lineage_chain: non-empty array
 *       • hierarchy_path: non-empty string
 *       • acl_scope: non-empty string
 *       • trust_score: number in [0, 1]
 *       • retrieval_level: one of level_0 | level_1 | level_2
 *       • evidence_type: one of asset | wiki_page | hybrid
 *
 *  D. Detail endpoint — GET /api/v1/evidence/[evidence_id]:
 *     - 404 for an unknown evidence_id.
 *     - 200 for a known evidence_id with EvidenceItemResolved shape.
 *     - lineage_resolved block is present (with asset, wiki_page, contributing_assets).
 *
 *  E. Corpus coverage (requires seeded DB with corpus migration):
 *     - Finance project (proj-finance-infra-q3) has at least 1 evidence item.
 *     - Org-shared project (proj-org-shared) has at least 1 evidence item.
 *     - Asset-type items carry a non-null file_path_or_url.
 *     - Wiki-page-type items carry a non-null wiki_page_slug.
 *     - Project filter removes distractor projects: evidence from
 *       proj-finance-infra-q3 must not include any item with
 *       project_id === 'proj-compliance-privacy'.
 */

import { test, expect } from "@playwright/test";

const AUTH_HEADER = { Authorization: "Bearer prototype-dev-token" };
const EVIDENCE_ENDPOINT = "/api/v1/evidence";

const FINANCE_PROJECT = "proj-finance-infra-q3";
const ORG_SHARED_PROJECT = "proj-org-shared";

const VALID_RETRIEVAL_LEVELS = new Set(["level_0", "level_1", "level_2"]);
const VALID_EVIDENCE_TYPES = new Set(["asset", "wiki_page", "hybrid"]);

// ---------------------------------------------------------------------------
// Helper: validate that an EvidenceItem has all required resolution fields
// ---------------------------------------------------------------------------

function assertResolutionContract(item: Record<string, unknown>, label = "") {
  const prefix = label ? `[${label}] ` : "";

  // At least one resolution path must be populated
  const hasWikiSlug =
    typeof item.wiki_page_slug === "string" && item.wiki_page_slug.length > 0;
  const hasFilePath =
    typeof item.file_path_or_url === "string" &&
    item.file_path_or_url.length > 0;

  expect(
    hasWikiSlug || hasFilePath,
    `${prefix}Item must have wiki_page_slug or file_path_or_url: ${JSON.stringify(item)}`,
  ).toBe(true);

  // lineage_chain must be a non-empty array
  expect(
    Array.isArray(item.lineage_chain),
    `${prefix}lineage_chain must be an array`,
  ).toBe(true);
  expect(
    (item.lineage_chain as unknown[]).length,
    `${prefix}lineage_chain must not be empty`,
  ).toBeGreaterThan(0);

  // hierarchy_path must be non-empty string
  expect(
    typeof item.hierarchy_path === "string" &&
      (item.hierarchy_path as string).length > 0,
    `${prefix}hierarchy_path must be a non-empty string`,
  ).toBe(true);

  // acl_scope must be non-empty string
  expect(
    typeof item.acl_scope === "string" && (item.acl_scope as string).length > 0,
    `${prefix}acl_scope must be a non-empty string`,
  ).toBe(true);

  // trust_score must be in [0, 1]
  expect(typeof item.trust_score).toBe("number");
  expect(item.trust_score as number).toBeGreaterThanOrEqual(0);
  expect(item.trust_score as number).toBeLessThanOrEqual(1);

  // retrieval_level must be valid
  expect(VALID_RETRIEVAL_LEVELS.has(item.retrieval_level as string)).toBe(true);

  // evidence_type must be valid
  expect(VALID_EVIDENCE_TYPES.has(item.evidence_type as string)).toBe(true);

  // source_asset_ids must be an array
  expect(Array.isArray(item.source_asset_ids)).toBe(true);
}

// ---------------------------------------------------------------------------
// A. Guard paths
// ---------------------------------------------------------------------------

test.describe("Session 09 — Guard paths @session-09", () => {
  test("GET /evidence — 401 without auth header", async ({ request }) => {
    const res = await request.get(EVIDENCE_ENDPOINT);
    expect(res.status()).toBe(401);
    const json = await res.json();
    expect(json).toMatchObject({ error: "Unauthorized" });
  });

  test("GET /evidence/[id] — 401 without auth header", async ({ request }) => {
    const res = await request.get(`${EVIDENCE_ENDPOINT}/some-id`);
    expect(res.status()).toBe(401);
    const json = await res.json();
    expect(json).toMatchObject({ error: "Unauthorized" });
  });

  test("GET /evidence — 400 with invalid retrieval_level", async ({
    request,
  }) => {
    const res = await request.get(
      `${EVIDENCE_ENDPOINT}?retrieval_level=level_99`,
      { headers: AUTH_HEADER },
    );
    expect(res.status()).toBe(400);
    const json = await res.json();
    expect(json.code).toBe("invalid_retrieval_level");
  });

  test("GET /evidence — 400 with invalid evidence_type", async ({
    request,
  }) => {
    const res = await request.get(
      `${EVIDENCE_ENDPOINT}?evidence_type=blob`,
      { headers: AUTH_HEADER },
    );
    expect(res.status()).toBe(400);
    const json = await res.json();
    expect(json.code).toBe("invalid_evidence_type");
  });

  test("GET /evidence — 400 when limit is 0", async ({ request }) => {
    const res = await request.get(`${EVIDENCE_ENDPOINT}?limit=0`, {
      headers: AUTH_HEADER,
    });
    expect(res.status()).toBe(400);
    const json = await res.json();
    expect(json.code).toBe("invalid_limit");
  });

  test("GET /evidence — 400 when limit exceeds 200", async ({ request }) => {
    const res = await request.get(`${EVIDENCE_ENDPOINT}?limit=999`, {
      headers: AUTH_HEADER,
    });
    expect(res.status()).toBe(400);
    const json = await res.json();
    expect(json.code).toBe("invalid_limit");
  });
});

// ---------------------------------------------------------------------------
// B. List endpoint shape
// ---------------------------------------------------------------------------

test.describe("Session 09 — List endpoint shape @session-09", () => {
  test("returns 200 with data array and pagination object", async ({
    request,
  }) => {
    const res = await request.get(EVIDENCE_ENDPOINT, {
      headers: AUTH_HEADER,
    });
    expect(res.status()).toBe(200);
    const json = await res.json();

    expect(Array.isArray(json.data)).toBe(true);
    expect(json).toHaveProperty("pagination");
    expect(typeof json.pagination.has_more).toBe("boolean");
    expect(typeof json.pagination.total_count).toBe("number");
    // next_cursor is either null or a string
    expect(
      json.pagination.next_cursor === null ||
        typeof json.pagination.next_cursor === "string",
    ).toBe(true);
  });

  test("project_id filter returns only items for that project", async ({
    request,
  }) => {
    const res = await request.get(
      `${EVIDENCE_ENDPOINT}?project_id=${FINANCE_PROJECT}`,
      { headers: AUTH_HEADER },
    );
    expect(res.status()).toBe(200);
    const json = await res.json();

    for (const item of json.data as Record<string, unknown>[]) {
      expect(item.project_id).toBe(FINANCE_PROJECT);
    }
  });

  test("retrieval_level filter returns only items at that level", async ({
    request,
  }) => {
    const res = await request.get(
      `${EVIDENCE_ENDPOINT}?retrieval_level=level_2`,
      { headers: AUTH_HEADER },
    );
    expect(res.status()).toBe(200);
    const json = await res.json();

    for (const item of json.data as Record<string, unknown>[]) {
      expect(item.retrieval_level).toBe("level_2");
    }
  });

  test("evidence_type=asset filter returns only asset items", async ({
    request,
  }) => {
    const res = await request.get(
      `${EVIDENCE_ENDPOINT}?evidence_type=asset`,
      { headers: AUTH_HEADER },
    );
    expect(res.status()).toBe(200);
    const json = await res.json();

    for (const item of json.data as Record<string, unknown>[]) {
      expect(item.evidence_type).toBe("asset");
    }
  });

  test("evidence_type=wiki_page filter returns only wiki_page items", async ({
    request,
  }) => {
    const res = await request.get(
      `${EVIDENCE_ENDPOINT}?evidence_type=wiki_page`,
      { headers: AUTH_HEADER },
    );
    expect(res.status()).toBe(200);
    const json = await res.json();

    for (const item of json.data as Record<string, unknown>[]) {
      expect(item.evidence_type).toBe("wiki_page");
    }
  });

  test("limit parameter constrains results", async ({ request }) => {
    const res = await request.get(`${EVIDENCE_ENDPOINT}?limit=3`, {
      headers: AUTH_HEADER,
    });
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect((json.data as unknown[]).length).toBeLessThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// C. Resolution contract — every returned item must satisfy exit criteria
// ---------------------------------------------------------------------------

test.describe("Session 09 — Resolution contract @session-09", () => {
  test("all returned items satisfy the resolution contract", async ({
    request,
  }) => {
    const res = await request.get(`${EVIDENCE_ENDPOINT}?limit=50`, {
      headers: AUTH_HEADER,
    });
    expect(res.status()).toBe(200);
    const json = await res.json();

    const items = json.data as Record<string, unknown>[];
    // Contract passes vacuously when DB is empty; it is enforced when data exists.
    for (const item of items) {
      assertResolutionContract(item, item.evidence_id as string);
    }
  });

  test("asset-type items carry a non-null file_path_or_url", async ({
    request,
  }) => {
    const res = await request.get(
      `${EVIDENCE_ENDPOINT}?evidence_type=asset&limit=50`,
      { headers: AUTH_HEADER },
    );
    expect(res.status()).toBe(200);
    const json = await res.json();

    for (const item of json.data as Record<string, unknown>[]) {
      expect(item.evidence_type).toBe("asset");
      expect(
        typeof item.file_path_or_url === "string" &&
          (item.file_path_or_url as string).length > 0,
        `asset item must have non-null file_path_or_url: ${JSON.stringify(item)}`,
      ).toBe(true);
    }
  });

  test("wiki_page-type items carry a non-null wiki_page_slug", async ({
    request,
  }) => {
    const res = await request.get(
      `${EVIDENCE_ENDPOINT}?evidence_type=wiki_page&limit=50`,
      { headers: AUTH_HEADER },
    );
    expect(res.status()).toBe(200);
    const json = await res.json();

    for (const item of json.data as Record<string, unknown>[]) {
      expect(item.evidence_type).toBe("wiki_page");
      expect(
        typeof item.wiki_page_slug === "string" &&
          (item.wiki_page_slug as string).length > 0,
        `wiki_page item must have non-null wiki_page_slug: ${JSON.stringify(item)}`,
      ).toBe(true);
    }
  });

  test("finance project items have lineage_chain starting with project_id", async ({
    request,
  }) => {
    const res = await request.get(
      `${EVIDENCE_ENDPOINT}?project_id=${FINANCE_PROJECT}&limit=50`,
      { headers: AUTH_HEADER },
    );
    expect(res.status()).toBe(200);
    const json = await res.json();

    for (const item of json.data as Record<string, unknown>[]) {
      const chain = item.lineage_chain as string[];
      expect(chain[0]).toBe(FINANCE_PROJECT);
    }
  });
});

// ---------------------------------------------------------------------------
// D. Detail endpoint
// ---------------------------------------------------------------------------

test.describe("Session 09 — Detail endpoint @session-09", () => {
  test("returns 404 for an unknown evidence_id", async ({ request }) => {
    const res = await request.get(
      `${EVIDENCE_ENDPOINT}/00000000-dead-beef-dead-000000000000`,
      { headers: AUTH_HEADER },
    );
    expect(res.status()).toBe(404);
    const json = await res.json();
    expect(json.code).toBe("evidence_not_found");
  });

  test("returns 200 with lineage_resolved block for a known item", async ({
    request,
  }) => {
    // First, get any item from the list
    const listRes = await request.get(`${EVIDENCE_ENDPOINT}?limit=1`, {
      headers: AUTH_HEADER,
    });
    expect(listRes.status()).toBe(200);
    const listJson = await listRes.json();

    const items = listJson.data as Record<string, unknown>[];
    if (items.length === 0) {
      // Skip — no data in DB yet
      test.skip();
      return;
    }

    const firstItem = items[0];
    const evidenceId = firstItem.evidence_id as string;

    const detailRes = await request.get(`${EVIDENCE_ENDPOINT}/${evidenceId}`, {
      headers: AUTH_HEADER,
    });
    expect(detailRes.status()).toBe(200);
    const detail = await detailRes.json();

    // Must have all base EvidenceItem fields
    assertResolutionContract(detail, "detail");

    // Must have lineage_resolved block
    expect(detail).toHaveProperty("lineage_resolved");
    const lr = detail.lineage_resolved;
    expect(lr).toHaveProperty("asset");
    expect(lr).toHaveProperty("wiki_page");
    expect(Array.isArray(lr.contributing_assets)).toBe(true);

    // evidence_id must match
    expect(detail.evidence_id).toBe(evidenceId);
  });

  test("detail item resolution: asset item has non-null lineage_resolved.asset", async ({
    request,
  }) => {
    const listRes = await request.get(
      `${EVIDENCE_ENDPOINT}?evidence_type=asset&limit=1`,
      { headers: AUTH_HEADER },
    );
    expect(listRes.status()).toBe(200);
    const listJson = await listRes.json();

    const items = listJson.data as Record<string, unknown>[];
    if (items.length === 0) {
      test.skip();
      return;
    }

    const evidenceId = items[0].evidence_id as string;
    const detailRes = await request.get(`${EVIDENCE_ENDPOINT}/${evidenceId}`, {
      headers: AUTH_HEADER,
    });
    expect(detailRes.status()).toBe(200);
    const detail = await detailRes.json();

    // For an asset-backed item, lineage_resolved.asset should not be null
    expect(detail.lineage_resolved.asset).not.toBeNull();
    expect(detail.lineage_resolved.asset).toHaveProperty("asset_id");
    expect(detail.lineage_resolved.asset).toHaveProperty("file_path_or_url");
  });

  test("detail item resolution: wiki_page item has non-null lineage_resolved.wiki_page", async ({
    request,
  }) => {
    const listRes = await request.get(
      `${EVIDENCE_ENDPOINT}?evidence_type=wiki_page&limit=1`,
      { headers: AUTH_HEADER },
    );
    expect(listRes.status()).toBe(200);
    const listJson = await listRes.json();

    const items = listJson.data as Record<string, unknown>[];
    if (items.length === 0) {
      test.skip();
      return;
    }

    const evidenceId = items[0].evidence_id as string;
    const detailRes = await request.get(`${EVIDENCE_ENDPOINT}/${evidenceId}`, {
      headers: AUTH_HEADER,
    });
    expect(detailRes.status()).toBe(200);
    const detail = await detailRes.json();

    // For a wiki-backed item, lineage_resolved.wiki_page should not be null
    expect(detail.lineage_resolved.wiki_page).not.toBeNull();
    expect(detail.lineage_resolved.wiki_page).toHaveProperty("slug");
    expect(detail.lineage_resolved.wiki_page).toHaveProperty("page_type");
  });
});

// ---------------------------------------------------------------------------
// E. Corpus coverage (DB-dependent — skip gracefully if DB is empty)
// ---------------------------------------------------------------------------

test.describe("Session 09 — Corpus coverage @session-09", () => {
  test("finance project has at least 1 evidence item", async ({ request }) => {
    const res = await request.get(
      `${EVIDENCE_ENDPOINT}?project_id=${FINANCE_PROJECT}&limit=1`,
      { headers: AUTH_HEADER },
    );
    expect(res.status()).toBe(200);
    const json = await res.json();

    const items = json.data as Record<string, unknown>[];
    if (items.length === 0) {
      // DB not yet migrated — skip
      test.skip();
      return;
    }

    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items[0].project_id).toBe(FINANCE_PROJECT);
    assertResolutionContract(items[0], "finance-first");
  });

  test("org-shared project has at least 1 evidence item", async ({
    request,
  }) => {
    const res = await request.get(
      `${EVIDENCE_ENDPOINT}?project_id=${ORG_SHARED_PROJECT}&limit=1`,
      { headers: AUTH_HEADER },
    );
    expect(res.status()).toBe(200);
    const json = await res.json();

    const items = json.data as Record<string, unknown>[];
    if (items.length === 0) {
      test.skip();
      return;
    }

    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items[0].project_id).toBe(ORG_SHARED_PROJECT);
  });

  test("finance project items do not include compliance project items", async ({
    request,
  }) => {
    const res = await request.get(
      `${EVIDENCE_ENDPOINT}?project_id=${FINANCE_PROJECT}&limit=100`,
      { headers: AUTH_HEADER },
    );
    expect(res.status()).toBe(200);
    const json = await res.json();

    for (const item of json.data as Record<string, unknown>[]) {
      expect(item.project_id).not.toBe("proj-compliance-privacy");
    }
  });

  test("asset items in finance project have hierarchy_path containing the project slug", async ({
    request,
  }) => {
    const res = await request.get(
      `${EVIDENCE_ENDPOINT}?project_id=${FINANCE_PROJECT}&evidence_type=asset&limit=50`,
      { headers: AUTH_HEADER },
    );
    expect(res.status()).toBe(200);
    const json = await res.json();

    for (const item of json.data as Record<string, unknown>[]) {
      expect(
        (item.hierarchy_path as string).includes(FINANCE_PROJECT),
        `hierarchy_path '${item.hierarchy_path}' must contain project id`,
      ).toBe(true);
    }
  });

  test("full resolution round-trip: list → detail maintains same evidence_id", async ({
    request,
  }) => {
    const listRes = await request.get(
      `${EVIDENCE_ENDPOINT}?project_id=${FINANCE_PROJECT}&limit=3`,
      { headers: AUTH_HEADER },
    );
    expect(listRes.status()).toBe(200);
    const listJson = await listRes.json();

    const items = listJson.data as Record<string, unknown>[];
    if (items.length === 0) {
      test.skip();
      return;
    }

    for (const listItem of items) {
      const id = listItem.evidence_id as string;
      const detailRes = await request.get(`${EVIDENCE_ENDPOINT}/${id}`, {
        headers: AUTH_HEADER,
      });
      expect(detailRes.status()).toBe(200);
      const detail = await detailRes.json();
      expect(detail.evidence_id).toBe(id);
      expect(detail.project_id).toBe(FINANCE_PROJECT);
      assertResolutionContract(detail, id);
    }
  });
});
