-- ---------------------------------------------------------------------------
-- Session 8b — Project and asset lifecycle columns
--
-- Adds soft-delete audit fields to both projects and assets so the UI can
-- surface deletion provenance (who deleted, when) without data loss.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- projects — add status + soft-delete audit columns
-- ---------------------------------------------------------------------------

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS status      text        NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS deleted_at  timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by  text;

-- Enforce allowed status values without breaking existing data
ALTER TABLE projects
  DROP CONSTRAINT IF EXISTS projects_status_check;

ALTER TABLE projects
  ADD CONSTRAINT projects_status_check CHECK (status IN ('active', 'deleted'));

-- ---------------------------------------------------------------------------
-- assets — add soft-delete audit columns
-- ---------------------------------------------------------------------------

ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS deleted_at  timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by  text;

-- ---------------------------------------------------------------------------
-- Indexes for common audit queries
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS projects_status_idx  ON projects (status);
CREATE INDEX IF NOT EXISTS assets_deleted_at_idx ON assets  (deleted_at) WHERE deleted_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Comments
-- ---------------------------------------------------------------------------

COMMENT ON COLUMN projects.status     IS 'Lifecycle state: active | deleted. Soft-deleted projects remain in the table.';
COMMENT ON COLUMN projects.deleted_at IS 'Timestamp of soft-delete. NULL for active projects.';
COMMENT ON COLUMN projects.deleted_by IS 'Actor (user id or service name) that performed the soft-delete.';

COMMENT ON COLUMN assets.deleted_at   IS 'Timestamp when ingest_status was set to deleted. NULL if not deleted.';
COMMENT ON COLUMN assets.deleted_by   IS 'Actor (user id or service name) that triggered the soft-delete.';
