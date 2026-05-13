-- Session 2b: Wiki bootstrap seed migration
-- Creates the root navigation pages and one example page of each content page type.
-- Idempotent: uses ON CONFLICT (slug) DO NOTHING.

-- Ensure uuid-ossp extension is available (created in initial schema, but guard here too)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------------
-- Navigation pages
-- ---------------------------------------------------------------------------

-- Root index (root/index)
INSERT INTO wiki_pages (
  id,
  slug,
  title,
  page_type,
  content_md,
  acl_scope,
  source_asset_ids,
  created_at,
  updated_at
) VALUES (
  uuid_generate_v4(),
  'root/index',
  'Root Index',
  'index',
  E'# Root Index\n\n**Scope:** org\n**ACL scope:** `org:demo`\n**Last updated:** 2026-05-13\n\n## Contents\n\n| Slug | Title | Type | One-line summary |\n|------|-------|------|------------------|\n\n## Recently added\n\n## Notes\n',
  'org:demo',
  ARRAY[]::uuid[],
  now(),
  now()
) ON CONFLICT (slug) DO NOTHING;

-- Root activity log (root/log)
INSERT INTO wiki_pages (
  id,
  slug,
  title,
  page_type,
  content_md,
  acl_scope,
  source_asset_ids,
  created_at,
  updated_at
) VALUES (
  uuid_generate_v4(),
  'root/log',
  'Org Memory Activity Log',
  'log',
  E'# Org Memory Activity Log\n\n**ACL scope:** `org`\n**Format:** append-only; newest entry at bottom\n\n---\n',
  'org:demo',
  ARRAY[]::uuid[],
  now(),
  now()
) ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Example content pages (one per page type)
-- ---------------------------------------------------------------------------

-- summary
INSERT INTO wiki_pages (
  id,
  slug,
  title,
  page_type,
  content_md,
  acl_scope,
  source_asset_ids,
  created_at,
  updated_at
) VALUES (
  uuid_generate_v4(),
  'example/shared/example-summary',
  'Summary: Example Document',
  'summary',
  E'# Example Document — Summary\n\n**Source asset:** *(none — seed example)*\n**Project:** example\n**ACL scope:** `org:demo`\n**Ingest run:** *(none)*\n**Last updated:** 2026-05-13\n\n## What this document covers\nThis is a seed example of a summary page. Replace with a real asset summary.\n\n## Key entities and concepts\n- **Example Entity**: A placeholder entity for demonstration.\n\n## Relevant cross-links\n\n## Open questions / follow-ups\n',
  'org:demo',
  ARRAY[]::uuid[],
  now(),
  now()
) ON CONFLICT (slug) DO NOTHING;

-- entity
INSERT INTO wiki_pages (
  id,
  slug,
  title,
  page_type,
  content_md,
  acl_scope,
  source_asset_ids,
  created_at,
  updated_at
) VALUES (
  uuid_generate_v4(),
  'example/shared/example-entity',
  'Entity: Example Team',
  'entity',
  E'# Example Team\n\n**Entity type:** team\n**ACL scope:** `org:demo`\n**Last updated:** 2026-05-13\n\n## Description\nThis is a seed example of an entity page. Replace with a real team or person entity.\n\n## Appearances in corpus\n| Asset / Page | Role | Notes |\n|---|---|---|\n\n## Related entities\n\n## Known facts\n\n## Contradictions or uncertainty\n',
  'org:demo',
  ARRAY[]::uuid[],
  now(),
  now()
) ON CONFLICT (slug) DO NOTHING;

-- concept
INSERT INTO wiki_pages (
  id,
  slug,
  title,
  page_type,
  content_md,
  acl_scope,
  source_asset_ids,
  created_at,
  updated_at
) VALUES (
  uuid_generate_v4(),
  'example/shared/example-concept',
  'Concept: Row Level Security',
  'concept',
  E'# Row Level Security\n\n**Domain:** engineering\n**ACL scope:** `org:demo`\n**Last updated:** 2026-05-13\n\n## Definition\nRow Level Security (RLS) is a PostgreSQL feature that restricts which rows a user can access within a table based on policy expressions.\n\n## How it is used in this org\nAll tables in the org-memory schema have RLS enabled. Access is controlled by `acl_scope` columns and Supabase Auth JWT claims.\n\n## Related concepts\n\n## Source references\n\n## Lint notes\n',
  'org:demo',
  ARRAY[]::uuid[],
  now(),
  now()
) ON CONFLICT (slug) DO NOTHING;

-- comparison
INSERT INTO wiki_pages (
  id,
  slug,
  title,
  page_type,
  content_md,
  acl_scope,
  source_asset_ids,
  created_at,
  updated_at
) VALUES (
  uuid_generate_v4(),
  'example/shared/example-comparison',
  'Comparison: Claude vs OpenAI',
  'comparison',
  E'# Comparison: Claude vs OpenAI\n\n**Compared entities:** Claude (Anthropic), GPT-4 (OpenAI)\n**Comparison dimensions:** context window, tool use, reasoning\n**ACL scope:** `org:demo`\n**Last updated:** 2026-05-13\n\n## Comparison matrix\n\n| Dimension | Claude | GPT-4 | Notes |\n|---|---|---|---|\n| Context window | 200k tokens | 128k tokens | As of 2026-05 |\n| Tool use | Yes | Yes | Both support function calling |\n| Extended reasoning | Yes | Yes | Chain-of-thought modes available |\n\n## Summary of findings\nThis is a seed example of a comparison page. Replace with a real vendor or technology comparison.\n\n## Source references\n\n## Contradictions or gaps\n',
  'org:demo',
  ARRAY[]::uuid[],
  now(),
  now()
) ON CONFLICT (slug) DO NOTHING;

-- synthesis
INSERT INTO wiki_pages (
  id,
  slug,
  title,
  page_type,
  content_md,
  acl_scope,
  source_asset_ids,
  created_at,
  updated_at
) VALUES (
  uuid_generate_v4(),
  'example/shared/example-synthesis',
  'Synthesis: Org Memory Architecture',
  'synthesis',
  E'# Synthesis: Org Memory Architecture\n\n**Synthesis type:** analysis\n**Input sources:** *(none — seed example)*\n**ACL scope:** `org:demo`\n**Derived from run:** *(none)*\n**Last updated:** 2026-05-13\n\n## Synthesis\nThis is a seed example of a synthesis page. A synthesis page captures a new insight derived from multiple source documents. Replace with a real cross-document analysis.\n\n## Evidence chain\n| Claim | Source | Confidence |\n|---|---|---|\n\n## Limitations and caveats\n\n## Promotion status\n- [ ] Pending review\n- [ ] Accepted — promoted to canonical org memory\n- [ ] Rejected — [reason]\n',
  'org:demo',
  ARRAY[]::uuid[],
  now(),
  now()
) ON CONFLICT (slug) DO NOTHING;
