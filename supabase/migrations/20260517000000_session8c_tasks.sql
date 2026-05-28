-- ---------------------------------------------------------------------------
-- Session 8c — Task and subtask curation tables
-- ---------------------------------------------------------------------------

-- tasks: one row per POST /v1/tasks/curate call
create table tasks (
  task_id          text        primary key,
  org_id           uuid        not null,
  project_id       text        not null references projects (project_id),
  task_text        text        not null,
  idempotency_key  text        unique,
  status           text        not null default 'ready' check (status in ('pending', 'generating', 'ready', 'failed')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table tasks enable row level security;

create policy "authenticated full access" on tasks
  for all
  to authenticated
  using (true)
  with check (true);

create index tasks_project_id_idx      on tasks (project_id);
create index tasks_idempotency_key_idx on tasks (idempotency_key);

create trigger tasks_updated_at
  before update on tasks
  for each row execute function set_updated_at();

-- subtasks: 2–4 rows per task, each representing a decomposed unit of work
create table subtasks (
  subtask_id        text        primary key,
  task_id           text        not null references tasks (task_id) on delete cascade,
  project_id        text        not null references projects (project_id),
  position          int         not null default 0,
  intent_label      text        not null,
  description       text        not null,
  expected_evidence text[]      not null default '{}',
  store_routing     jsonb       not null default '{}',
  curated_bundle    jsonb,
  snapshot_id       uuid        references run_snapshots (snapshot_id),
  status            text        not null default 'pending' check (status in ('pending', 'curating', 'curated', 'failed')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table subtasks enable row level security;

create policy "authenticated full access" on subtasks
  for all
  to authenticated
  using (true)
  with check (true);

create index subtasks_task_id_idx    on subtasks (task_id);
create index subtasks_project_id_idx on subtasks (project_id);

create trigger subtasks_updated_at
  before update on subtasks
  for each row execute function set_updated_at();
