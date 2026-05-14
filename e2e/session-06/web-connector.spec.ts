/**
 * e2e/session-06/web-connector.spec.ts
 *
 * Session 6 — Web/wiki URL connector MVP
 * @session-06
 *
 * Playwright API tests that verify:
 *
 * 1. URL ingest with stub_content (HTML) — POST /api/v1/ingest/url:
 *    - Returns 200 with ingest_run_id, asset_id, content_sha256.
 *    - source_type = "url".
 *    - normalized_text is non-empty and HTML tags are stripped.
 *    - extraction_metadata includes source_format, character_count,
 *      section_count, sections array, fetched_at, page_last_modified,
 *      http_status, and content_type.
 *    - asset_slug is derived from the URL when not supplied.
 *
 * 2. URL ingest with explicit asset_slug — slug is echoed in the response.
 *
 * 3. ICO guidance URL as corpus anchor — POST /api/v1/ingest/url with
 *    the ico-guidance-legitimate-interests slug and stub HTML content:
 *    - Produces a normalized text asset record assigned to
 *      proj-compliance-privacy.
 *    - asset_slug = "ico-guidance-legitimate-interests".
 *    - Section headings are captured in extraction_metadata.sections.
 *    - content_sha256 is deterministic for the same stub content.
 *
 * 4. Idempotency — POSTing the same URL twice for the same org/project
 *    returns the same asset_id (deterministic UUID v5).
 *
 * 5. Asset visibility — after URL ingest, GET /api/v1/assets returns the
 *    ingested asset with source_type = "url" and correct project_id.
 *
 * 6. Representations endpoint — GET /api/v1/assets/{asset_id}/representations
 *    for a URL-ingested asset returns:
 *    - raw_location (the original URL).
 *    - normalized_text.
 *    - extraction_metadata with section metadata and fetched_at.
 *    - provenance_hash (= content_sha256).
 *    - binary_ref null (URLs have no binary original).
 *
 * 7. Auth enforcement:
 *    - POST /api/v1/ingest/url without auth returns 401.
 *    - GET /api/v1/assets without auth returns 401.
 *
 * 8. Validation — missing required fields return 400.
 *
 * 9. Invalid URL — non-HTTP scheme returns 400 with code "invalid_url".
 *
 * Note: tests run against a live Next.js dev server.
 * Supabase persistence is optional — routes work without it.
 * No live network fetch is performed; all tests use stub_content to remain
 * deterministic and network-independent (suitable for CI).
 */

import { test, expect } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const AUTH_HEADER = { Authorization: "Bearer prototype-dev-token" };

// ---------------------------------------------------------------------------
// Shared stub data
// ---------------------------------------------------------------------------

const ICO_URL =
  "https://ico.org.uk/for-organisations/guide-to-data-protection/guide-to-the-general-data-protection-regulation-gdpr/legitimate-interests/";

const ICO_SLUG = "ico-guidance-legitimate-interests";

const ICO_STUB_HTML = `<!DOCTYPE html>
<html>
<head><title>Legitimate Interests | ICO</title></head>
<body>
<nav><a href="/">Home</a></nav>
<main>
<h1>Legitimate Interests</h1>
<p>Legitimate interests is one of the six lawful bases for processing personal data under UK GDPR Article 6(1)(f).</p>
<h2>What is the legitimate interests basis?</h2>
<p>You can rely on legitimate interests if you can show that the processing is necessary for your purposes, you have considered and balanced your interests against individuals' interests, and you meet the three-part test.</p>
<h2>The three-part test</h2>
<p>To rely on legitimate interests you need to meet the following three conditions:</p>
<ul>
<li>Purpose test: there must be a legitimate interest behind the processing.</li>
<li>Necessity test: the processing must be necessary for that purpose.</li>
<li>Balancing test: the legitimate interest must be balanced against the individual's interests, rights and freedoms.</li>
</ul>
<h2>When can we rely on legitimate interests?</h2>
<p>Legitimate interests is the most flexible lawful basis for processing, but you cannot assume it will always be appropriate. It is not an automatic default option.</p>
<h2>Data retention under legitimate interests</h2>
<p>You must not keep personal data longer than is necessary for your purposes. Review your retention periods regularly and document your decisions.</p>
</main>
<footer><p>ICO | Information Commissioner's Office</p></footer>
</body>
</html>`;

// Simple stub for other tests — minimal valid HTML.
const SIMPLE_STUB_HTML = `<html><head><title>Test</title></head>
<body>
<h1>Main Title</h1>
<p>First paragraph.</p>
<h2>Section One</h2>
<p>Content in section one.</p>
<h2>Section Two</h2>
<p>Content in section two.</p>
</body></html>`;

const TEST_URL = "https://example.com/test-document";
const PROJECT_ID = "proj-compliance-privacy";
const ORG_ID = "00000000-0000-0000-0000-000000000001";
const ACL_SCOPE = "org:acme";

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

async function ingestUrl(
  request: ReturnType<typeof import("@playwright/test").request.newContext> extends Promise<infer T> ? T : never,
  overrides: Record<string, unknown> = {},
) {
  return request.post(`${BASE}/api/v1/ingest/url`, {
    headers: AUTH_HEADER,
    data: {
      url: TEST_URL,
      project_id: PROJECT_ID,
      org_id: ORG_ID,
      acl_scope: ACL_SCOPE,
      stub_content: SIMPLE_STUB_HTML,
      ...overrides,
    },
  });
}

// ---------------------------------------------------------------------------
// Test 1: URL ingest with stub HTML — baseline shape check
// ---------------------------------------------------------------------------

test("URL ingest with stub HTML returns correct shape", async ({ request }) => {
  const res = await ingestUrl(request);
  expect(res.status()).toBe(200);
  const body = await res.json();

  // Required top-level fields
  expect(body).toHaveProperty("ingest_run_id");
  expect(body).toHaveProperty("asset_id");
  expect(body).toHaveProperty("content_sha256");
  expect(body.source_type).toBe("url");
  expect(body.url).toBe(TEST_URL);
  expect(body.project_id).toBe(PROJECT_ID);
  expect(body.ingest_status).toBe("indexed");

  // Normalized text — HTML tags must be stripped, content preserved.
  expect(typeof body.normalized_text).toBe("string");
  expect(body.normalized_text.length).toBeGreaterThan(10);
  expect(body.normalized_text).not.toMatch(/<[a-z]/i); // no HTML tags remaining

  // Extraction metadata shape
  const meta = body.extraction_metadata;
  expect(meta).toHaveProperty("source_format");
  expect(meta.source_format).toBe("html");
  expect(typeof meta.character_count).toBe("number");
  expect(meta.character_count).toBeGreaterThan(0);
  expect(typeof meta.section_count).toBe("number");
  expect(Array.isArray(meta.sections)).toBe(true);
  expect(meta).toHaveProperty("fetched_at");
  expect(meta).toHaveProperty("page_last_modified"); // may be null
  expect(meta).toHaveProperty("http_status"); // null when stub used
  expect(meta).toHaveProperty("content_type");
});

// ---------------------------------------------------------------------------
// Test 2: section headings are captured
// ---------------------------------------------------------------------------

test("URL ingest captures section headings from HTML", async ({ request }) => {
  const res = await ingestUrl(request);
  const body = await res.json();
  const meta = body.extraction_metadata;

  // SIMPLE_STUB_HTML has h1 + two h2 headings.
  expect(meta.section_count).toBeGreaterThanOrEqual(2);
  expect(meta.sections.length).toBe(meta.section_count);

  for (const section of meta.sections) {
    expect(typeof section.title).toBe("string");
    expect(section.title.length).toBeGreaterThan(0);
    expect(typeof section.char_offset).toBe("number");
    expect(section.char_offset).toBeGreaterThanOrEqual(0);
  }
});

// ---------------------------------------------------------------------------
// Test 3: ICO guidance URL — corpus anchor for proj-compliance-privacy
// ---------------------------------------------------------------------------

test("ICO guidance URL ingest produces normalized text record for proj-compliance-privacy", async ({
  request,
}) => {
  const res = await request.post(`${BASE}/api/v1/ingest/url`, {
    headers: AUTH_HEADER,
    data: {
      url: ICO_URL,
      project_id: PROJECT_ID,
      org_id: ORG_ID,
      acl_scope: ACL_SCOPE,
      asset_slug: ICO_SLUG,
      stub_content: ICO_STUB_HTML,
    },
  });

  expect(res.status()).toBe(200);
  const body = await res.json();

  expect(body.source_type).toBe("url");
  expect(body.url).toBe(ICO_URL);
  expect(body.project_id).toBe(PROJECT_ID);
  expect(body.asset_slug).toBe(ICO_SLUG);
  expect(body.ingest_status).toBe("indexed");

  // Normalized text must contain key ICO content phrases.
  expect(body.normalized_text).toContain("Legitimate Interests");
  expect(body.normalized_text).toContain("three-part test");

  // Section metadata must include headings from the ICO stub HTML.
  const sections: Array<{ title: string; char_offset: number }> =
    body.extraction_metadata.sections;
  expect(sections.length).toBeGreaterThanOrEqual(3);
  const titles = sections.map((s) => s.title);
  expect(titles.some((t) => t.toLowerCase().includes("legitimate interests"))).toBe(true);
});

// ---------------------------------------------------------------------------
// Test 4: explicit asset_slug is preserved in response
// ---------------------------------------------------------------------------

test("explicit asset_slug is echoed in the response", async ({ request }) => {
  const slug = "my-custom-slug-for-test";
  const res = await ingestUrl(request, { asset_slug: slug });
  const body = await res.json();
  expect(body.asset_slug).toBe(slug);
});

// ---------------------------------------------------------------------------
// Test 5: asset_slug derived from URL when not supplied
// ---------------------------------------------------------------------------

test("asset_slug is derived from URL when not supplied", async ({ request }) => {
  const res = await ingestUrl(request);
  const body = await res.json();
  expect(typeof body.asset_slug).toBe("string");
  expect(body.asset_slug.length).toBeGreaterThan(0);
  // Should not be a raw URL.
  expect(body.asset_slug).not.toContain("https://");
});

// ---------------------------------------------------------------------------
// Test 6: idempotency — same URL + org + project → same asset_id
// ---------------------------------------------------------------------------

test("same URL ingested twice returns the same asset_id", async ({ request }) => {
  const first = await ingestUrl(request);
  const second = await ingestUrl(request);

  expect(first.status()).toBe(200);
  expect(second.status()).toBe(200);

  const b1 = await first.json();
  const b2 = await second.json();

  expect(b1.asset_id).toBe(b2.asset_id);
  expect(b1.content_sha256).toBe(b2.content_sha256);
});

// ---------------------------------------------------------------------------
// Test 7: asset visibility after ingest via GET /api/v1/assets
// ---------------------------------------------------------------------------

test("ingested URL asset is visible in asset list with correct project assignment", async ({
  request,
}) => {
  // Ingest first so there is at least one URL asset in the project.
  const ingestRes = await ingestUrl(request);
  expect(ingestRes.status()).toBe(200);
  const { asset_id } = await ingestRes.json();

  // List assets filtered to source_type=url and the project.
  const listRes = await request.get(
    `${BASE}/api/v1/assets?project_id=${PROJECT_ID}&source_type=url`,
    { headers: AUTH_HEADER },
  );
  expect(listRes.status()).toBe(200);
  const listBody = await listRes.json();
  expect(Array.isArray(listBody.data)).toBe(true);

  // When Supabase is not configured the list returns empty (correct fallback).
  // When Supabase is configured the ingested asset must appear with correct fields.
  const found = listBody.data.find((a: { asset_id: string }) => a.asset_id === asset_id);
  if (found) {
    expect(found.source_type).toBe("url");
    expect(found.project_id).toBe(PROJECT_ID);
  } else {
    // No Supabase — empty list is the correct fallback; ingest itself still returned 200.
    expect(listBody.data.length).toBe(0);
  }
});

// ---------------------------------------------------------------------------
// Test 8: representations endpoint for URL asset
// ---------------------------------------------------------------------------

test("representations endpoint returns correct shape for URL asset", async ({
  request,
}) => {
  const ingestRes = await ingestUrl(request);
  expect(ingestRes.status()).toBe(200);
  const ingestBody = await ingestRes.json();
  const { asset_id, content_sha256 } = ingestBody;

  const repRes = await request.get(
    `${BASE}/api/v1/assets/${asset_id}/representations`,
    { headers: AUTH_HEADER },
  );

  // When Supabase is not configured the route returns 404 (no in-memory store).
  // Accept both 200 (Supabase available) and 404 (Supabase not configured) —
  // but enforce shape when 200 is returned.
  if (repRes.status() === 200) {
    const body = await repRes.json();

    expect(body.raw_location).toBe(TEST_URL);
    expect(typeof body.normalized_text).toBe("string");
    expect(body.normalized_text.length).toBeGreaterThan(0);
    expect(body.provenance_hash).toBe(content_sha256);
    expect(body.binary_ref).toBeNull(); // URLs have no binary original

    const meta = body.extraction_metadata;
    expect(meta).toHaveProperty("source_format");
    expect(meta).toHaveProperty("character_count");
    expect(meta).toHaveProperty("sections");
    expect(meta).toHaveProperty("fetched_at");
  } else {
    // Supabase not configured — 404 is the correct fallback.
    expect(repRes.status()).toBe(404);
  }
});

// ---------------------------------------------------------------------------
// Test 9: auth enforcement
// ---------------------------------------------------------------------------

test("POST /api/v1/ingest/url without auth returns 401", async ({ request }) => {
  const res = await request.post(`${BASE}/api/v1/ingest/url`, {
    data: {
      url: TEST_URL,
      project_id: PROJECT_ID,
      org_id: ORG_ID,
      acl_scope: ACL_SCOPE,
      stub_content: SIMPLE_STUB_HTML,
    },
  });
  expect(res.status()).toBe(401);
});

test("GET /api/v1/assets without auth returns 401", async ({ request }) => {
  const res = await request.get(`${BASE}/api/v1/assets?project_id=${PROJECT_ID}`);
  expect(res.status()).toBe(401);
});

// ---------------------------------------------------------------------------
// Test 10: missing required fields return 400
// ---------------------------------------------------------------------------

test("missing url field returns 400", async ({ request }) => {
  const res = await request.post(`${BASE}/api/v1/ingest/url`, {
    headers: AUTH_HEADER,
    data: {
      project_id: PROJECT_ID,
      org_id: ORG_ID,
      acl_scope: ACL_SCOPE,
      stub_content: SIMPLE_STUB_HTML,
    },
  });
  expect(res.status()).toBe(400);
  const body = await res.json();
  expect(body.code).toBe("missing_field");
});

test("missing project_id field returns 400", async ({ request }) => {
  const res = await request.post(`${BASE}/api/v1/ingest/url`, {
    headers: AUTH_HEADER,
    data: {
      url: TEST_URL,
      org_id: ORG_ID,
      acl_scope: ACL_SCOPE,
      stub_content: SIMPLE_STUB_HTML,
    },
  });
  expect(res.status()).toBe(400);
  const body = await res.json();
  expect(body.code).toBe("missing_field");
});

// ---------------------------------------------------------------------------
// Test 11: invalid URL scheme returns 400 with code "invalid_url"
// ---------------------------------------------------------------------------

test("non-HTTP URL scheme returns 400 with code invalid_url", async ({ request }) => {
  const res = await request.post(`${BASE}/api/v1/ingest/url`, {
    headers: AUTH_HEADER,
    data: {
      url: "ftp://example.com/file.txt",
      project_id: PROJECT_ID,
      org_id: ORG_ID,
      acl_scope: ACL_SCOPE,
    },
  });
  expect(res.status()).toBe(400);
  const body = await res.json();
  expect(body.code).toBe("invalid_url");
});

test("malformed URL returns 400 with code invalid_url", async ({ request }) => {
  const res = await request.post(`${BASE}/api/v1/ingest/url`, {
    headers: AUTH_HEADER,
    data: {
      url: "not-a-url-at-all",
      project_id: PROJECT_ID,
      org_id: ORG_ID,
      acl_scope: ACL_SCOPE,
    },
  });
  expect(res.status()).toBe(400);
  const body = await res.json();
  expect(body.code).toBe("invalid_url");
});

// ---------------------------------------------------------------------------
// Test 12: plain-text stub_content (non-HTML)
// ---------------------------------------------------------------------------

test("plain-text stub_content is accepted and processed", async ({ request }) => {
  const plainText = `## Introduction

This is a plain text document.

## Section A

Content for section A.

## Section B

Content for section B.
`;

  const res = await request.post(`${BASE}/api/v1/ingest/url`, {
    headers: AUTH_HEADER,
    data: {
      url: "https://example.com/plain-text",
      project_id: PROJECT_ID,
      org_id: ORG_ID,
      acl_scope: ACL_SCOPE,
      stub_content: plainText,
    },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();

  expect(body.source_type).toBe("url");
  expect(body.normalized_text).toContain("plain text document");

  const meta = body.extraction_metadata;
  expect(meta.source_format).toBe("text");
  expect(meta.section_count).toBeGreaterThanOrEqual(2);
});
