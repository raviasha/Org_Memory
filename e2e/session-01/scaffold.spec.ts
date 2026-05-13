/**
 * Session 01 — scaffold smoke tests
 *
 * These tests validate:
 * 1. The Playwright harness itself executes (meta-test).
 * 2. The test runner can import shared types and validators.
 *
 * Full browser E2E smoke for the UI shell is in Session 3 (depends on
 * the Next.js app running). Here we use the `request` context only so
 * the test suite passes in CI without a running server.
 */

import { test, expect } from "@playwright/test";
import {
  AssetSchema,
  WikiPageSchema,
  OrgMemoryManifestSchema,
} from "../../packages/validators/src/index";

test.describe("Session 01 — harness smoke @session-01", () => {
  test("Playwright harness is operational", () => {
    expect(true).toBe(true);
  });

  test("shared types package is importable", () => {
    // Importing and using the validator at test time confirms the
    // package resolution works in the Playwright context.
    const result = AssetSchema.safeParse({
      asset_id: "00000000-0000-0000-0000-000000000001",
      org_id: "00000000-0000-0000-0000-000000000002",
      project_id: "proj-finance-infra-q3",
      source_type: "document",
      file_path_or_url: "/uploads/test.pdf",
      normalized_text: null,
      optional_binary_ref: null,
      acl_scope: "org:acme",
      ingest_status: "pending",
      content_hash: null,
      ingested_at: "2026-05-13T00:00:00.000Z",
      last_modified_at: "2026-05-13T00:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  test("WikiPageSchema rejects invalid slugs", () => {
    const result = WikiPageSchema.safeParse({
      page_id: "00000000-0000-0000-0000-000000000010",
      slug: "INVALID SLUG WITH SPACES",
      title: "Test",
      page_type: "summary",
      content_md: "",
      source_asset_ids: [],
      acl_scope: "org:acme",
      created_at: "2026-05-13T00:00:00.000Z",
      updated_at: "2026-05-13T00:00:00.000Z",
      shaping_job_id: null,
    });
    expect(result.success).toBe(false);
  });

  test("OrgMemoryManifestSchema rejects empty provider_allowlist", () => {
    const result = OrgMemoryManifestSchema.safeParse({
      identity: {
        manifest_id: "00000000-0000-0000-0000-000000000020",
        org_id: "00000000-0000-0000-0000-000000000002",
        version: "1.0.0",
        created_at: "2026-05-13T00:00:00.000Z",
        updated_at: "2026-05-13T00:00:00.000Z",
        owner_team: "platform",
        schema_version: "v1",
      },
      governance: {
        default_acl_policy: "org:acme",
        data_residency: null,
        retention_policy: null,
        pii_policy: null,
        audit_log_mode: "full",
      },
      sources: [],
      hierarchy: [],
      retrieval_profiles: [],
      model_routing: {
        provider_allowlist: [], // ← invalid: must have at least one
        default_provider: "anthropic",
        fallback_provider: null,
        max_context_tokens: 100000,
        provider_caps: {},
      },
    });
    expect(result.success).toBe(false);
  });
});
