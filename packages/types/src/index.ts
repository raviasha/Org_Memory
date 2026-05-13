// ---------------------------------------------------------------------------
// Asset types  (Layer 1 — raw sources)
// ---------------------------------------------------------------------------

export type AssetSourceType =
  | "document"
  | "image"
  | "url_scrape"
  | "folder"
  | "git_repo"
  | "object_store";

export type AssetIngestStatus =
  | "pending"
  | "processing"
  | "indexed"
  | "failed"
  | "deleted"
  | "blocked_on_memory_write";

export interface Asset {
  asset_id: string;
  org_id: string;
  project_id: string;
  source_type: AssetSourceType;
  file_path_or_url: string;
  /** Extracted / normalized UTF-8 text used for retrieval and wiki shaping. */
  normalized_text: string | null;
  /** Reference to binary original in Supabase Storage (e.g., bucket path). */
  optional_binary_ref: string | null;
  acl_scope: string;
  ingest_status: AssetIngestStatus;
  /** SHA-256 of the original binary for provenance and replay. */
  content_hash: string | null;
  ingested_at: string; // ISO 8601
  last_modified_at: string; // ISO 8601
}

// ---------------------------------------------------------------------------
// Wiki page types  (Layer 2 — LLM-owned compiled synthesis)
// ---------------------------------------------------------------------------

export type WikiPageType =
  | "summary"
  | "entity"
  | "concept"
  | "comparison"
  | "synthesis"
  | "index"
  | "log"
  | "store_catalog"
  | "lint_report";

export interface WikiPage {
  page_id: string;
  slug: string;
  title: string;
  page_type: WikiPageType;
  content_md: string;
  /** Asset IDs whose content contributed to this page. */
  source_asset_ids: string[];
  acl_scope: string;
  created_at: string;
  updated_at: string;
  shaping_job_id: string | null;
}

export interface WikiCrossReference {
  ref_id: string;
  from_page_id: string;
  to_page_id: string;
  ref_type: "link" | "contradiction" | "staleness_flag" | "synthesis_source";
  created_at: string;
}

// ---------------------------------------------------------------------------
// Project types
// ---------------------------------------------------------------------------

export interface Project {
  project_id: string;
  org_id: string;
  name: string;
  description: string | null;
  owner_team: string | null;
  acl_scope: string;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Org memory manifest
// ---------------------------------------------------------------------------

export interface ManifestIdentity {
  manifest_id: string;
  org_id: string;
  version: string;
  created_at: string;
  updated_at: string;
  owner_team: string;
  schema_version: string;
}

export interface ManifestGovernance {
  default_acl_policy: string;
  data_residency: string | null;
  retention_policy: string | null;
  pii_policy: string | null;
  audit_log_mode: "full" | "summary" | "off";
}

export interface ManifestSourceEntry {
  source_id: string;
  source_type: AssetSourceType;
  connector: string;
  location_uri: string;
  include_patterns: string[];
  exclude_patterns: string[];
  polling_or_webhook_mode: "polling" | "webhook" | "manual";
  freshness_sla_minutes: number;
  trust_score: number; // 0–1
}

export interface ManifestHierarchyNode {
  hierarchy_node_id: string;
  parent_node_id: string | null;
  node_type: "org" | "domain" | "system" | "project";
  canonical_name: string;
  aliases: string[];
  objective_tags: string[];
}

export interface ManifestRetrievalProfile {
  profile_id: string;
  task_class: string;
  level_0_budget_tokens: number;
  level_1_budget_tokens: number;
  level_2_budget_tokens: number;
  rerank_policy: string;
  recency_weight: number;
  authority_weight: number;
  specificity_requirement: boolean;
}

export interface ManifestModelRouting {
  provider_allowlist: string[];
  default_provider: string;
  fallback_provider: string | null;
  max_context_tokens: number;
  provider_caps: Record<string, number>;
}

export interface OrgMemoryManifest {
  identity: ManifestIdentity;
  governance: ManifestGovernance;
  sources: ManifestSourceEntry[];
  hierarchy: ManifestHierarchyNode[];
  retrieval_profiles: ManifestRetrievalProfile[];
  model_routing: ManifestModelRouting;
}

// ---------------------------------------------------------------------------
// Run snapshots
// ---------------------------------------------------------------------------

export interface RunSnapshot {
  snapshot_id: string;
  run_id: string;
  org_id: string;
  project_id: string;
  task_id: string;
  /** Immutable JSON blob of the curated context pack at execution time. */
  context_pack_json: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Context rationale schema
// ---------------------------------------------------------------------------

export type RetrievalLevel = "level_0" | "level_1" | "level_2";
export type UserAction = "kept" | "removed" | "manually_added";

export interface ScoreBreakdown {
  semantic: number;
  keyword: number;
  recency: number;
  authority: number;
  specificity: number;
}

export interface ContextItem {
  context_item_id: string;
  source_id: string | null;
  asset_id: string | null;
  wiki_page_slug: string | null;
  file_path_or_url: string | null;
  retrieval_level: RetrievalLevel;
  // Why-loaded
  inclusion_reason: string;
  matched_task_terms: string[];
  intent_class: string;
  profile_id_used: string;
  specificity_flag: boolean;
  // Ranking
  initial_score: number;
  rerank_score: number;
  score_breakdown: ScoreBreakdown;
  rank_position: number;
  // Provenance
  indexed_at: string;
  last_modified_at: string;
  lineage_chain: string[];
  derived_or_raw: "derived" | "raw";
  shaping_job_id: string | null;
  // Governance
  acl_scope: string;
  user_entitlement_check: boolean;
  policy_filters_applied: string[];
  // Budget
  token_estimate: number;
  cumulative_tokens_after_add: number;
  budget_bucket: RetrievalLevel;
  // User override
  user_action: UserAction | null;
  override_reason: string | null;
  override_timestamp: string | null;
  // Execution
  selected_for_final_pack: boolean;
  provider_sent_to: string | null;
  prompt_slot: string | null;
  sent_at: string | null;
  // Quality feedback
  post_run_helpfulness: number | null;
  citation_used_in_answer: boolean | null;
  evaluator_label: string | null;
}

// ---------------------------------------------------------------------------
// Memory store routing catalog
// ---------------------------------------------------------------------------

export interface MemoryStoreCatalogEntry {
  memory_store_id: string;
  org_id: string;
  project_id: string;
  name: string;
  description: string;
  owner_team: string;
  status: "active" | "inactive" | "archived";
  // Hierarchy
  node_type: "org" | "domain" | "project" | "subproject";
  parent_node_id: string | null;
  depth: number;
  path_slug: string;
  related_store_ids: string[];
  // ACL
  acl_scope: string;
  allowed_roles: string[];
  data_classification: string;
  compliance_tags: string[];
  region_residency: string | null;
  // Content signals
  top_topics: string[];
  top_entities: string[];
  supported_task_intents: string[];
  source_systems: string[];
  // Freshness and quality
  last_updated_at: string;
  staleness_score: number;
  coverage_score: number;
  contradiction_risk_score: number;
  // Operational stats
  memory_count: number;
  total_bytes: number;
  recent_write_rate_7d: number;
  recent_read_rate_7d: number;
  last_used_at: string | null;
  // Routing priors
  historical_helpfulness_by_intent: Record<string, number>;
  historical_selection_rate: number;
  historical_override_rate: number;
  default_attach_mode: "read_write" | "read_only";
  attach_priority: number;
}

// ---------------------------------------------------------------------------
// Structured run events
// ---------------------------------------------------------------------------

export type RunEventType =
  | "ingest_started"
  | "ingest_step"
  | "ingest_completed"
  | "ingest_failed"
  | "memory_write_started"
  | "memory_write_succeeded"
  | "memory_write_failed"
  | "memory_write_retry"
  | "memory_write_exhausted"
  | "wiki_update_started"
  | "wiki_update_completed"
  | "curation_started"
  | "curation_completed"
  | "execution_started"
  | "execution_completed"
  | "snapshot_created"
  | "promotion_started"
  | "promotion_completed";

export interface RunEvent {
  event_id: string;
  run_id: string;
  correlation_id: string;
  event_type: RunEventType;
  actor: string; // service or agent identifier
  payload: Record<string, unknown>;
  occurred_at: string; // ISO 8601
}

// ---------------------------------------------------------------------------
// Eval label schema (synthetic demo corpus)
// ---------------------------------------------------------------------------

export interface EvalCase {
  task_id: string;
  project_id: string;
  task_text: string;
  required_asset_ids: string[];
  relevant_asset_ids: string[];
  distractor_asset_ids: string[];
  cross_project_stores: string[];
  task_class: string;
  specificity_requirement: boolean;
}
