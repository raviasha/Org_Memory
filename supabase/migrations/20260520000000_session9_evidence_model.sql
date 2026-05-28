-- ---------------------------------------------------------------------------
-- Session 9 — Canonical metadata and file-evidence model
--
-- Creates the evidence_items table: a unified view of all retrievable
-- evidence in the system, spanning both raw assets (Layer 1) and LLM-owned
-- wiki pages (Layer 2).
--
-- Each evidence item resolves to:
--   • wiki_page_slug  (when backed by a wiki page)
--   • file_path_or_url (when backed by a raw asset)
--   • both             (hybrid items, e.g. a wiki synthesis page whose
--                       source_asset_ids chains back to specific files)
--
-- Fields carried:
--   identity      — evidence_id, org_id, project_id, evidence_type
--   resolution    — asset_id ↔ file_path_or_url, wiki_page_id ↔ wiki_page_slug
--   content       — title, summary_snippet
--   retrieval     — retrieval_level (level_0 / level_1 / level_2), trust_score,
--                   keyword_hints
--   ACL           — acl_scope
--   hierarchy     — hierarchy_path (e.g. "org:acme/proj-finance-infra-q3")
--   provenance    — lineage_chain, provenance_hash, source_asset_ids
--   timestamps    — created_at, updated_at, last_refreshed_at
--
-- Trigger-based auto-population:
--   • When an asset row is inserted or updated → upsert an evidence_item of
--     type 'asset' via trg_evidence_from_asset.
--   • When a wiki_pages row is inserted or updated → upsert an evidence_item
--     of type 'wiki_page' via trg_evidence_from_wiki_page.
--
-- Backfill at migration time covers all pre-existing rows.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- evidence_type enum
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'evidence_type') THEN
    CREATE TYPE evidence_type AS ENUM ('asset', 'wiki_page', 'hybrid');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- evidence_items table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS evidence_items (
  evidence_id        uuid            PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id             uuid            NOT NULL,
  project_id         text            NOT NULL,
  evidence_type      evidence_type   NOT NULL,

  -- ── Resolution fields (exit criteria) ──────────────────────────────────
  -- At least one of (asset_id, wiki_page_id) must be non-null.
  asset_id           uuid            REFERENCES assets(asset_id) ON DELETE SET NULL,
  wiki_page_id       uuid            REFERENCES wiki_pages(page_id) ON DELETE SET NULL,
  -- Denormalised for fast resolution without a join:
  wiki_page_slug     text,
  file_path_or_url   text,

  -- ── Content metadata ───────────────────────────────────────────────────
  title              text            NOT NULL DEFAULT '',
  -- First ~500 chars of normalized_text (assets) or content_md (wiki pages)
  summary_snippet    text            NOT NULL DEFAULT '',

  -- ── Retrieval classification ───────────────────────────────────────────
  retrieval_level    retrieval_level NOT NULL DEFAULT 'level_1',
  -- 0–1 source-type trust heuristic (higher = more authoritative)
  trust_score        float8          NOT NULL DEFAULT 0.80
                       CHECK (trust_score >= 0 AND trust_score <= 1),
  keyword_hints      text[]          NOT NULL DEFAULT '{}',

  -- ── ACL & governance ───────────────────────────────────────────────────
  acl_scope          text            NOT NULL,

  -- ── Hierarchy & provenance ─────────────────────────────────────────────
  -- e.g. "org:acme/proj-finance-infra-q3"
  hierarchy_path     text            NOT NULL DEFAULT '',
  -- Ordered chain of IDs showing where the evidence came from:
  --   asset evidence:    [project_id, asset_id]
  --   wiki evidence:     [project_id, wiki_page_id, ...source_asset_ids]
  lineage_chain      text[]          NOT NULL DEFAULT '{}',
  -- content_hash from the source asset, or NULL for wiki-only items
  provenance_hash    text,
  -- All asset IDs that contributed content (mirrors wiki_pages.source_asset_ids
  -- for wiki items; contains the single asset_id for asset items)
  source_asset_ids   text[]          NOT NULL DEFAULT '{}',

  -- ── Timestamps ─────────────────────────────────────────────────────────
  created_at         timestamptz     NOT NULL DEFAULT now(),
  updated_at         timestamptz     NOT NULL DEFAULT now(),
  last_refreshed_at  timestamptz     NOT NULL DEFAULT now(),

  -- ── Integrity constraint ───────────────────────────────────────────────
  CONSTRAINT evidence_has_resolution
    CHECK (asset_id IS NOT NULL OR wiki_page_id IS NOT NULL)
);

ALTER TABLE evidence_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated full access" ON evidence_items
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- ── Indexes ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS evidence_items_project_id_idx
  ON evidence_items (project_id);

CREATE INDEX IF NOT EXISTS evidence_items_org_id_idx
  ON evidence_items (org_id);

CREATE INDEX IF NOT EXISTS evidence_items_asset_id_idx
  ON evidence_items (asset_id) WHERE asset_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS evidence_items_wiki_page_id_idx
  ON evidence_items (wiki_page_id) WHERE wiki_page_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS evidence_items_retrieval_level_idx
  ON evidence_items (retrieval_level);

CREATE INDEX IF NOT EXISTS evidence_items_acl_scope_idx
  ON evidence_items (acl_scope);

-- Partial unique constraints so upsert logic can use ON CONFLICT:
CREATE UNIQUE INDEX IF NOT EXISTS evidence_items_unique_asset
  ON evidence_items (asset_id) WHERE asset_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS evidence_items_unique_wiki_page
  ON evidence_items (wiki_page_id) WHERE wiki_page_id IS NOT NULL;

-- ── Table comment ───────────────────────────────────────────────────────────
COMMENT ON TABLE evidence_items IS
  'Unified evidence records spanning raw assets (Layer 1) and wiki pages (Layer 2).
   Created by Session 9. Each row resolves to file_path_or_url and/or wiki_page_slug
   with full ACL, trust, hierarchy, and provenance lineage.
   Auto-populated by trigger functions trg_evidence_from_asset and
   trg_evidence_from_wiki_page.';

-- ---------------------------------------------------------------------------
-- Helper: determine retrieval_level for an asset based on source_type
--   level_0 — org/domain index pages (not applicable for raw assets)
--   level_1 — entity-level knowledge (git repos, storage connectors)
--   level_2 — specific files (documents, images, url_scrape, folder children)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION _evidence_level_for_asset(
  p_source_type text
) RETURNS retrieval_level LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_source_type
    WHEN 'git_repo'      THEN 'level_1'::retrieval_level
    WHEN 'object_store'  THEN 'level_1'::retrieval_level
    WHEN 'folder'        THEN 'level_1'::retrieval_level
    ELSE                      'level_2'::retrieval_level
  END;
$$;

-- Helper: trust_score heuristic per source_type
CREATE OR REPLACE FUNCTION _evidence_trust_for_asset(
  p_source_type text
) RETURNS float8 LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_source_type
    WHEN 'document'      THEN 0.90
    WHEN 'image'         THEN 0.75
    WHEN 'url_scrape'    THEN 0.70
    WHEN 'git_repo'      THEN 0.85
    WHEN 'object_store'  THEN 0.80
    WHEN 'folder'        THEN 0.80
    ELSE                      0.80
  END;
$$;

-- Helper: determine retrieval_level for a wiki page based on page_type
CREATE OR REPLACE FUNCTION _evidence_level_for_wiki(
  p_page_type text
) RETURNS retrieval_level LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_page_type
    WHEN 'index'         THEN 'level_0'::retrieval_level
    WHEN 'log'           THEN 'level_0'::retrieval_level
    WHEN 'summary'       THEN 'level_0'::retrieval_level
    WHEN 'store_catalog' THEN 'level_1'::retrieval_level
    WHEN 'entity'        THEN 'level_1'::retrieval_level
    WHEN 'concept'       THEN 'level_1'::retrieval_level
    WHEN 'comparison'    THEN 'level_1'::retrieval_level
    WHEN 'synthesis'     THEN 'level_1'::retrieval_level
    WHEN 'lint_report'   THEN 'level_0'::retrieval_level
    ELSE                      'level_1'::retrieval_level
  END;
$$;

-- ---------------------------------------------------------------------------
-- Trigger function: upsert evidence_item from an assets row
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_evidence_from_asset()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_snippet       text;
  v_keywords      text[];
  v_level         retrieval_level;
  v_trust         float8;
  v_lineage       text[];
  v_hierarchy     text;
BEGIN
  -- Only index non-deleted assets
  IF NEW.ingest_status = 'deleted' THEN
    DELETE FROM evidence_items WHERE asset_id = NEW.asset_id;
    RETURN NEW;
  END IF;

  -- Compute derived fields
  v_snippet := left(COALESCE(NEW.normalized_text, ''), 500);

  -- Keyword hints: extract the filename stem from file_path_or_url
  v_keywords := ARRAY[
    regexp_replace(
      regexp_replace(NEW.file_path_or_url, '^.*/', ''), -- basename
      '\.[^.]+$', ''                                     -- strip extension
    )
  ];

  v_level     := _evidence_level_for_asset(NEW.source_type::text);
  v_trust     := _evidence_trust_for_asset(NEW.source_type::text);
  v_lineage   := ARRAY[NEW.project_id, NEW.asset_id::text];
  v_hierarchy := COALESCE(NEW.acl_scope, 'org:acme') || '/' || NEW.project_id;

  INSERT INTO evidence_items (
    org_id, project_id, evidence_type,
    asset_id, wiki_page_id, wiki_page_slug, file_path_or_url,
    title, summary_snippet,
    retrieval_level, trust_score, keyword_hints,
    acl_scope, hierarchy_path,
    lineage_chain, provenance_hash, source_asset_ids,
    created_at, updated_at, last_refreshed_at
  ) VALUES (
    NEW.org_id, NEW.project_id, 'asset',
    NEW.asset_id, NULL, NULL, NEW.file_path_or_url,
    -- title: filename stem
    regexp_replace(
      regexp_replace(NEW.file_path_or_url, '^.*/', ''),
      '\.[^.]+$', ''
    ),
    v_snippet,
    v_level, v_trust, v_keywords,
    NEW.acl_scope, v_hierarchy,
    v_lineage, NEW.content_hash, ARRAY[NEW.asset_id::text],
    NEW.ingested_at, NEW.last_modified_at, now()
  )
  ON CONFLICT (asset_id) DO UPDATE SET
    project_id        = EXCLUDED.project_id,
    file_path_or_url  = EXCLUDED.file_path_or_url,
    title             = EXCLUDED.title,
    summary_snippet   = EXCLUDED.summary_snippet,
    retrieval_level   = EXCLUDED.retrieval_level,
    trust_score       = EXCLUDED.trust_score,
    keyword_hints     = EXCLUDED.keyword_hints,
    acl_scope         = EXCLUDED.acl_scope,
    hierarchy_path    = EXCLUDED.hierarchy_path,
    lineage_chain     = EXCLUDED.lineage_chain,
    provenance_hash   = EXCLUDED.provenance_hash,
    source_asset_ids  = EXCLUDED.source_asset_ids,
    updated_at        = now(),
    last_refreshed_at = now();

  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_evidence_from_asset
  AFTER INSERT OR UPDATE ON assets
  FOR EACH ROW EXECUTE FUNCTION fn_evidence_from_asset();

-- ---------------------------------------------------------------------------
-- Trigger function: upsert evidence_item from a wiki_pages row
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_evidence_from_wiki_page()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_snippet    text;
  v_keywords   text[];
  v_level      retrieval_level;
  v_trust      float8;
  v_lineage    text[];
  v_hierarchy  text;
  v_proj_id    text;
BEGIN
  -- Derive project_id from slug (pattern: <project_or_domain>/<rest>)
  -- For special root pages (root/index, root/log) use 'proj-org-shared' as
  -- the project sentinel; for seed examples use the literal project id in
  -- the slug prefix.
  v_proj_id := CASE
    WHEN NEW.slug LIKE 'root/%'        THEN 'proj-org-shared'
    WHEN NEW.slug LIKE 'seed/%'        THEN 'proj-seed-examples'
    WHEN NEW.slug LIKE 'stores/%'      THEN 'proj-org-shared'
    ELSE split_part(NEW.slug, '/', 1)  -- e.g. "proj-finance-infra-q3"
  END;

  v_snippet   := left(COALESCE(NEW.content_md, ''), 500);
  v_keywords  := ARRAY[NEW.slug, NEW.title];
  v_level     := _evidence_level_for_wiki(NEW.page_type::text);
  v_trust     := CASE NEW.page_type::text
                   WHEN 'index'    THEN 0.95
                   WHEN 'log'      THEN 0.90
                   WHEN 'summary'  THEN 0.85
                   ELSE                 0.80
                 END;
  v_lineage   := ARRAY[v_proj_id, NEW.page_id::text] || COALESCE(NEW.source_asset_ids, '{}');
  v_hierarchy := COALESCE(NEW.acl_scope, 'org:acme') || '/' || v_proj_id;

  INSERT INTO evidence_items (
    org_id, project_id, evidence_type,
    asset_id, wiki_page_id, wiki_page_slug, file_path_or_url,
    title, summary_snippet,
    retrieval_level, trust_score, keyword_hints,
    acl_scope, hierarchy_path,
    lineage_chain, provenance_hash, source_asset_ids,
    created_at, updated_at, last_refreshed_at
  ) VALUES (
    -- org_id: use a fixed demo org uuid for wiki pages (no org_id column)
    '00000000-0000-0000-0000-000000000001',
    v_proj_id, 'wiki_page',
    NULL, NEW.page_id, NEW.slug, NULL,
    NEW.title,
    v_snippet,
    v_level, v_trust, v_keywords,
    NEW.acl_scope, v_hierarchy,
    v_lineage, NULL, COALESCE(NEW.source_asset_ids, '{}'),
    NEW.created_at, NEW.updated_at, now()
  )
  ON CONFLICT (wiki_page_id) DO UPDATE SET
    project_id        = EXCLUDED.project_id,
    wiki_page_slug    = EXCLUDED.wiki_page_slug,
    title             = EXCLUDED.title,
    summary_snippet   = EXCLUDED.summary_snippet,
    retrieval_level   = EXCLUDED.retrieval_level,
    trust_score       = EXCLUDED.trust_score,
    keyword_hints     = EXCLUDED.keyword_hints,
    acl_scope         = EXCLUDED.acl_scope,
    hierarchy_path    = EXCLUDED.hierarchy_path,
    lineage_chain     = EXCLUDED.lineage_chain,
    source_asset_ids  = EXCLUDED.source_asset_ids,
    updated_at        = now(),
    last_refreshed_at = now();

  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_evidence_from_wiki_page
  AFTER INSERT OR UPDATE ON wiki_pages
  FOR EACH ROW EXECUTE FUNCTION fn_evidence_from_wiki_page();

-- ---------------------------------------------------------------------------
-- Backfill: populate evidence_items from all existing non-deleted assets
-- ---------------------------------------------------------------------------

INSERT INTO evidence_items (
  org_id, project_id, evidence_type,
  asset_id, wiki_page_id, wiki_page_slug, file_path_or_url,
  title, summary_snippet,
  retrieval_level, trust_score, keyword_hints,
  acl_scope, hierarchy_path,
  lineage_chain, provenance_hash, source_asset_ids,
  created_at, updated_at, last_refreshed_at
)
SELECT
  a.org_id,
  a.project_id,
  'asset'::evidence_type,
  a.asset_id,
  NULL,
  NULL,
  a.file_path_or_url,
  -- title: filename stem
  regexp_replace(
    regexp_replace(a.file_path_or_url, '^.*/', ''),
    '\.[^.]+$', ''
  ),
  -- summary_snippet
  left(COALESCE(a.normalized_text, ''), 500),
  -- retrieval_level
  _evidence_level_for_asset(a.source_type::text),
  -- trust_score
  _evidence_trust_for_asset(a.source_type::text),
  -- keyword_hints
  ARRAY[
    regexp_replace(
      regexp_replace(a.file_path_or_url, '^.*/', ''),
      '\.[^.]+$', ''
    )
  ],
  a.acl_scope,
  -- hierarchy_path
  COALESCE(a.acl_scope, 'org:acme') || '/' || a.project_id,
  -- lineage_chain
  ARRAY[a.project_id, a.asset_id::text],
  a.content_hash,
  -- source_asset_ids
  ARRAY[a.asset_id::text],
  a.ingested_at,
  a.last_modified_at,
  now()
FROM assets a
WHERE a.ingest_status != 'deleted'
ON CONFLICT (asset_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Backfill: populate evidence_items from all existing wiki_pages
-- ---------------------------------------------------------------------------

INSERT INTO evidence_items (
  org_id, project_id, evidence_type,
  asset_id, wiki_page_id, wiki_page_slug, file_path_or_url,
  title, summary_snippet,
  retrieval_level, trust_score, keyword_hints,
  acl_scope, hierarchy_path,
  lineage_chain, provenance_hash, source_asset_ids,
  created_at, updated_at, last_refreshed_at
)
SELECT
  '00000000-0000-0000-0000-000000000001'::uuid,
  CASE
    WHEN wp.slug LIKE 'root/%'    THEN 'proj-org-shared'
    WHEN wp.slug LIKE 'seed/%'    THEN 'proj-seed-examples'
    WHEN wp.slug LIKE 'stores/%'  THEN 'proj-org-shared'
    ELSE split_part(wp.slug, '/', 1)
  END,
  'wiki_page'::evidence_type,
  NULL,
  wp.page_id,
  wp.slug,
  NULL,
  wp.title,
  left(COALESCE(wp.content_md, ''), 500),
  _evidence_level_for_wiki(wp.page_type::text),
  CASE wp.page_type::text
    WHEN 'index'   THEN 0.95
    WHEN 'log'     THEN 0.90
    WHEN 'summary' THEN 0.85
    ELSE                0.80
  END,
  ARRAY[wp.slug, wp.title],
  wp.acl_scope,
  COALESCE(wp.acl_scope, 'org:acme') || '/' || CASE
    WHEN wp.slug LIKE 'root/%'    THEN 'proj-org-shared'
    WHEN wp.slug LIKE 'seed/%'    THEN 'proj-seed-examples'
    WHEN wp.slug LIKE 'stores/%'  THEN 'proj-org-shared'
    ELSE split_part(wp.slug, '/', 1)
  END,
  ARRAY[
    CASE
      WHEN wp.slug LIKE 'root/%'    THEN 'proj-org-shared'
      WHEN wp.slug LIKE 'seed/%'    THEN 'proj-seed-examples'
      WHEN wp.slug LIKE 'stores/%'  THEN 'proj-org-shared'
      ELSE split_part(wp.slug, '/', 1)
    END,
    wp.page_id::text
  ] || COALESCE(wp.source_asset_ids, '{}'),
  NULL,
  COALESCE(wp.source_asset_ids, '{}'),
  wp.created_at,
  wp.updated_at,
  now()
FROM wiki_pages wp
ON CONFLICT (wiki_page_id) DO NOTHING;
