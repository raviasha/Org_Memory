-- ---------------------------------------------------------------------------
-- Session 5 — Git connector lineage fields
--
-- Adds parent_asset_id and lineage_metadata to assets so per-file records
-- produced by the git connector (and later folder ingest in Session 5b)
-- can link back to the parent repository asset and carry rich provenance.
-- ---------------------------------------------------------------------------

ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS parent_asset_id uuid REFERENCES assets (asset_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lineage_metadata jsonb NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS assets_parent_asset_id_idx ON assets (parent_asset_id);

-- ---------------------------------------------------------------------------
-- Comments
-- ---------------------------------------------------------------------------

COMMENT ON COLUMN assets.parent_asset_id IS
  'For per-file assets produced by git or folder ingest, references the
   canonical parent repo / folder asset record.';

COMMENT ON COLUMN assets.lineage_metadata IS
  'Provenance bag for ingest-derived assets.
   Git shape: { repo_url, repo_slug, branch, commit_sha, relative_path,
                ingest_run_id }.
   Folder shape: { folder_path, relative_path, ingest_run_id }.
   Empty object ({}) for top-level assets ingested directly.';
