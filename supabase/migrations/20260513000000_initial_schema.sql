-- ---------------------------------------------------------------------------
-- Session 1c — Initial schema
-- All tables mirror the TypeScript interfaces in packages/types/src/index.ts
-- ---------------------------------------------------------------------------

-- Extensions
create extension if not exists "uuid-ossp";

-- ---------------------------------------------------------------------------
-- Enum types
-- ---------------------------------------------------------------------------

create type asset_source_type as enum (
  'document',
  'image',
  'url_scrape',
  'folder',
  'git_repo',
  'object_store'
);

create type asset_ingest_status as enum (
  'pending',
  'processing',
  'indexed',
  'failed',
  'deleted',
  'blocked_on_memory_write'
);

create type wiki_page_type as enum (
  'summary',
  'entity',
  'concept',
  'comparison',
  'synthesis',
  'index',
  'log',
  'store_catalog',
  'lint_report'
);

create type wiki_ref_type as enum (
  'link',
  'contradiction',
  'staleness_flag',
  'synthesis_source'
);

create type audit_log_mode as enum ('full', 'summary', 'off');

create type retrieval_level as enum ('level_0', 'level_1', 'level_2');

create type user_action as enum ('kept', 'removed', 'manually_added');

create type run_event_type as enum (
  'ingest_started',
  'ingest_step',
  'ingest_completed',
  'ingest_failed',
  'memory_write_started',
  'memory_write_succeeded',
  'memory_write_failed',
  'memory_write_retry',
  'memory_write_exhausted',
  'wiki_update_started',
  'wiki_update_completed',
  'curation_started',
  'curation_completed',
  'execution_started',
  'execution_completed',
  'snapshot_created',
  'promotion_started',
  'promotion_completed'
);

create type memory_store_status as enum ('active', 'inactive', 'archived');

create type hierarchy_node_type as enum ('org', 'domain', 'system', 'project', 'subproject');

create type attach_mode as enum ('read_write', 'read_only');

create type derived_or_raw as enum ('derived', 'raw');

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------

create table projects (
  project_id   text        primary key,
  org_id       uuid        not null,
  name         text        not null,
  description  text,
  owner_team   text,
  acl_scope    text        not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table projects enable row level security;

-- Authenticated users have full access; anon is denied by default (no policy = deny).
-- Fine-grained acl_scope enforcement will be layered in governance sessions.
create policy "authenticated full access" on projects
  for all
  to authenticated
  using (true)
  with check (true);

-- ---------------------------------------------------------------------------
-- assets
-- ---------------------------------------------------------------------------

create table assets (
  asset_id           uuid               primary key default uuid_generate_v4(),
  org_id             uuid               not null,
  project_id         text               not null references projects (project_id),
  source_type        asset_source_type  not null,
  file_path_or_url   text               not null,
  normalized_text    text,
  optional_binary_ref text,
  acl_scope          text               not null,
  ingest_status      asset_ingest_status not null default 'pending',
  content_hash       text,
  ingested_at        timestamptz        not null default now(),
  last_modified_at   timestamptz        not null default now()
);

alter table assets enable row level security;

create policy "authenticated full access" on assets
  for all
  to authenticated
  using (true)
  with check (true);

create index assets_org_id_idx        on assets (org_id);
create index assets_project_id_idx    on assets (project_id);
create index assets_ingest_status_idx on assets (ingest_status);

-- ---------------------------------------------------------------------------
-- wiki_pages
-- ---------------------------------------------------------------------------

create table wiki_pages (
  page_id          uuid           primary key default uuid_generate_v4(),
  slug             text           not null unique,
  title            text           not null,
  page_type        wiki_page_type not null,
  content_md       text           not null default '',
  source_asset_ids text[]         not null default '{}',
  acl_scope        text           not null,
  created_at       timestamptz    not null default now(),
  updated_at       timestamptz    not null default now(),
  shaping_job_id   text
);

alter table wiki_pages enable row level security;

create policy "authenticated full access" on wiki_pages
  for all
  to authenticated
  using (true)
  with check (true);

create index wiki_pages_slug_idx      on wiki_pages (slug);
create index wiki_pages_page_type_idx on wiki_pages (page_type);

-- ---------------------------------------------------------------------------
-- wiki_cross_references
-- ---------------------------------------------------------------------------

create table wiki_cross_references (
  ref_id       uuid          primary key default uuid_generate_v4(),
  from_page_id uuid          not null references wiki_pages (page_id) on delete cascade,
  to_page_id   uuid          not null references wiki_pages (page_id) on delete cascade,
  ref_type     wiki_ref_type not null,
  created_at   timestamptz   not null default now()
);

alter table wiki_cross_references enable row level security;

create policy "authenticated full access" on wiki_cross_references
  for all
  to authenticated
  using (true)
  with check (true);

create index wiki_xref_from_idx on wiki_cross_references (from_page_id);
create index wiki_xref_to_idx   on wiki_cross_references (to_page_id);

-- ---------------------------------------------------------------------------
-- org_memory_manifests
-- Complex nested sections (sources, hierarchy, retrieval_profiles,
-- model_routing) are stored as JSONB to preserve the full structure while
-- keeping the manifest queryable at the identity/governance level.
-- ---------------------------------------------------------------------------

create table org_memory_manifests (
  manifest_id         uuid           primary key default uuid_generate_v4(),
  org_id              uuid           not null,
  version             text           not null,
  owner_team          text           not null,
  schema_version      text           not null,
  -- governance columns (flat for easy querying)
  default_acl_policy  text           not null,
  data_residency      text,
  retention_policy    text,
  pii_policy          text,
  audit_log_mode      audit_log_mode not null default 'full',
  -- nested sections
  sources             jsonb          not null default '[]',
  hierarchy           jsonb          not null default '[]',
  retrieval_profiles  jsonb          not null default '[]',
  model_routing       jsonb          not null,
  created_at          timestamptz    not null default now(),
  updated_at          timestamptz    not null default now()
);

alter table org_memory_manifests enable row level security;

create policy "authenticated full access" on org_memory_manifests
  for all
  to authenticated
  using (true)
  with check (true);

create index manifests_org_id_idx on org_memory_manifests (org_id);

-- ---------------------------------------------------------------------------
-- run_snapshots
-- ---------------------------------------------------------------------------

create table run_snapshots (
  snapshot_id       uuid        primary key default uuid_generate_v4(),
  run_id            text        not null,
  org_id            uuid        not null,
  project_id        text        not null,
  task_id           text        not null,
  context_pack_json jsonb       not null,
  created_at        timestamptz not null default now()
);

alter table run_snapshots enable row level security;

create policy "authenticated full access" on run_snapshots
  for all
  to authenticated
  using (true)
  with check (true);

create index run_snapshots_run_id_idx     on run_snapshots (run_id);
create index run_snapshots_org_id_idx     on run_snapshots (org_id);
create index run_snapshots_project_id_idx on run_snapshots (project_id);

-- ---------------------------------------------------------------------------
-- memory_store_catalog
-- ---------------------------------------------------------------------------

create table memory_store_catalog (
  memory_store_id                    uuid                primary key default uuid_generate_v4(),
  org_id                             uuid                not null,
  project_id                         text                not null,
  name                               text                not null,
  description                        text                not null default '',
  owner_team                         text                not null,
  status                             memory_store_status not null default 'active',
  -- hierarchy
  node_type                          hierarchy_node_type not null,
  parent_node_id                     uuid                references memory_store_catalog (memory_store_id),
  depth                              int                 not null default 0 check (depth >= 0),
  path_slug                          text                not null unique,
  related_store_ids                  uuid[]              not null default '{}',
  -- ACL
  acl_scope                          text                not null,
  allowed_roles                      text[]              not null default '{}',
  data_classification                text                not null default 'internal',
  compliance_tags                    text[]              not null default '{}',
  region_residency                   text,
  -- content signals
  top_topics                         text[]              not null default '{}',
  top_entities                       text[]              not null default '{}',
  supported_task_intents             text[]              not null default '{}',
  source_systems                     text[]              not null default '{}',
  -- freshness and quality
  last_updated_at                    timestamptz         not null default now(),
  staleness_score                    float               not null default 0 check (staleness_score between 0 and 1),
  coverage_score                     float               not null default 0 check (coverage_score between 0 and 1),
  contradiction_risk_score           float               not null default 0 check (contradiction_risk_score between 0 and 1),
  -- operational stats
  memory_count                       int                 not null default 0 check (memory_count >= 0),
  total_bytes                        bigint              not null default 0 check (total_bytes >= 0),
  recent_write_rate_7d               float               not null default 0,
  recent_read_rate_7d                float               not null default 0,
  last_used_at                       timestamptz,
  -- routing priors
  historical_helpfulness_by_intent   jsonb               not null default '{}',
  historical_selection_rate          float               not null default 0 check (historical_selection_rate between 0 and 1),
  historical_override_rate           float               not null default 0 check (historical_override_rate between 0 and 1),
  default_attach_mode                attach_mode         not null default 'read_write',
  attach_priority                    int                 not null default 0
);

alter table memory_store_catalog enable row level security;

create policy "authenticated full access" on memory_store_catalog
  for all
  to authenticated
  using (true)
  with check (true);

create index msc_org_id_idx    on memory_store_catalog (org_id);
create index msc_path_slug_idx on memory_store_catalog (path_slug);
create index msc_status_idx    on memory_store_catalog (status);

-- ---------------------------------------------------------------------------
-- context_items
-- ---------------------------------------------------------------------------

create table context_items (
  context_item_id           uuid            primary key default uuid_generate_v4(),
  source_id                 uuid,
  asset_id                  uuid            references assets (asset_id),
  wiki_page_slug            text            references wiki_pages (slug),
  file_path_or_url          text,
  retrieval_level           retrieval_level not null,
  -- why-loaded
  inclusion_reason          text            not null,
  matched_task_terms        text[]          not null default '{}',
  intent_class              text            not null,
  profile_id_used           text            not null,
  specificity_flag          boolean         not null default false,
  -- ranking
  initial_score             float           not null,
  rerank_score              float           not null,
  score_breakdown           jsonb           not null,
  rank_position             int             not null check (rank_position >= 0),
  -- provenance
  indexed_at                timestamptz     not null,
  last_modified_at          timestamptz     not null,
  lineage_chain             text[]          not null default '{}',
  derived_or_raw            derived_or_raw  not null,
  shaping_job_id            text,
  -- governance
  acl_scope                 text            not null,
  user_entitlement_check    boolean         not null default true,
  policy_filters_applied    text[]          not null default '{}',
  -- budget
  token_estimate            int             not null check (token_estimate >= 0),
  cumulative_tokens_after_add int           not null check (cumulative_tokens_after_add >= 0),
  budget_bucket             retrieval_level not null,
  -- user override
  user_action               user_action,
  override_reason           text,
  override_timestamp        timestamptz,
  -- execution
  selected_for_final_pack   boolean         not null default false,
  provider_sent_to          text,
  prompt_slot               text,
  sent_at                   timestamptz,
  -- quality feedback
  post_run_helpfulness      float           check (post_run_helpfulness between 0 and 1),
  citation_used_in_answer   boolean,
  evaluator_label           text
);

alter table context_items enable row level security;

create policy "authenticated full access" on context_items
  for all
  to authenticated
  using (true)
  with check (true);

create index ci_asset_id_idx           on context_items (asset_id);
create index ci_retrieval_level_idx    on context_items (retrieval_level);
create index ci_selected_idx           on context_items (selected_for_final_pack);

-- ---------------------------------------------------------------------------
-- run_events
-- ---------------------------------------------------------------------------

create table run_events (
  event_id       uuid           primary key default uuid_generate_v4(),
  run_id         text           not null,
  correlation_id text           not null,
  event_type     run_event_type not null,
  actor          text           not null,
  payload        jsonb          not null default '{}',
  occurred_at    timestamptz    not null default now()
);

alter table run_events enable row level security;

create policy "authenticated full access" on run_events
  for all
  to authenticated
  using (true)
  with check (true);

create index run_events_run_id_idx     on run_events (run_id);
create index run_events_event_type_idx on run_events (event_type);
create index run_events_occurred_at_idx on run_events (occurred_at desc);

-- ---------------------------------------------------------------------------
-- updated_at trigger helper (auto-update updated_at on row modification)
-- ---------------------------------------------------------------------------

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger projects_updated_at
  before update on projects
  for each row execute function set_updated_at();

create trigger assets_updated_at
  before update on assets
  for each row execute function set_updated_at();

create trigger wiki_pages_updated_at
  before update on wiki_pages
  for each row execute function set_updated_at();

create trigger manifests_updated_at
  before update on org_memory_manifests
  for each row execute function set_updated_at();
