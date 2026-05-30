-- ---------------------------------------------------------------------------
-- Session 10 — Level 0 and Level 1 retrieval plus promotion gate
--
-- Changes:
--   1. Add offline-cached semantic_score to evidence_items.
--      Recomputed only when the backing wiki_pages row is updated.
--      For asset-backed evidence, computed once at insert/refresh time.
--
--   2. Create promotion_audit table.
--      Persists memory_version_id → asset_id mappings for every promotion,
--      satisfying the Session 10 audit requirement.
--
--   3. Trigger fn_invalidate_evidence_semantic_score:
--      When wiki_pages.updated_at changes, set semantic_score = NULL on
--      the linked evidence_item so the next refresh will recompute it.
--
--   4. Function _compute_semantic_score(evidence_id):
--      Offline computation of the semantic richness score (0–1).
--      Formula:
--        base = 0.30 * content_length_factor          (normalised log-scale)
--               + 0.30 * keyword_density_factor        (keyword_hints array length)
--               + 0.25 * source_asset_richness         (number of source assets)
--               + 0.15 * recency_factor                (how recently updated)
--      Clamped to [0, 1].  No embeddings, no LLM calls.
--
--   5. Function refresh_semantic_scores(p_project_id):
--      Batch-refresh semantic_score for all evidence_items where
--      semantic_score IS NULL (newly inserted or invalidated).
--      Optionally scoped to a project.
--
--   6. Backfill semantic scores for all existing evidence_items.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1.  Extend evidence_items
-- ---------------------------------------------------------------------------

ALTER TABLE evidence_items
  ADD COLUMN IF NOT EXISTS semantic_score           float8,
  ADD COLUMN IF NOT EXISTS semantic_score_cached_at timestamptz;

COMMENT ON COLUMN evidence_items.semantic_score IS
  'Offline-cached semantic richness score (0–1).  Computed from content
   length, keyword density, source richness, and recency without any LLM
   call or embedding index.  NULL = needs refresh.  Invalidated automatically
   when the backing wiki_pages row is updated.';

COMMENT ON COLUMN evidence_items.semantic_score_cached_at IS
  'Timestamp when semantic_score was last computed.';

-- ---------------------------------------------------------------------------
-- 2.  promotion_audit table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS promotion_audit (
  promotion_id      uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- The Anthropic memory version ID from the canonical asset memory write
  memory_version_id text        NOT NULL,
  -- The asset this memory version was derived from
  asset_id          uuid        REFERENCES assets(asset_id) ON DELETE SET NULL,
  -- The wiki page created or updated by the promotion
  wiki_page_id      uuid        REFERENCES wiki_pages(page_id) ON DELETE SET NULL,
  project_id        text        NOT NULL,
  acl_scope         text        NOT NULL,
  -- Who triggered the promotion ('operator' | 'task_close' | 'manual')
  triggered_by      text        NOT NULL DEFAULT 'operator',
  run_id            text,
  -- Full provenance snapshot at promotion time
  provenance_json   jsonb       NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE promotion_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated full access" ON promotion_audit
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS promo_audit_asset_id_idx
  ON promotion_audit (asset_id);

CREATE INDEX IF NOT EXISTS promo_audit_wiki_page_id_idx
  ON promotion_audit (wiki_page_id);

CREATE INDEX IF NOT EXISTS promo_audit_memory_version_id_idx
  ON promotion_audit (memory_version_id);

CREATE INDEX IF NOT EXISTS promo_audit_project_id_idx
  ON promotion_audit (project_id);

COMMENT ON TABLE promotion_audit IS
  'Immutable audit record for every memory-derived output promotion.
   Persists memory_version_id → asset_id → wiki_page_id mapping per
   Session 10 requirements.  Created by the promotion gate endpoint.';

-- ---------------------------------------------------------------------------
-- 3.  Trigger: invalidate semantic_score when wiki page content changes
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_invalidate_evidence_semantic_score()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Only invalidate when content_md or updated_at actually changed
  IF NEW.updated_at IS DISTINCT FROM OLD.updated_at THEN
    UPDATE evidence_items
      SET semantic_score           = NULL,
          semantic_score_cached_at = NULL
    WHERE wiki_page_id = NEW.page_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invalidate_evidence_semantic_score ON wiki_pages;
CREATE TRIGGER trg_invalidate_evidence_semantic_score
  AFTER UPDATE OF updated_at ON wiki_pages
  FOR EACH ROW EXECUTE FUNCTION fn_invalidate_evidence_semantic_score();

-- ---------------------------------------------------------------------------
-- 4.  Offline semantic score computation function
--     Pure SQL — no embeddings, no LLM calls.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION _compute_semantic_score(
  p_evidence_id uuid
) RETURNS float8 LANGUAGE sql STABLE AS $$
  WITH ev AS (
    SELECT
      e.wiki_page_id,
      e.asset_id,
      e.keyword_hints,
      e.source_asset_ids,
      e.summary_snippet,
      e.updated_at,
      COALESCE(wp.content_md, a.normalized_text, '') AS full_content
    FROM evidence_items e
    LEFT JOIN wiki_pages wp ON wp.page_id = e.wiki_page_id
    LEFT JOIN assets      a  ON a.asset_id  = e.asset_id
    WHERE e.evidence_id = p_evidence_id
  ),
  factors AS (
    SELECT
      -- Content length factor: log-normalised, saturates at ~5000 chars = 1.0
      LEAST(1.0,
        LN(GREATEST(1, LENGTH(full_content))::float8) /
        LN(5000::float8)
      ) AS content_length_factor,

      -- Keyword density factor: normalised by a ceiling of 20 hints
      LEAST(1.0,
        array_length(keyword_hints, 1)::float8 / 20.0
      ) AS keyword_density_factor,

      -- Source asset richness: normalised by a ceiling of 10 sources
      LEAST(1.0,
        array_length(source_asset_ids, 1)::float8 / 10.0
      ) AS source_richness_factor,

      -- Recency factor: 1.0 if updated within 7 days, decays to 0 at 180 days
      GREATEST(0.0,
        1.0 - (EXTRACT(EPOCH FROM (now() - updated_at)) / 86400.0) / 180.0
      ) AS recency_factor

    FROM ev
  )
  SELECT
    LEAST(1.0, GREATEST(0.0,
      0.30 * content_length_factor
      + 0.30 * keyword_density_factor
      + 0.25 * source_richness_factor
      + 0.15 * recency_factor
    ))
  FROM factors;
$$;

-- ---------------------------------------------------------------------------
-- 5.  Batch refresh function
--     Refreshes all NULL semantic_scores, optionally scoped to a project.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION refresh_semantic_scores(
  p_project_id text DEFAULT NULL
) RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  v_count int := 0;
  v_row   record;
BEGIN
  FOR v_row IN
    SELECT evidence_id
    FROM   evidence_items
    WHERE  semantic_score IS NULL
    AND    (p_project_id IS NULL OR project_id = p_project_id)
  LOOP
    UPDATE evidence_items
      SET  semantic_score           = _compute_semantic_score(v_row.evidence_id),
           semantic_score_cached_at = now()
    WHERE  evidence_id = v_row.evidence_id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6.  Backfill semantic scores for all existing evidence_items
-- ---------------------------------------------------------------------------

SELECT refresh_semantic_scores();
