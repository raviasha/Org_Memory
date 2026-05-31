-- ---------------------------------------------------------------------------
-- Session 17 — Incremental indexing and status lifecycle
--
-- Adds:
--   1. freshness_status column on assets — tracks whether an asset is fresh,
--      stale (content changed since last index), or never_indexed.
--   2. indexed_at column on assets — timestamp of last successful index run.
--   3. index_jobs table — queue of requested reindex operations. Records
--      job_id, asset_id, project_id, requested_at, started_at, completed_at,
--      status, delta_detected (boolean), previous_content_hash, error_message.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Add freshness_status and indexed_at to assets
-- ---------------------------------------------------------------------------

ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS freshness_status text NOT NULL DEFAULT 'never_indexed',
  ADD COLUMN IF NOT EXISTS indexed_at       timestamptz;

ALTER TABLE assets
  DROP CONSTRAINT IF EXISTS assets_freshness_status_check;

ALTER TABLE assets
  ADD CONSTRAINT assets_freshness_status_check
    CHECK (freshness_status IN ('fresh', 'stale', 'never_indexed'));

-- Backfill: assets already in 'indexed' status are considered fresh.
UPDATE assets
  SET freshness_status = 'fresh',
      indexed_at       = last_modified_at
  WHERE ingest_status = 'indexed'
    AND freshness_status = 'never_indexed';

CREATE INDEX IF NOT EXISTS assets_freshness_status_idx
  ON assets (freshness_status);

CREATE INDEX IF NOT EXISTS assets_indexed_at_idx
  ON assets (indexed_at);

COMMENT ON COLUMN assets.freshness_status IS
  'Freshness of the indexed representation relative to the source content. '
  'fresh = current; stale = source changed since last index; '
  'never_indexed = no successful index run has completed. '
  'Updated by the incremental indexing pipeline (Session 17).';

COMMENT ON COLUMN assets.indexed_at IS
  'Timestamp of the most recent successful indexing run for this asset. '
  'NULL when freshness_status = never_indexed. Updated by Session 17 pipeline.';

-- ---------------------------------------------------------------------------
-- 2. index_jobs table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS index_jobs (
  job_id                uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  asset_id              uuid        NOT NULL REFERENCES assets (asset_id) ON DELETE CASCADE,
  project_id            text        NOT NULL REFERENCES projects (project_id),
  org_id                uuid        NOT NULL,
  requested_at          timestamptz NOT NULL DEFAULT now(),
  started_at            timestamptz,
  completed_at          timestamptz,
  status                text        NOT NULL DEFAULT 'queued',
  delta_detected        boolean,
  previous_content_hash text,
  new_content_hash      text,
  error_message         text,
  run_id                uuid
);

ALTER TABLE index_jobs
  DROP CONSTRAINT IF EXISTS index_jobs_status_check;

ALTER TABLE index_jobs
  ADD CONSTRAINT index_jobs_status_check
    CHECK (status IN ('queued', 'running', 'completed', 'failed', 'no_change'));

ALTER TABLE index_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated full access" ON index_jobs
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS index_jobs_asset_id_idx    ON index_jobs (asset_id);
CREATE INDEX IF NOT EXISTS index_jobs_project_id_idx  ON index_jobs (project_id);
CREATE INDEX IF NOT EXISTS index_jobs_status_idx      ON index_jobs (status);
CREATE INDEX IF NOT EXISTS index_jobs_requested_at_idx ON index_jobs (requested_at DESC);

COMMENT ON TABLE index_jobs IS
  'Queue of incremental re-indexing requests. Each row represents a requested '
  'or completed re-index operation for a single asset. Status lifecycle: '
  'queued -> running -> completed | failed | no_change. '
  'delta_detected = true when the content_hash changed since the previous index run. '
  'Added in Session 17.';

COMMENT ON COLUMN index_jobs.delta_detected IS
  'true when the new content hash differs from previous_content_hash, '
  'indicating the source asset has changed. NULL until the job runs.';

COMMENT ON COLUMN index_jobs.status IS
  'queued: job waiting to run; running: job in progress; '
  'completed: delta detected and index updated; '
  'no_change: content hash unchanged, no index update needed; '
  'failed: job encountered an error.';

-- ---------------------------------------------------------------------------
-- 3. run_event_type extension for indexing events
--    (add new values to the existing enum via ALTER TYPE)
-- ---------------------------------------------------------------------------

ALTER TYPE run_event_type ADD VALUE IF NOT EXISTS 'index_job_queued';
ALTER TYPE run_event_type ADD VALUE IF NOT EXISTS 'index_job_started';
ALTER TYPE run_event_type ADD VALUE IF NOT EXISTS 'index_job_completed';
ALTER TYPE run_event_type ADD VALUE IF NOT EXISTS 'index_job_no_change';
ALTER TYPE run_event_type ADD VALUE IF NOT EXISTS 'index_job_failed';
ALTER TYPE run_event_type ADD VALUE IF NOT EXISTS 'freshness_status_changed';
