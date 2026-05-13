import { z } from "zod";

// ---------------------------------------------------------------------------
// Asset validators
// ---------------------------------------------------------------------------

export const AssetSourceTypeSchema = z.enum([
  "document",
  "image",
  "url_scrape",
  "folder",
  "git_repo",
  "object_store",
]);

export const AssetIngestStatusSchema = z.enum([
  "pending",
  "processing",
  "indexed",
  "failed",
  "deleted",
  "blocked_on_memory_write",
]);

export const AssetSchema = z.object({
  asset_id: z.string().uuid(),
  org_id: z.string().uuid(),
  project_id: z.string().min(1),
  source_type: AssetSourceTypeSchema,
  file_path_or_url: z.string().min(1),
  normalized_text: z.string().nullable(),
  optional_binary_ref: z.string().nullable(),
  acl_scope: z.string().min(1),
  ingest_status: AssetIngestStatusSchema,
  content_hash: z.string().nullable(),
  ingested_at: z.string().datetime(),
  last_modified_at: z.string().datetime(),
});

// ---------------------------------------------------------------------------
// Wiki page validators
// ---------------------------------------------------------------------------

export const WikiPageTypeSchema = z.enum([
  "summary",
  "entity",
  "concept",
  "comparison",
  "synthesis",
  "index",
  "log",
  "store_catalog",
  "lint_report",
]);

export const WikiPageSchema = z.object({
  page_id: z.string().uuid(),
  slug: z.string().min(1).regex(/^[a-z0-9-/]+$/, "slug must be kebab-case"),
  title: z.string().min(1),
  page_type: WikiPageTypeSchema,
  content_md: z.string(),
  source_asset_ids: z.array(z.string()),
  acl_scope: z.string().min(1),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  shaping_job_id: z.string().nullable(),
});

// ---------------------------------------------------------------------------
// Org memory manifest validators
// ---------------------------------------------------------------------------

export const ManifestIdentitySchema = z.object({
  manifest_id: z.string().uuid(),
  org_id: z.string().uuid(),
  version: z.string().min(1),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  owner_team: z.string().min(1),
  schema_version: z.string().min(1),
});

export const ManifestGovernanceSchema = z.object({
  default_acl_policy: z.string().min(1),
  data_residency: z.string().nullable(),
  retention_policy: z.string().nullable(),
  pii_policy: z.string().nullable(),
  audit_log_mode: z.enum(["full", "summary", "off"]),
});

export const ManifestSourceEntrySchema = z.object({
  source_id: z.string().uuid(),
  source_type: AssetSourceTypeSchema,
  connector: z.string().min(1),
  location_uri: z.string().min(1),
  include_patterns: z.array(z.string()),
  exclude_patterns: z.array(z.string()),
  polling_or_webhook_mode: z.enum(["polling", "webhook", "manual"]),
  freshness_sla_minutes: z.number().int().positive(),
  trust_score: z.number().min(0).max(1),
});

export const ManifestHierarchyNodeSchema = z.object({
  hierarchy_node_id: z.string().uuid(),
  parent_node_id: z.string().nullable(),
  node_type: z.enum(["org", "domain", "system", "project"]),
  canonical_name: z.string().min(1),
  aliases: z.array(z.string()),
  objective_tags: z.array(z.string()),
});

export const ManifestRetrievalProfileSchema = z.object({
  profile_id: z.string().uuid(),
  task_class: z.string().min(1),
  level_0_budget_tokens: z.number().int().positive(),
  level_1_budget_tokens: z.number().int().positive(),
  level_2_budget_tokens: z.number().int().positive(),
  rerank_policy: z.string().min(1),
  recency_weight: z.number().min(0).max(1),
  authority_weight: z.number().min(0).max(1),
  specificity_requirement: z.boolean(),
});

export const ManifestModelRoutingSchema = z.object({
  provider_allowlist: z.array(z.string()).min(1),
  default_provider: z.string().min(1),
  fallback_provider: z.string().nullable(),
  max_context_tokens: z.number().int().positive(),
  provider_caps: z.record(z.number()),
});

export const OrgMemoryManifestSchema = z.object({
  identity: ManifestIdentitySchema,
  governance: ManifestGovernanceSchema,
  sources: z.array(ManifestSourceEntrySchema),
  hierarchy: z.array(ManifestHierarchyNodeSchema),
  retrieval_profiles: z.array(ManifestRetrievalProfileSchema),
  model_routing: ManifestModelRoutingSchema,
});

// ---------------------------------------------------------------------------
// Eval case validator
// ---------------------------------------------------------------------------

export const EvalCaseSchema = z.object({
  task_id: z.string().min(1),
  project_id: z.string().min(1),
  task_text: z.string().min(1),
  required_asset_ids: z.array(z.string()),
  relevant_asset_ids: z.array(z.string()),
  distractor_asset_ids: z.array(z.string()),
  cross_project_stores: z.array(z.string()),
  task_class: z.string().min(1),
  specificity_requirement: z.boolean(),
});

// Re-export types for convenience
export type {
  Asset,
  WikiPage,
  OrgMemoryManifest,
  EvalCase,
  ContextItem,
  RunEvent,
  Project,
  MemoryStoreCatalogEntry,
} from "@org-memory/types";
