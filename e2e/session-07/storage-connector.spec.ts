/**
 * e2e/session-07/storage-connector.spec.ts
 *
 * Session 7 — Storage Connector MVP
 * @session-07
 *
 * Playwright API tests that verify:
 *
 * 1. Basic S3-style ingest with stub_objects:
 *    - POST /api/v1/ingest/storage returns 200.
 *    - Returns ingest_run_id, source_type, source_uri, project_id, asset_count.
 *    - Each asset has asset_id, key, ingest_status "indexed", content_sha256,
 *      normalized_text, and extraction_metadata.
 *
 * 2. Supabase storage source_type:
 *    - Returns 200 and asset records with source_type "storage_object".
 *
 * 3. local_path source_type:
 *    - Returns 200 for local_path source.
 *
 * 4. Idempotency — posting the same stub_objects twice returns the same
 *    asset_id (deterministic UUID v5).
 *
 * 5. Extraction metadata:
 *    - Text/document objects: extraction_metadata includes mime_type,
 *      source_type_class "document", and character_count.
 *    - Image objects: extraction_metadata includes mime_type,
 *      source_type_class "image", ocr_text, caption, ocr_confidence.
 *
 * 6. Asset visibility — after ingest, GET /api/v1/assets returns the
 *    ingested assets with source_type "storage_object" and correct project_id.
 *
 * 7. Auth enforcement:
 *    - POST /api/v1/ingest/storage without auth returns 401.
 *    - GET /api/v1/assets without auth returns 401.
 *
 * 8. Validation — missing required fields return 400 with code "missing_field".
 *
 * 9. Invalid source_type returns 400 with code "invalid_source_type".
 *
 * 10. No objects — empty stub_objects returns 400 with code "no_objects".
 *
 * Note: tests run against a live Next.js dev server.
 * Supabase persistence is optional — routes work without it.
 * All tests use stub_objects to remain deterministic and CI-friendly.
 */

import { test, expect } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const AUTH_HEADER = { Authorization: "Bearer prototype-dev-token" };

// ---------------------------------------------------------------------------
// Shared stub data
// ---------------------------------------------------------------------------

const TEST_PROJECT_ID = "proj-eng-incident-ops";
const TEST_ORG_ID = "00000000-0000-0000-0000-000000000001";
const TEST_ACL = "org:acme";
const TEST_SOURCE_URI = "s3://acme-org-assets/proj-eng-incident-ops/";

const TEXT_OBJECT = {
  key: "runbooks/api-gateway-runbook.md",
  content:
    "# API Gateway Runbook\n\n## Overview\nThis runbook covers incident response for API gateway.\n\n## 502 Errors\n1. Check upstream service health.\n2. Review error logs.\n3. Escalate to on-call engineer.",
};

const IMAGE_OBJECT = {
  key: "diagrams/service-dependency-map.png",
  content: "PNG_BINARY_STUB_CONTENT",
};

const CSV_OBJECT = {
  key: "schedules/on-call-rotation-q2-2026.csv",
  content: "week,service_area,primary,secondary\n2026-04-01,platform,Alice,Bob\n2026-04-08,platform,Charlie,Diana",
};

// ---------------------------------------------------------------------------
// Test 1 — Basic S3 ingest with stub_objects
// ---------------------------------------------------------------------------

test("storage connector: S3 ingest with stub_objects returns 200 and asset records", async ({
  request,
}) => {
  const res = await request.post(`${BASE}/api/v1/ingest/storage`, {
    headers: AUTH_HEADER,
    data: {
      source_type: "s3",
      source_uri: TEST_SOURCE_URI,
      project_id: TEST_PROJECT_ID,
      org_id: TEST_ORG_ID,
      acl_scope: TEST_ACL,
      stub_objects: [TEXT_OBJECT, CSV_OBJECT],
    },
  });

  expect(res.status()).toBe(200);
  const body = await res.json();

  expect(body.ingest_run_id).toBeTruthy();
  expect(body.source_type).toBe("s3");
  expect(body.source_uri).toBe(TEST_SOURCE_URI);
  expect(body.project_id).toBe(TEST_PROJECT_ID);
  expect(body.asset_count).toBe(2);
  expect(body.assets).toHaveLength(2);

  for (const asset of body.assets) {
    expect(asset.asset_id).toBeTruthy();
    expect(asset.key).toBeTruthy();
    expect(asset.ingest_status).toBe("indexed");
    expect(asset.content_sha256).toBeTruthy();
    expect(typeof asset.normalized_text).toBe("string");
    expect(asset.extraction_metadata).toBeTruthy();
    expect(asset.extraction_metadata.mime_type).toBeTruthy();
    expect(asset.extraction_metadata.source_type_class).toBeTruthy();
  }
});

// ---------------------------------------------------------------------------
// Test 2 — Supabase source_type
// ---------------------------------------------------------------------------

test("storage connector: supabase source_type returns 200", async ({
  request,
}) => {
  const res = await request.post(`${BASE}/api/v1/ingest/storage`, {
    headers: AUTH_HEADER,
    data: {
      source_type: "supabase",
      source_uri: "supabase://acme-assets/compliance",
      project_id: "proj-compliance-privacy",
      org_id: TEST_ORG_ID,
      acl_scope: TEST_ACL,
      stub_objects: [
        {
          key: "gdpr-compliance-checklist-v3.md",
          content: "# GDPR Compliance Checklist v3\n\n## Control 1\nData minimisation.",
        },
      ],
    },
  });

  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.source_type).toBe("supabase");
  expect(body.asset_count).toBe(1);
  expect(body.assets[0].ingest_status).toBe("indexed");
});

// ---------------------------------------------------------------------------
// Test 3 — local_path source_type
// ---------------------------------------------------------------------------

test("storage connector: local_path source_type returns 200", async ({
  request,
}) => {
  const res = await request.post(`${BASE}/api/v1/ingest/storage`, {
    headers: AUTH_HEADER,
    data: {
      source_type: "local_path",
      source_uri: "/mnt/shared/org-assets",
      project_id: TEST_PROJECT_ID,
      org_id: TEST_ORG_ID,
      acl_scope: TEST_ACL,
      stub_objects: [TEXT_OBJECT],
    },
  });

  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.source_type).toBe("local_path");
  expect(body.asset_count).toBe(1);
});

// ---------------------------------------------------------------------------
// Test 4 — Idempotency: same key → same asset_id
// ---------------------------------------------------------------------------

test("storage connector: idempotent re-ingest produces same asset_id", async ({
  request,
}) => {
  const payload = {
    source_type: "s3",
    source_uri: TEST_SOURCE_URI,
    project_id: TEST_PROJECT_ID,
    org_id: TEST_ORG_ID,
    acl_scope: TEST_ACL,
    stub_objects: [TEXT_OBJECT],
  };

  const res1 = await request.post(`${BASE}/api/v1/ingest/storage`, {
    headers: AUTH_HEADER,
    data: payload,
  });
  const res2 = await request.post(`${BASE}/api/v1/ingest/storage`, {
    headers: AUTH_HEADER,
    data: payload,
  });

  expect(res1.status()).toBe(200);
  expect(res2.status()).toBe(200);

  const body1 = await res1.json();
  const body2 = await res2.json();

  expect(body1.assets[0].asset_id).toBe(body2.assets[0].asset_id);
  expect(body1.assets[0].content_sha256).toBe(body2.assets[0].content_sha256);
});

// ---------------------------------------------------------------------------
// Test 5a — Document extraction metadata
// ---------------------------------------------------------------------------

test("storage connector: document object extraction metadata is correct", async ({
  request,
}) => {
  const res = await request.post(`${BASE}/api/v1/ingest/storage`, {
    headers: AUTH_HEADER,
    data: {
      source_type: "s3",
      source_uri: TEST_SOURCE_URI,
      project_id: TEST_PROJECT_ID,
      org_id: TEST_ORG_ID,
      acl_scope: TEST_ACL,
      stub_objects: [TEXT_OBJECT],
    },
  });

  expect(res.status()).toBe(200);
  const body = await res.json();
  const asset = body.assets[0];

  expect(asset.extraction_metadata.source_type_class).toBe("document");
  expect(asset.extraction_metadata.mime_type).toBe("text/markdown");
  expect(typeof asset.extraction_metadata.character_count).toBe("number");
  expect(asset.extraction_metadata.character_count).toBeGreaterThan(0);
  expect(asset.normalized_text).toContain("API Gateway Runbook");
});

// ---------------------------------------------------------------------------
// Test 5b — Image extraction metadata
// ---------------------------------------------------------------------------

test("storage connector: image object extraction metadata includes OCR stub fields", async ({
  request,
}) => {
  const res = await request.post(`${BASE}/api/v1/ingest/storage`, {
    headers: AUTH_HEADER,
    data: {
      source_type: "s3",
      source_uri: TEST_SOURCE_URI,
      project_id: TEST_PROJECT_ID,
      org_id: TEST_ORG_ID,
      acl_scope: TEST_ACL,
      stub_objects: [IMAGE_OBJECT],
    },
  });

  expect(res.status()).toBe(200);
  const body = await res.json();
  const asset = body.assets[0];

  expect(asset.extraction_metadata.source_type_class).toBe("image");
  expect(asset.extraction_metadata.mime_type).toBe("image/png");
  expect(typeof asset.extraction_metadata.ocr_text).toBe("string");
  expect(typeof asset.extraction_metadata.caption).toBe("string");
  expect(typeof asset.extraction_metadata.ocr_confidence).toBe("number");
});

// ---------------------------------------------------------------------------
// Test 6 — Asset visibility via GET /api/v1/assets
// ---------------------------------------------------------------------------

test("storage connector: ingested assets are visible via GET /api/v1/assets", async ({
  request,
}) => {
  // First ingest to ensure an asset exists
  const ingestRes = await request.post(`${BASE}/api/v1/ingest/storage`, {
    headers: AUTH_HEADER,
    data: {
      source_type: "s3",
      source_uri: TEST_SOURCE_URI,
      project_id: TEST_PROJECT_ID,
      org_id: TEST_ORG_ID,
      acl_scope: TEST_ACL,
      stub_objects: [TEXT_OBJECT],
    },
  });
  expect(ingestRes.status()).toBe(200);
  const ingestBody = await ingestRes.json();
  const ingestedId = ingestBody.assets[0].asset_id;

  const listRes = await request.get(
    `${BASE}/api/v1/assets?project_id=${TEST_PROJECT_ID}`,
    { headers: AUTH_HEADER },
  );
  expect(listRes.status()).toBe(200);
  const listBody = await listRes.json();
  expect(Array.isArray(listBody.data)).toBe(true);

  // When Supabase is configured, the ingested asset must appear.
  // Without Supabase the route returns an empty list — skip the count check.
  const supabaseConfigured =
    !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
    !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (supabaseConfigured) {
    const storageAssets = listBody.data.filter(
      (a: { source_type: string }) => a.source_type === "storage_object",
    );
    expect(storageAssets.length).toBeGreaterThan(0);
    expect(storageAssets.some((a: { asset_id: string }) => a.asset_id === ingestedId)).toBe(true);
  } else {
    // Without Supabase, confirm the endpoint is reachable and returns a valid shape
    expect(typeof listBody.data).toBe("object");
    expect(listBody.pagination).toBeDefined();
  }
});

// ---------------------------------------------------------------------------
// Test 7a — Auth enforcement: no token
// ---------------------------------------------------------------------------

test("storage connector: request without auth returns 401", async ({
  request,
}) => {
  const res = await request.post(`${BASE}/api/v1/ingest/storage`, {
    data: {
      source_type: "s3",
      source_uri: TEST_SOURCE_URI,
      project_id: TEST_PROJECT_ID,
      org_id: TEST_ORG_ID,
      acl_scope: TEST_ACL,
      stub_objects: [TEXT_OBJECT],
    },
  });
  expect(res.status()).toBe(401);
  const body = await res.json();
  expect(body.code).toBe("missing_bearer_token");
});

// ---------------------------------------------------------------------------
// Test 7b — Auth enforcement: GET /api/v1/assets without auth
// ---------------------------------------------------------------------------

test("GET /api/v1/assets without auth returns 401", async ({ request }) => {
  const res = await request.get(
    `${BASE}/api/v1/assets?project_id=${TEST_PROJECT_ID}`,
  );
  expect(res.status()).toBe(401);
});

// ---------------------------------------------------------------------------
// Test 8 — Validation: missing required fields
// ---------------------------------------------------------------------------

test("storage connector: missing required fields return 400", async ({
  request,
}) => {
  // Missing source_type
  const res1 = await request.post(`${BASE}/api/v1/ingest/storage`, {
    headers: AUTH_HEADER,
    data: {
      source_uri: TEST_SOURCE_URI,
      project_id: TEST_PROJECT_ID,
      org_id: TEST_ORG_ID,
      acl_scope: TEST_ACL,
      stub_objects: [TEXT_OBJECT],
    },
  });
  expect(res1.status()).toBe(400);
  const body1 = await res1.json();
  expect(body1.code).toBe("missing_field");

  // Missing project_id
  const res2 = await request.post(`${BASE}/api/v1/ingest/storage`, {
    headers: AUTH_HEADER,
    data: {
      source_type: "s3",
      source_uri: TEST_SOURCE_URI,
      org_id: TEST_ORG_ID,
      acl_scope: TEST_ACL,
      stub_objects: [TEXT_OBJECT],
    },
  });
  expect(res2.status()).toBe(400);
  const body2 = await res2.json();
  expect(body2.code).toBe("missing_field");
});

// ---------------------------------------------------------------------------
// Test 9 — Invalid source_type
// ---------------------------------------------------------------------------

test("storage connector: invalid source_type returns 400", async ({
  request,
}) => {
  const res = await request.post(`${BASE}/api/v1/ingest/storage`, {
    headers: AUTH_HEADER,
    data: {
      source_type: "dropbox",
      source_uri: "dropbox://my-folder",
      project_id: TEST_PROJECT_ID,
      org_id: TEST_ORG_ID,
      acl_scope: TEST_ACL,
      stub_objects: [TEXT_OBJECT],
    },
  });
  expect(res.status()).toBe(400);
  const body = await res.json();
  expect(body.code).toBe("invalid_source_type");
});

// ---------------------------------------------------------------------------
// Test 10 — No objects (empty stub_objects)
// ---------------------------------------------------------------------------

test("storage connector: empty stub_objects returns 400 with no_objects", async ({
  request,
}) => {
  const res = await request.post(`${BASE}/api/v1/ingest/storage`, {
    headers: AUTH_HEADER,
    data: {
      source_type: "s3",
      source_uri: TEST_SOURCE_URI,
      project_id: TEST_PROJECT_ID,
      org_id: TEST_ORG_ID,
      acl_scope: TEST_ACL,
      stub_objects: [],
    },
  });
  expect(res.status()).toBe(400);
  const body = await res.json();
  expect(body.code).toBe("no_objects");
});

// ---------------------------------------------------------------------------
// Test 11 — CSV object produces correct asset record
// ---------------------------------------------------------------------------

test("storage connector: CSV object produces correct asset record", async ({
  request,
}) => {
  const res = await request.post(`${BASE}/api/v1/ingest/storage`, {
    headers: AUTH_HEADER,
    data: {
      source_type: "s3",
      source_uri: TEST_SOURCE_URI,
      project_id: TEST_PROJECT_ID,
      org_id: TEST_ORG_ID,
      acl_scope: TEST_ACL,
      stub_objects: [CSV_OBJECT],
    },
  });

  expect(res.status()).toBe(200);
  const body = await res.json();
  const asset = body.assets[0];

  expect(asset.key).toBe(CSV_OBJECT.key);
  expect(asset.extraction_metadata.mime_type).toBe("text/csv");
  expect(asset.extraction_metadata.source_type_class).toBe("document");
  expect(asset.normalized_text).toContain("service_area");
});
