-- ---------------------------------------------------------------------------
-- Session 5b — Document upload, image ingest, and folder upload pipeline
--
-- Adds extraction_metadata to assets so per-file normalization results
-- (OCR text, caption, confidence for images; character_count, mime_type for
-- documents) can be persisted alongside the canonical asset record.
-- ---------------------------------------------------------------------------

ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS extraction_metadata jsonb NOT NULL DEFAULT '{}';

-- ---------------------------------------------------------------------------
-- Comments
-- ---------------------------------------------------------------------------

COMMENT ON COLUMN assets.extraction_metadata IS
  'Source-type-specific extraction data produced during ingest normalization.
   Document shape: { mime_type, character_count, source_format }.
   Image shape: { ocr_text, caption, ocr_confidence, mime_type }.
   Empty object ({}) for assets ingested without normalization (e.g. git stubs).';
