-- ---------------------------------------------------------------------------
-- Session 16 — Governance Track: snapshot and audit trail
-- ---------------------------------------------------------------------------
-- Adds:
--   1. content_hash column to run_snapshots — SHA-256 hex digest of the
--      context_pack_json JSONB, computed at insertion time. Enables
--      immutability verification and exact replay.
--   2. subtask_id column to run_snapshots — FK to subtasks so each
--      snapshot is uniquely linked to the subtask curation pass that
--      produced it.
--   3. run_events JSONB column on run_snapshots — a denormalised snapshot
--      of the run event log captured at curation time. Enables full
--      replay without joining run_events table.
-- ---------------------------------------------------------------------------

-- 1. content_hash — SHA-256 hex of context_pack_json at snapshot creation
ALTER TABLE run_snapshots
  ADD COLUMN IF NOT EXISTS content_hash text;

COMMENT ON COLUMN run_snapshots.content_hash IS
  'SHA-256 hex digest of context_pack_json (serialised deterministically). '
  'NULL for rows created before Session 16. Used to verify snapshot immutability.';

-- 2. subtask_id — FK to the subtask whose curation produced this snapshot
ALTER TABLE run_snapshots
  ADD COLUMN IF NOT EXISTS subtask_id text REFERENCES subtasks (subtask_id) ON DELETE SET NULL;

COMMENT ON COLUMN run_snapshots.subtask_id IS
  'Subtask that produced this snapshot. NULL for snapshots created before Session 16.';

CREATE INDEX IF NOT EXISTS run_snapshots_subtask_id_idx
  ON run_snapshots (subtask_id);

-- 3. run_events_snapshot — denormalised copy of run events at curation time
ALTER TABLE run_snapshots
  ADD COLUMN IF NOT EXISTS run_events_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN run_snapshots.run_events_snapshot IS
  'Ordered run event log captured at the time this snapshot was committed. '
  'Enables full replay of the curation pass from snapshot alone.';
