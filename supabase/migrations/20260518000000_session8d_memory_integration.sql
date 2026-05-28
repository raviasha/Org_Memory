-- ---------------------------------------------------------------------------
-- Session 8d — Claude Managed Agents memory store integration
--
-- Adds columns to track the external Anthropic memory store ID on each
-- local memory_store_catalog row, and to record the canonical asset memory
-- version ID on each asset so ingest provenance can be audited end-to-end.
-- ---------------------------------------------------------------------------

-- memory_store_catalog: track the Anthropic-side store ID
ALTER TABLE memory_store_catalog
  ADD COLUMN IF NOT EXISTS anthropic_memory_store_id text;

COMMENT ON COLUMN memory_store_catalog.anthropic_memory_store_id IS
  'The memstore_... ID assigned by the Anthropic Managed Agents API when the
   store was created. NULL for stores not yet provisioned externally (e.g. in
   stub mode when ANTHROPIC_API_KEY is not configured).';

-- assets: track the canonical memory version written during ingest
ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS memory_version_id text,
  ADD COLUMN IF NOT EXISTS ingest_run_id     text;

COMMENT ON COLUMN assets.memory_version_id IS
  'The memver_... ID of the canonical asset memory write at
   /assets/{asset_id}.md in the project memory store. NULL until the memory
   write succeeds. Used for memory_version_id → asset_id audit mapping.';

COMMENT ON COLUMN assets.ingest_run_id IS
  'Convenience copy of the ingest run UUID. Duplicates lineage_metadata.ingest_run_id
   for easier indexed querying without JSON extraction.';

CREATE INDEX IF NOT EXISTS assets_ingest_run_id_idx ON assets (ingest_run_id);
CREATE INDEX IF NOT EXISTS msc_anthropic_store_id_idx ON memory_store_catalog (anthropic_memory_store_id);
