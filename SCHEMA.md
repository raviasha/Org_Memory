# SCHEMA.md — Org Memory Wiki Instruction Document

_This file is the equivalent of Karpathy's `CLAUDE.md`. It is loaded into every Claude session that interacts with the org memory wiki. It tells Claude the wiki structure, naming conventions, page formats, ingest workflow, query workflow, and lint rules. Humans and Claude co-evolve it over time._

_Session tag: Session 2b_

---

## 1. Overview

The org memory wiki is a compiled knowledge base stored in the `wiki_pages` Supabase table. It follows the [LLM Wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f): knowledge is **compiled once at ingest and kept current** — not re-derived on every query.

- Claude **reads** raw sources (`assets` table) but **never modifies** them.
- Claude **creates and maintains** wiki pages (`wiki_pages` table).
- Every ingest event updates relevant wiki pages so query time requires no re-derivation from raw documents.

### Three layers

| Layer | Table | Owned by | Purpose |
|-------|-------|----------|---------|
| 1 — Raw sources | `assets` | Platform (immutable) | Source of truth; original + normalized text |
| 2 — Wiki | `wiki_pages` | Claude (LLM-authored) | Compiled synthesis; what Claude reads at query time |
| 3 — Schema | `SCHEMA.md` (this file) | Humans + Claude (co-evolved) | Instructions that make Claude a disciplined wiki maintainer |

---

## 2. Database Schema Reference

### `wiki_pages` table

| Column | Type | Notes |
|--------|------|-------|
| `page_id` | UUID | Auto-generated primary key |
| `slug` | text | Unique identifier used in links and navigation (see naming conventions) |
| `title` | text | Human-readable title |
| `page_type` | enum | See §4 for valid values and formats |
| `content_md` | text | Full markdown body of the page |
| `source_asset_ids` | text[] | Asset IDs whose content contributed to this page |
| `acl_scope` | text | Access control scope; must match the most restrictive source asset's scope |
| `created_at` | timestamptz | Set on insert |
| `updated_at` | timestamptz | Auto-updated on every write |
| `shaping_job_id` | text | The ingest or shaping job run that last wrote this page |

### `wiki_cross_references` table

| Column | Type | Notes |
|--------|------|-------|
| `ref_id` | UUID | Auto-generated |
| `from_page_id` | UUID | Source page |
| `to_page_id` | UUID | Target page |
| `ref_type` | enum | `link` \| `contradiction` \| `staleness_flag` \| `synthesis_source` |

### `assets` table (read-only for Claude)

| Column | Notes |
|--------|-------|
| `asset_id` | UUID; use as `source_asset_ids` value when citing |
| `normalized_text` | Text Claude reads during ingest |
| `acl_scope` | Must be copied to any wiki page derived from this asset |
| `ingest_status` | Claude must not read assets with status `deleted` |

---

## 3. Slug Naming Conventions

Slugs must be **unique, stable, and human-readable**. Once a slug is created it must not change (deep links depend on it).

### Special navigation files

| Slug | Purpose |
|------|---------|
| `root/index` | Root catalog listing every domain and top-level topic with one-line summaries |
| `root/log` | Chronological append-only log of ingests, queries, and lint passes |
| `root/schema` | Pointer page — references this SCHEMA.md; content summarises current schema version |

### Domain and project indexes

```
{domain}/index          — domain-level index (e.g. finance/index)
{domain}/{project}/index — project-level index (e.g. finance/infra-q3/index)
```

### Content pages

```
{domain}/{project}/{slug}   — project-scoped page
{domain}/shared/{slug}      — domain-shared page (spans projects)
org/shared/{slug}            — org-wide shared page (e.g. org/shared/glossary)
```

### Store-catalog pages (memory store routing metadata)

```
stores/catalog/index         — root store catalog
stores/catalog/{store-slug}  — per-store routing metadata page
```

### Slug character rules

- Lowercase alphanumeric and hyphens only.
- No spaces, underscores, dots, or slashes except as path separators.
- Maximum 80 characters total including path separators.
- Examples: `finance/infra-q3/vendor-comparison`, `eng/incident-ops/api-gateway-runbook`, `org/shared/glossary`

---

## 4. Page Types and Required Formats

Every wiki page must match one of the types below. The format shown is the **minimum required structure**; Claude may add sections but must not remove required sections.

### 4.1 `summary` — Source summary page

Created when a new asset is ingested. One per asset (or per logical document group).

```markdown
# [Document Title] — Summary

**Source asset:** `{asset_id}`
**Project:** `{project_id}`
**ACL scope:** `{acl_scope}`
**Ingest run:** `{shaping_job_id}`
**Last updated:** `{updated_at}`

## What this document covers
[One to three sentences describing the document's purpose and scope.]

## Key entities and concepts
- **[Entity/Concept]**: [Brief definition or note]

## Relevant cross-links
- [[{slug}]] — [why it is related]

## Open questions / follow-ups
- [Any unresolved questions surfaced by this document; leave empty if none]
```

### 4.2 `entity` — Entity page

One page per significant named entity (person, team, vendor, system, regulation, etc.) that appears across multiple assets.

```markdown
# [Entity Name]

**Entity type:** [person | team | vendor | system | regulation | product | other]
**ACL scope:** `{acl_scope}`
**Last updated:** `{updated_at}`

## Description
[Two to five sentences defining the entity in the context of this org.]

## Appearances in corpus
| Asset / Page | Role | Notes |
|---|---|---|
| [[{slug}]] | [role] | [notes] |

## Related entities
- [[{slug}]] — [relationship description]

## Known facts
- [Fact with source citation]

## Contradictions or uncertainty
- [Note any conflicting claims across sources; leave empty if none]
```

### 4.3 `concept` — Concept page

One page per important concept, methodology, or domain term that requires explanation.

```markdown
# [Concept Name]

**Domain:** [finance | legal | engineering | corporate-dev | org-wide | other]
**ACL scope:** `{acl_scope}`
**Last updated:** `{updated_at}`

## Definition
[Concise definition as used in this org. Cite sources where relevant.]

## How it is used in this org
[One to three paragraphs on practical application.]

## Related concepts
- [[{slug}]] — [relationship]

## Source references
- `{asset_id}` — [what this asset contributes to this concept]

## Lint notes
- [Any staleness, contradiction, or gap flags; leave empty if none]
```

### 4.4 `comparison` — Comparison page

One page per explicit multi-entity comparison (e.g. vendor comparison, regulatory comparison).

```markdown
# [Comparison Title]

**Compared entities:** [Entity A, Entity B, ...]
**Comparison dimensions:** [cost, features, SLA, risk, ...]
**ACL scope:** `{acl_scope}`
**Last updated:** `{updated_at}`

## Comparison matrix

| Dimension | [Entity A] | [Entity B] | Notes |
|---|---|---|---|
| [Dimension] | [value] | [value] | [notes] |

## Summary of findings
[Two to five sentences summarising the key takeaway.]

## Source references
- `{asset_id}` — [contribution]

## Contradictions or gaps
- [Conflicting data or missing information; leave empty if none]
```

### 4.5 `synthesis` — Synthesis page

Created when Claude derives a new insight, analysis, or cross-source conclusion that adds value beyond individual summaries.

```markdown
# [Synthesis Title]

**Synthesis type:** [analysis | discovery | cross-project-link | recommendation | other]
**Input sources:** `{asset_id_1}`, `{asset_id_2}`, ...
**ACL scope:** `{acl_scope}` [must be most restrictive of all input sources]
**Derived from run:** `{shaping_job_id}`
**Last updated:** `{updated_at}`

## Synthesis
[Main body. Must be clearly derived from cited sources. No unsourced claims.]

## Evidence chain
| Claim | Source | Confidence |
|---|---|---|
| [claim] | [[{slug}]] or `{asset_id}` | high / medium / low |

## Limitations and caveats
- [What this synthesis cannot conclude; leave empty if none]

## Promotion status
- [ ] Pending review
- [ ] Accepted — promoted to canonical org memory
- [ ] Rejected — [reason]
```

### 4.6 `index` — Index / navigation page

Navigation catalog pages. Do not add free-form content; keep entries tightly structured.

```markdown
# [Index Title]

**Scope:** [org | domain:{name} | project:{id} | stores]
**ACL scope:** `{acl_scope}`
**Last updated:** `{updated_at}`

## Contents

| Slug | Title | Type | One-line summary |
|------|-------|------|-----------------|
| [[{slug}]] | [title] | [page_type] | [one sentence] |

## Recently added
- `{date}` — [[{slug}]] added: [reason]

## Notes
- [Any structural notes about this index level; leave empty if none]
```

### 4.7 `log` — Append-only activity log

The `root/log` page is the single activity log. Claude appends entries; it must never edit or delete existing entries.

```markdown
# Org Memory Activity Log

**ACL scope:** `org`
**Format:** append-only; newest entry at bottom

---

## {YYYY-MM-DD HH:MM UTC} | {event_type} | {actor}

**Run ID:** `{run_id}`
**Event:** [ingest | query | lint | shaping | promotion | manual]
**Summary:** [One sentence describing what happened]
**Assets affected:** `{asset_id}` [, ...]
**Pages created or updated:** [[{slug}]] [, ...]
**Notes:** [Any anomalies, retries, or flags; omit if none]

---
```

Valid `event_type` values: `ingest`, `query`, `lint`, `shaping`, `promotion`, `manual`.

### 4.8 `store_catalog` — Memory store routing metadata page

One page per memory store in the store-catalog wiki. Used by Claude to decide which stores to attach before task execution.

```markdown
# Store Catalog: [Store Name]

**Memory store ID:** `{memory_store_id}`
**Path slug:** `{path_slug}`
**Node type:** [org | domain | project | subproject]
**Status:** [active | inactive | archived]
**ACL scope:** `{acl_scope}`
**Last updated:** `{updated_at}`

## Routing summary
[Two to three sentences describing what this store contains and when to attach it.]

## Supported task intents
- [intent keyword or phrase]

## Top topics
- [topic]

## Top entities
- [entity name]

## Freshness and quality
| Signal | Value |
|--------|-------|
| Last updated | `{last_updated_at}` |
| Staleness score | `{staleness_score}` (0 = fresh, 1 = stale) |
| Coverage score | `{coverage_score}` (0 = sparse, 1 = comprehensive) |
| Contradiction risk | `{contradiction_risk_score}` |

## Historical routing priors
| Intent | Helpfulness | Selection rate |
|--------|-------------|----------------|
| [intent] | [score 0-1] | [rate 0-1] |

## Attach policy
**Default mode:** `{default_attach_mode}` (read_write | read_only)
**Attach priority:** `{attach_priority}` (1 = highest)
```

### 4.9 `lint_report` — Lint scan output

Written by the lint job. One active report; previous reports are archived by renaming the slug.

```markdown
# Wiki Lint Report

**Run ID:** `{run_id}`
**Scan date:** `{date}`
**ACL scope:** `org`

## Contradictions detected
| Page A | Page B | Conflicting claim | Severity |
|--------|--------|-------------------|---------|
| [[{slug}]] | [[{slug}]] | [description] | high / medium / low |

## Stale claims
| Page | Claim | Superseded by | Recommended action |
|------|-------|---------------|--------------------|
| [[{slug}]] | [description] | `{asset_id}` | [action] |

## Orphan pages
| Slug | Last updated | Recommended action |
|------|-------------|-------------------|
| [[{slug}]] | `{date}` | delete / link / merge |

## Missing pages (important concepts without a page)
| Concept | Evidence | Recommended action |
|---------|----------|--------------------|
| [name] | seen in `{asset_id}` | create entity / concept page |

## Missing cross-references
| Source page | Target (suggested) | Relationship |
|-------------|-------------------|--------------|
| [[{slug}]] | [[{slug}]] | [type] |

## Summary
**Total issues:** {n}  |  **High severity:** {n}  |  **Recommended pages to create:** {n}
```

---

## 5. Ingest Workflow

When a new asset arrives, Claude must execute the following steps **in order**. Do not skip steps.

```
Step 1 — Read the normalized_text of the new asset from the assets table.
         Confirm acl_scope and project_id.

Step 2 — Create a summary page for the asset (page_type: summary).
         Slug: {domain}/{project}/{asset-slug}-summary
         source_asset_ids: [asset_id]
         acl_scope: asset's acl_scope

Step 3 — Update or create entity pages for every significant named entity
         that appears in the asset and that either:
           (a) already has an entity page (update it), or
           (b) appears in two or more other assets (create a new page).

Step 4 — Update or create concept pages for domain terms introduced or
         reinforced by this asset.

Step 5 — If the asset provides data that directly compares multiple entities
         (e.g. a vendor comparison matrix), update or create a comparison page.

Step 6 — Update the project-level index page:
         Slug: {domain}/{project}/index
         Add the new summary page to the Contents table.

Step 7 — Update the domain-level index page if it exists.

Step 8 — Update the root index (slug: root/index) if a new domain or project
         was introduced.

Step 9 — Append a log entry to root/log with event_type: ingest.

Step 10 — Create cross_references rows for every [[wikilink]] added in steps 2–8.

Step 11 — If new contradictions with existing pages are detected, add
          cross_references rows with ref_type: contradiction and flag them
          in the affected pages' "Contradictions" sections.
```

### Ingest quality rules

- Every wiki page written must have `source_asset_ids` populated with at least one real asset ID.
- `acl_scope` on a wiki page must be the **most restrictive** scope among all source assets.
- Never write a wiki page with `acl_scope` less restrictive than any source asset.
- Set `shaping_job_id` on every page written during ingest to the ingest run ID.
- Use optimistic concurrency when updating existing pages: re-read, merge, and retry on conflict rather than overwriting.
- If a deterministic slug already exists, **update** (do not duplicate).

---

## 6. Query Workflow

Claude navigates the wiki — not the raw asset corpus — when answering a task.

```
Step 1 — Load root/index. Filter to pages ACL-accessible to the current user.
         Identify relevant domains and projects from the one-line summaries.

Step 2 — For each relevant domain, load the domain/index page.
         Identify relevant project slugs.

Step 3 — For each relevant project, load the project/index page.
         Build a shortlist of candidate page slugs (summary, entity, concept,
         comparison, synthesis) relevant to the task.

Step 4 — Read the shortlisted wiki pages.

Step 5 — If a specific raw asset is needed (e.g. for a financial computation
         or verbatim contract clause), fetch it from the assets table by
         asset_id as cited in the wiki page.

Step 6 — Assemble context pack:
         - Required wiki pages + cited assets
         - Retrieval level annotation per item (level_0 / level_1 / level_2)
         - Per-item rationale (why included, rank score, source, timestamp)
         - Any user override notes

Step 7 — If the task produces a new insight worth preserving, create a
         synthesis page (page_type: synthesis, promotion_status: pending).
         Append a log entry with event_type: query.
```

### Query anti-patterns (never do these)

- Do **not** scan the raw `assets` table without a prior wiki shortlist.
- Do **not** load all pages in an index without filtering to the task scope.
- Do **not** attach memory stores speculatively; shortlist files from metadata first.
- Do **not** include assets with `ingest_status = 'deleted'` in any context pack.

---

## 7. Lint Rules

Run lint on demand or when scheduled. Write results to a `lint_report` page.

| Rule ID | Check | Severity |
|---------|-------|---------|
| L01 | Two pages assert contradictory facts about the same entity | high |
| L02 | A summary page references an asset whose `ingest_status` is `deleted` | high |
| L03 | A synthesis page has `promotion_status: pending` older than 30 days | medium |
| L04 | An entity or concept page has no inbound cross-references (orphan) | medium |
| L05 | An entity appears in 3+ assets but has no entity page | medium |
| L06 | A wiki page's `acl_scope` is less restrictive than one of its source assets | high |
| L07 | root/index is missing an entry for an existing domain index | medium |
| L08 | A cross_references row points to a non-existent `to_page_id` | high |
| L09 | A summary page's `source_asset_ids` is empty | high |
| L10 | root/log has no entry for an asset whose `ingest_status` is `indexed` | medium |

---

## 8. Cross-Reference Rules

When adding `[[wikilink]]` notation in page content, Claude must also insert a row in `wiki_cross_references`.

| ref_type | When to use |
|----------|------------|
| `link` | Standard forward reference (page A mentions page B) |
| `contradiction` | Pages A and B assert conflicting facts |
| `staleness_flag` | Page B may make content in page A outdated |
| `synthesis_source` | A synthesis page is derived from source page B |

**Bidirectional links:** Insert two rows (A→B and B→A) for `link` type. For `contradiction` and `staleness_flag`, insert in both directions so either page surfaces the flag.

---

## 9. ACL Enforcement Rules

- Wiki pages inherit the most restrictive `acl_scope` of all their source assets.
- `acl_scope` values in use: `public`, `internal`, `confidential`, `restricted`.
- Ordering (most to least restrictive): `restricted` > `confidential` > `internal` > `public`.
- Claude must never produce a wiki page with a scope less restrictive than any source asset's scope.
- At query time, Supabase RLS filters index pages before Claude reads them. Claude will never see slugs it is not entitled to.
- If a task requires cross-project context, Claude must confirm ACL entitlement for each project before reading its pages.

---

## 10. Memory-Store Routing Rules (Claude-facing summary)

Before attaching memory stores for a subtask:

1. Read `stores/catalog/index` first. This is the routing map.
2. Filter candidate stores by ACL entitlement.
3. Score candidates by: intent match, hierarchy proximity, freshness (lower staleness_score is better), and `historical_helpfulness_by_intent`.
4. Build a **file-level shortlist** (candidate memory paths, not full stores) before attaching.
5. Attach at most **3 stores** per subtask by default: one primary `read_write` + up to two secondary `read_only`.
6. If two or more stores are attached, run a **discovery pass** first, then a **curation pass** to build a deduplicated subtask bundle.
7. Execute against the curated bundle only; do not expand scope mid-execution without an explicit re-curation call.
8. Log all attach/read/write decisions in the run event stream for auditability.

---

## 11. Schema Version History

| Version | Date | Changed by | Summary |
|---------|------|-----------|---------|
| 1.0 | 2026-05-13 | Session 2b | Initial schema committed |
