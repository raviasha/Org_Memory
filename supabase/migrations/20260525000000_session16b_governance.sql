-- ---------------------------------------------------------------------------
-- Session 16b — Governance Track: restricted-best-match and signed-trace
-- ---------------------------------------------------------------------------
-- Adds:
--   1. trace_signature column to run_snapshots — HMAC-SHA256 hex of the
--      canonical payload `{snapshot_id}:{content_hash}:{created_at}`.
--      Enables tamper-evident trace verification during replay.
--   2. escalation_info JSONB column on run_snapshots — captures the
--      restricted-best-match escalation status and reason codes emitted
--      during curation.
-- ---------------------------------------------------------------------------

-- 1. trace_signature — HMAC-SHA256 signed trace for tamper-evident replay
ALTER TABLE run_snapshots
  ADD COLUMN IF NOT EXISTS trace_signature text;

COMMENT ON COLUMN run_snapshots.trace_signature IS
  'HMAC-SHA256 hex of the canonical payload '
  '"snapshot_id:content_hash:created_at". '
  'NULL for rows created before Session 16b. '
  'Used to verify snapshot integrity during replay. '
  'Signing key must be rotated via SNAPSHOT_SIGNING_KEY env var.';

-- 2. escalation_info — restricted-best-match escalation metadata
ALTER TABLE run_snapshots
  ADD COLUMN IF NOT EXISTS escalation_info jsonb;

COMMENT ON COLUMN run_snapshots.escalation_info IS
  'Escalation status object emitted by the restricted-best-match detector '
  'during curation. NULL when no escalation was triggered. '
  'Schema: { escalated, primary_reason_code, reason_codes, description, '
  'avg_confidence, acl_items_present }. Added Session 16b.';

CREATE INDEX IF NOT EXISTS run_snapshots_escalated_idx
  ON run_snapshots ((escalation_info ->> 'primary_reason_code'))
  WHERE escalation_info IS NOT NULL;
