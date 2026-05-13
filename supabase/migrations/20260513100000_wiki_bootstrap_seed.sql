-- ---------------------------------------------------------------------------
-- Session 2b — Wiki bootstrap seed migration
-- Creates the two special navigation rows (root/index and root/log) and one
-- example page of each of the five content page types (summary, entity,
-- concept, comparison, synthesis) so Claude has template references.
-- ---------------------------------------------------------------------------

-- The seed project row used by all example pages.
insert into projects (project_id, org_id, name, description, owner_team, acl_scope)
values (
  'proj-seed-examples',
  '00000000-0000-0000-0000-000000000000',
  'Seed Examples',
  'Example pages seeded during wiki bootstrap for template reference only.',
  'platform',
  'internal'
)
on conflict (project_id) do nothing;

-- ---------------------------------------------------------------------------
-- root/index — content-oriented catalog (index page type)
-- ---------------------------------------------------------------------------

insert into wiki_pages (slug, title, page_type, content_md, source_asset_ids, acl_scope)
values (
  'root/index',
  'Org Memory Root Index',
  'index',
  $md$# Org Memory Root Index

**Scope:** org
**ACL scope:** `internal`
**Last updated:** 2026-05-13

## Contents

| Slug | Title | Type | One-line summary |
|------|-------|------|-----------------|
| [[root/log]] | Org Memory Activity Log | log | Chronological append-only record of all ingest, query, and lint events |

## Recently added
- `2026-05-13` — [[root/log]] added: wiki bootstrap (Session 2b)

## Notes
- This is the root catalog. Add every new domain or top-level index page to the Contents table above.
- Claude reads this page first on any query to identify relevant domain and project pages to load.
$md$,
  '{}',
  'internal'
)
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- root/log — chronological append-only activity log (log page type)
-- ---------------------------------------------------------------------------

insert into wiki_pages (slug, title, page_type, content_md, source_asset_ids, acl_scope)
values (
  'root/log',
  'Org Memory Activity Log',
  'log',
  $md$# Org Memory Activity Log

**ACL scope:** `org`
**Format:** append-only; newest entry at bottom

---

## 2026-05-13 00:00 UTC | ingest | session-2b

**Run ID:** `session-2b-bootstrap`
**Event:** ingest
**Summary:** Wiki bootstrap — created root/index, root/log, and five example template pages (summary, entity, concept, comparison, synthesis).
**Assets affected:** none (seed data, not asset-derived)
**Pages created or updated:** [[root/index]], [[root/log]], [[seed/examples/example-summary]], [[seed/examples/example-entity]], [[seed/examples/example-concept]], [[seed/examples/example-comparison]], [[seed/examples/example-synthesis]]
**Notes:** These are template reference pages only. Real pages will be created during asset ingest in subsequent sessions.

---
$md$,
  '{}',
  'internal'
)
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- seed/examples/example-summary — template reference (summary page type)
-- ---------------------------------------------------------------------------

insert into wiki_pages (slug, title, page_type, content_md, source_asset_ids, acl_scope)
values (
  'seed/examples/example-summary',
  'Example Summary Page',
  'summary',
  $md$# Example Document Title — Summary

**Source asset:** `00000000-0000-0000-0000-000000000001`
**Project:** `proj-seed-examples`
**ACL scope:** `internal`
**Ingest run:** `session-2b-bootstrap`
**Last updated:** 2026-05-13

## What this document covers
This is a template reference page showing the required structure for a `summary` page. A real summary page is created automatically when a new asset is ingested. It describes the document's purpose and scope in one to three sentences.

## Key entities and concepts
- **Example Entity**: A placeholder showing how to list named entities or concepts surfaced by the document.

## Relevant cross-links
- [[seed/examples/example-entity]] — this entity is the subject of the example document

## Open questions / follow-ups
- None at this time.
$md$,
  '{00000000-0000-0000-0000-000000000001}',
  'internal'
)
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- seed/examples/example-entity — template reference (entity page type)
-- ---------------------------------------------------------------------------

insert into wiki_pages (slug, title, page_type, content_md, source_asset_ids, acl_scope)
values (
  'seed/examples/example-entity',
  'Example Entity',
  'entity',
  $md$# Example Entity

**Entity type:** vendor
**ACL scope:** `internal`
**Last updated:** 2026-05-13

## Description
This is a template reference page showing the required structure for an `entity` page. A real entity page is created when a significant named entity (person, team, vendor, system, regulation, etc.) appears across two or more assets and warrants its own page.

## Appearances in corpus
| Asset / Page | Role | Notes |
|---|---|---|
| [[seed/examples/example-summary]] | subject | template reference only |

## Related entities
- (none — template reference page)

## Known facts
- This page was created as a seed template during wiki bootstrap (Session 2b).

## Contradictions or uncertainty
- None.
$md$,
  '{}',
  'internal'
)
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- seed/examples/example-concept — template reference (concept page type)
-- ---------------------------------------------------------------------------

insert into wiki_pages (slug, title, page_type, content_md, source_asset_ids, acl_scope)
values (
  'seed/examples/example-concept',
  'Example Concept',
  'concept',
  $md$# Example Concept

**Domain:** org-wide
**ACL scope:** `internal`
**Last updated:** 2026-05-13

## Definition
This is a template reference page showing the required structure for a `concept` page. A real concept page captures important domain terms, methodologies, or regulatory concepts that require explanation and appear across multiple assets.

## How it is used in this org
Concept pages provide a single authoritative definition for domain terms so Claude does not have to re-derive meaning from raw documents on every query. They are updated when new assets introduce new facets of the concept or when contradictions are detected.

## Related concepts
- (none — template reference page)

## Source references
- (none — this is a template reference page with no source asset)

## Lint notes
- None.
$md$,
  '{}',
  'internal'
)
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- seed/examples/example-comparison — template reference (comparison page type)
-- ---------------------------------------------------------------------------

insert into wiki_pages (slug, title, page_type, content_md, source_asset_ids, acl_scope)
values (
  'seed/examples/example-comparison',
  'Example Comparison: Vendor A vs Vendor B',
  'comparison',
  $md$# Example Comparison: Vendor A vs Vendor B

**Compared entities:** Vendor A, Vendor B
**Comparison dimensions:** cost, features, SLA
**ACL scope:** `internal`
**Last updated:** 2026-05-13

## Comparison matrix

| Dimension | Vendor A | Vendor B | Notes |
|---|---|---|---|
| Monthly cost | $1,000 | $1,200 | Placeholder values |
| Uptime SLA | 99.9% | 99.95% | Placeholder values |
| Key feature | Feature X | Feature Y | Placeholder values |

## Summary of findings
This is a template reference page showing the required structure for a `comparison` page. Real comparison pages are created when an ingested asset (such as a vendor comparison matrix) provides direct multi-entity comparisons. The summary should state the key finding in two to five sentences.

## Source references
- (none — this is a template reference page with no source asset)

## Contradictions or gaps
- None.
$md$,
  '{}',
  'internal'
)
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- seed/examples/example-synthesis — template reference (synthesis page type)
-- ---------------------------------------------------------------------------

insert into wiki_pages (slug, title, page_type, content_md, source_asset_ids, acl_scope)
values (
  'seed/examples/example-synthesis',
  'Example Synthesis: Cross-Source Analysis',
  'synthesis',
  $md$# Example Synthesis: Cross-Source Analysis

**Synthesis type:** analysis
**Input sources:** (none — template reference page)
**ACL scope:** `internal`
**Derived from run:** `session-2b-bootstrap`
**Last updated:** 2026-05-13

## Synthesis
This is a template reference page showing the required structure for a `synthesis` page. A real synthesis page is created when Claude derives a new insight, analysis, or cross-source conclusion that adds value beyond individual asset summaries. All claims must be traceable to cited source assets. No unsourced claims are permitted.

## Evidence chain
| Claim | Source | Confidence |
|---|---|---|
| (template — no real claims) | — | — |

## Limitations and caveats
- This page is a template reference only and contains no real analysis.

## Promotion status
- [ ] Pending review
$md$,
  '{}',
  'internal'
)
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- Cross-references between the bootstrap pages
-- ---------------------------------------------------------------------------

-- root/index -> root/log (link)
insert into wiki_cross_references (from_page_id, to_page_id, ref_type)
select f.page_id, t.page_id, 'link'::wiki_ref_type
from wiki_pages f, wiki_pages t
where f.slug = 'root/index' and t.slug = 'root/log'
on conflict do nothing;

-- root/log -> root/index (link, bidirectional)
insert into wiki_cross_references (from_page_id, to_page_id, ref_type)
select f.page_id, t.page_id, 'link'::wiki_ref_type
from wiki_pages f, wiki_pages t
where f.slug = 'root/log' and t.slug = 'root/index'
on conflict do nothing;

-- example-summary -> example-entity (link)
insert into wiki_cross_references (from_page_id, to_page_id, ref_type)
select f.page_id, t.page_id, 'link'::wiki_ref_type
from wiki_pages f, wiki_pages t
where f.slug = 'seed/examples/example-summary' and t.slug = 'seed/examples/example-entity'
on conflict do nothing;

-- example-entity -> example-summary (link, bidirectional)
insert into wiki_cross_references (from_page_id, to_page_id, ref_type)
select f.page_id, t.page_id, 'link'::wiki_ref_type
from wiki_pages f, wiki_pages t
where f.slug = 'seed/examples/example-entity' and t.slug = 'seed/examples/example-summary'
on conflict do nothing;
