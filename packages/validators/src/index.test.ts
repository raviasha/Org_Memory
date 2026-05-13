import { describe, it, expect } from "vitest";
import {
  AssetSchema,
  WikiPageSchema,
  OrgMemoryManifestSchema,
  EvalCaseSchema,
} from "./index";

// ---------------------------------------------------------------------------
// AssetSchema
// ---------------------------------------------------------------------------

describe("AssetSchema", () => {
  const validAsset = {
    asset_id: "00000000-0000-0000-0000-000000000001",
    org_id: "00000000-0000-0000-0000-000000000002",
    project_id: "proj-finance-infra-q3",
    source_type: "document" as const,
    file_path_or_url: "/uploads/business-case-q3-fy26.pdf",
    normalized_text: "NPV model...",
    optional_binary_ref: null,
    acl_scope: "org:acme",
    ingest_status: "indexed" as const,
    content_hash: "abc123",
    ingested_at: "2026-05-13T00:00:00.000Z",
    last_modified_at: "2026-05-13T00:00:00.000Z",
  };

  it("accepts a valid asset", () => {
    expect(AssetSchema.safeParse(validAsset).success).toBe(true);
  });

  it("accepts blocked_on_memory_write status", () => {
    const blocked = { ...validAsset, ingest_status: "blocked_on_memory_write" };
    expect(AssetSchema.safeParse(blocked).success).toBe(true);
  });

  it("rejects an unknown ingest_status", () => {
    const bad = { ...validAsset, ingest_status: "magic_status" };
    expect(AssetSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a missing project_id", () => {
    const { project_id: _omit, ...bad } = validAsset as any;
    expect(AssetSchema.safeParse(bad).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// WikiPageSchema
// ---------------------------------------------------------------------------

describe("WikiPageSchema", () => {
  const validPage = {
    page_id: "00000000-0000-0000-0000-000000000010",
    slug: "finance/q3-infrastructure",
    title: "Q3 Infrastructure Investment — Summary",
    page_type: "summary" as const,
    content_md: "# Q3 Infrastructure Investment\n\nSummary content.",
    source_asset_ids: ["infrastructure-investment-business-case-q3-fy26"],
    acl_scope: "org:acme",
    created_at: "2026-05-13T00:00:00.000Z",
    updated_at: "2026-05-13T00:00:00.000Z",
    shaping_job_id: null,
  };

  it("accepts a valid wiki page", () => {
    expect(WikiPageSchema.safeParse(validPage).success).toBe(true);
  });

  it("rejects an invalid slug with uppercase", () => {
    const bad = { ...validPage, slug: "Finance/Q3" };
    expect(WikiPageSchema.safeParse(bad).success).toBe(false);
  });

  it("accepts all page types", () => {
    const types = [
      "summary",
      "entity",
      "concept",
      "comparison",
      "synthesis",
      "index",
      "log",
      "store_catalog",
      "lint_report",
    ] as const;
    for (const page_type of types) {
      expect(WikiPageSchema.safeParse({ ...validPage, page_type }).success).toBe(
        true
      );
    }
  });
});

// ---------------------------------------------------------------------------
// OrgMemoryManifestSchema — smoke test
// ---------------------------------------------------------------------------

describe("OrgMemoryManifestSchema", () => {
  const validManifest = {
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
      audit_log_mode: "full" as const,
    },
    sources: [],
    hierarchy: [],
    retrieval_profiles: [],
    model_routing: {
      provider_allowlist: ["anthropic", "openai"],
      default_provider: "anthropic",
      fallback_provider: null,
      max_context_tokens: 100000,
      provider_caps: { anthropic: 200000, openai: 128000 },
    },
  };

  it("accepts a valid manifest", () => {
    expect(OrgMemoryManifestSchema.safeParse(validManifest).success).toBe(true);
  });

  it("rejects an empty provider_allowlist", () => {
    const bad = {
      ...validManifest,
      model_routing: { ...validManifest.model_routing, provider_allowlist: [] },
    };
    expect(OrgMemoryManifestSchema.safeParse(bad).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// EvalCaseSchema
// ---------------------------------------------------------------------------

describe("EvalCaseSchema", () => {
  const validCase = {
    task_id: "task-001-npv-recommendation",
    project_id: "proj-finance-infra-q3",
    task_text:
      "Calculate the NPV of the Q3 infrastructure investment at the CFO-specified discount rate.",
    required_asset_ids: [
      "infrastructure-investment-business-case-q3-fy26",
      "cfo-q3-guidance",
    ],
    relevant_asset_ids: [
      "board-approval-memo-q2-fy26",
      "infrastructure-depreciation-schedule",
    ],
    distractor_asset_ids: ["office-lease-renewal-2024", "travel-expense-policy"],
    cross_project_stores: [],
    task_class: "financial-analysis",
    specificity_requirement: true,
  };

  it("accepts a valid eval case", () => {
    expect(EvalCaseSchema.safeParse(validCase).success).toBe(true);
  });

  it("rejects a missing task_text", () => {
    const { task_text: _omit, ...bad } = validCase as any;
    expect(EvalCaseSchema.safeParse(bad).success).toBe(false);
  });
});
