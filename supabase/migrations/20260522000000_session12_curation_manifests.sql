-- ---------------------------------------------------------------------------
-- Session 12 — Context assembler: curation_manifests table
--
-- Persists the curation manifest produced by the context assembler for every
-- context pack assembly run.  The manifest is the audit record for:
--   - which evidence items were selected
--   - which items were dropped and why (deduplication or budget cap)
--   - token budget usage per level and total
--   - which stores contributed to the pack
-- ---------------------------------------------------------------------------

-- ── curation_manifests ──────────────────────────────────────────────────────

create table if not exists curation_manifests (
  manifest_id         text        primary key,
  task_id             text        references tasks (task_id) on delete set null,
  subtask_id          text        references subtasks (subtask_id) on delete set null,
  run_id              text,
  org_id              uuid        not null,
  project_id          text        references projects (project_id) on delete set null,
  selected_item_ids   text[]      not null default '{}',
  dropped_item_ids    text[]      not null default '{}',
  deduplication_log   jsonb       not null default '[]',
  budget_summary      jsonb       not null,
  store_ids_used      text[]      not null default '{}',
  total_candidates    int         not null default 0,
  context_pack_json   jsonb,
  created_at          timestamptz not null default now()
);

alter table curation_manifests enable row level security;

create policy "authenticated full access" on curation_manifests
  for all
  to authenticated
  using (true)
  with check (true);

-- Indexes for common query patterns
create index if not exists curation_manifests_task_id_idx
  on curation_manifests (task_id);

create index if not exists curation_manifests_subtask_id_idx
  on curation_manifests (subtask_id);

create index if not exists curation_manifests_project_id_idx
  on curation_manifests (project_id);

create index if not exists curation_manifests_run_id_idx
  on curation_manifests (run_id);

create index if not exists curation_manifests_created_at_idx
  on curation_manifests (created_at desc);

-- GIN indexes for array membership queries
create index if not exists curation_manifests_selected_ids_gin
  on curation_manifests using gin (selected_item_ids);

create index if not exists curation_manifests_dropped_ids_gin
  on curation_manifests using gin (dropped_item_ids);
