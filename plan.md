## Plan: Org Memory Task Launcher Prototype

---
### AI Agent Session Instructions
**If you are starting a new AI-assisted coding session, follow these steps:**
1. Find the first session in the **Parallel Implementation Roadmap** below that is marked `[ ]` (incomplete).
2. That is your current task. Work on it exclusively.
3. When the session deliverable is done, its exit criteria pass, and the commit is pushed, **mark the checkbox `[x]`** in this file, commit the updated plan.md, and push before closing the session.
4. Do not start a subsequent session without completing and marking the current one.

---

Build a prototype where any employee can start AI-assisted work by loading a shared org memory file, creating a project, managing project assets, and receiving automatically assembled curated memory per subtask that is transparent and editable before execution. The system selects memory progressively down to specific wiki pages and files, shows exactly what was loaded and why, allows user add or remove overrides, and runs the task through either Claude or OpenAI via API key.

The product must be API-first: third-party runtimes should be able to submit tasks and subtasks to this system and receive curated memory/context packages programmatically, with or without the first-party UI.

### Asset Storage Architecture (Prototype)

All org assets live in **Supabase** (PostgreSQL). The retrieval model follows Karpathy's [LLM Wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f): knowledge is **compiled once at ingest and kept current** — not re-derived on every query. There is no RAG pipeline, no embedding model, and no vector index.

#### The three layers

**Layer 1 — Raw sources (immutable)**
Stored in Supabase `assets` table. LLM reads these but never modifies them. This is the source of truth. Each asset keeps its immutable original representation (text or binary) and a normalized text representation used for curation and retrieval.
One row per ingested file: asset_id, org_id, source_type, file_path_or_url, normalized_text, optional_binary_ref, acl_scope, ingested_at, last_modified_at.

**Layer 2 — Wiki (LLM-owned)**
Stored in Supabase `wiki_pages` table. The LLM creates and maintains these. Each page is a structured markdown document — a summary page, entity page, concept page, comparison, or synthesis. Pages link to each other (wikilinks stored as cross-reference rows). When a new source arrives, the LLM updates relevant pages rather than leaving the work for query time. Knowledge compounds: add the tenth source on a topic and the relevant wiki page already reflects all ten without re-deriving from scratch on every query.

Fields: page_id, slug, title, page_type (summary / entity / concept / comparison / synthesis), content_md, source_asset_ids (array FK), acl_scope, created_at, updated_at, shaping_job_id.

**Layer 3 — Schema (agent instruction document)**
A `SCHEMA.md` file (equivalent to Karpathy's `CLAUDE.md`) committed to the repo and loaded into every session. Tells Claude the wiki structure, naming conventions, page formats, ingest workflow, query workflow, and lint rules. This is the highest-leverage artifact — it makes Claude a disciplined wiki maintainer rather than a generic chatbot. Humans and Claude co-evolve it over time.

#### Two special navigation files (kept as rows, rendered as markdown)

`index.md` — content-oriented catalog. Every wiki page listed with a slug, one-line summary, and category. Claude reads this first on any query to find relevant pages, then drills into them. At small-to-medium scale this replaces any need for search infrastructure. Equivalent to Karpathy's `index.md`.

`log.md` — chronological append-only record of ingests, queries, and lint passes. Gives Claude a timeline of what has been processed and when. Parseable with simple grep patterns. Equivalent to Karpathy's `log.md`.

#### Operations

#### Project and asset management UX
Before any ingest runs, the user must select or create a project and manage assets within that project.

Required intake flow:

```
1. User opens project workspace
2. System shows existing projects and create-project action
3. User either:
	- selects an existing project, or
	- creates a custom project inline
4. User adds assets to the selected project (file, URL, folder)
5. User can remove assets from the project; deletions are soft-delete with audit trail
6. Backend normalizes and stores assets with project_id
7. Wiki shaping and indexing jobs run for that project scope
```

Supported asset classes in v1:
- Document uploads (pdf, docx, txt, md, csv, xlsx, pptx, and similar file types)
- Image uploads (png, jpg, jpeg, tiff, webp, and scanned-image variants)
- URLs to scrape and ingest as text
- Folder uploads containing multiple files (recursive ingest)

All ingested assets must carry project-scoped metadata (`project_id`, source type, ACL, lineage, ingest status).

#### Normalization and multimodal ingest policy (v1)
Normalization is owned by this platform, not by third-party execution runtimes.

Required rules:
- Every asset must produce a text-usable derivative for retrieval and curation.
- Preserve original binaries for fidelity, audit, and replay whenever the source is non-text.
- Link all derivatives to the canonical asset record with provenance and version hash.
- For images in v1, run minimal vision ingest: OCR text plus short caption and confidence metadata.
- Defer advanced multimodal extraction (layout graphs, deep table parsing, region grounding) to v2.

#### Transparency-first UI contract (required)
The first-party UI must expose the full background lifecycle so operators and end users can see what the system did, what data moved, and why.

Required visibility surfaces:
- Asset representation panel: original form location, normalized text form, extraction metadata, and provenance hash/version.
- Ingest timeline: step-by-step job stages, timestamps, status, retries, errors, and actor/service that performed each step.
- Managed Agents I/O panel: payload sent to Claude Managed Agents (redacted where required), response received, resulting memory paths, and version IDs.
- Memory-store activity panel per store: reads, writes, attach mode, selected/dropped memory items, and rationale.
- Memory-store metadata panel: full routing metadata object (identity, hierarchy, ACL, quality, freshness, and routing priors).
- LLM wiki explorer: index tree, page graph, cross-references, per-page provenance, and recent wiki edits.
- Run event stream: ordered event log for ingest, curation, export, and write-intent processing.
- Eval control panel: stage-wise precision and recall, Recall@k, Precision@k, nDCG@k, must-have asset hit rate, and trend deltas by build/version.
- Eval case inspector: per-test expected relevant assets, retrieved assets, misses, false inclusions, and where recall was lost in the retrieval pipeline.

Transparency implementation rules:
- Every background step must emit structured events with a shared `run_id` and `correlation_id`.
- UI must support both real-time stream and replay mode from persisted snapshots.
- Sensitive fields can be masked, but event presence and reason codes must remain visible.
- User-facing rationale text must map to machine-readable event fields for auditability.

#### UI information architecture (implementation checklist)
Use the following screen model so engineering and product can build and verify transparency consistently.

1. Project hub screen
- Project list, create-project action, project status, and ownership.
- Project-level KPIs: asset count, last ingest, freshness, and recent runs.

2. Project workspace screen
- Asset table with add/remove actions and soft-delete visibility.
- Asset states: pending, processing, indexed, failed, deleted.
- Inline access to asset representation drawer (raw pointer, normalized text, extraction metadata, provenance hash).

3. Ingest operations screen
- Live ingest timeline with step transitions, retries, errors, and actor/service.
- Managed Agents request/response summary with redaction controls.
- Memory writes created by ingest, including canonical path and version id.

4. Task and subtask planner screen
- Prototype mode: app-generated task and subtask plan with user edit controls.
- Production mode: externally supplied task/subtask payload preview.
- Per-subtask expected evidence and target project anchors.

5. Subtask curation screen
- Selected memory stores, selected/dropped memories, selected assets, and budget usage.
- Curated memory bundle preview for each subtask.
- Curation manifest export and immutable snapshot id display.

6. Explainability and audit screen
- Per-item rationale cards with provenance links and timestamps.
- Non-inclusion reasons for top excluded candidates.
- Replayable run event stream filtered by run id and correlation id.

7. LLM wiki explorer screen
- Index hierarchy tree, page graph, cross-reference view, and page-level provenance.
- Change history for wiki updates tied to ingest or query runs.

8. Eval command center screen
- Stage-wise precision/recall trends, Recall@k, Precision@k, nDCG@k, and required-asset hit rate.
- Case inspector diff: expected relevant assets vs retrieved assets, misses, false inclusions.
- Regression gate status and failed-threshold drilldown.

Navigation and persistence rules:
- Every row-level entity should deep-link to run/event context.
- Every screen should support project filter, task class filter, and time window.
- Prototype and production mode banners must be visible on planner and curation screens.

#### Upload-triggered memory and wiki update pipeline
Yes, the intended flow is upload -> database -> managed memory ingest -> wiki update.

Required sequence per uploaded asset:

```
1. User uploads asset into a selected or newly created project
2. Backend stores canonical asset record in Supabase assets, including normalized text and binary pointer when applicable
3. Backend triggers Managed Agents memory API for that project scope
	- attach the project memory store
	- ingest the new asset into agent-accessible working memory context
	- let the agent update project artifacts (summaries, links, notes, candidates)
4. Export accepted memory-derived artifacts to canonical wiki shaping input
5. Update LLM wiki pages (index, topic pages, cross-references, log)
	following Karpathy-style compile-at-ingest principles
6. Mark ingest status complete and persist run snapshot and provenance
```

Required memory contract during ingest:
- Enforce `one asset -> at least one canonical asset memory` in the project memory store.
- Use deterministic canonical asset memory paths such as `/assets/{asset_id}.md`.
- Memory records must include required provenance fields: `asset_id`, `project_id`, `source_uri`, `acl_scope`, `ingest_run_id`, and latest `memory_version_id`.
- Ingest completion is blocked until the memory create or update operation succeeds.
- If a deterministic path already exists, use idempotent update with optimistic concurrency rather than creating duplicates.
- Permit additional non-asset memories when useful (for example `/sessions/*`, `/decisions/*`, `/hypotheses/*`, `/open_questions/*`, `/links/*`) so Claude can preserve working context and continuity across sessions.
- Supplemental memories must include provenance and ACL metadata and must not replace the required canonical asset memory.

LLM choice for wiki updates:
- Wiki updates can be generated by Claude or another LLM.
- The canonical contract is provider-agnostic: outputs must satisfy schema, provenance, ACL, and lint requirements before write-back.

#### Provider dependency for ingest
The ingest pipeline's canonical asset memory write step targets Claude Managed Agents memory stores. This makes ingest Claude-dependent in the primary path. For runs where the execution provider is OpenAI, ingest still uses the Claude Managed Agents memory API to write canonical asset memories; only the subtask execution step swaps to the OpenAI adapter. In other words: memory store operations (create, seed, attach, read, write) are always Claude-backed; provider choice applies to the final execution step only. This constraint must be documented in the provider abstraction layer (Session 15) and surfaced clearly in the UI for operators choosing OpenAI as their execution provider.

**Ingest** (one file at a time or in small batches):
```
1. File arrives → stored as assets row (raw content, immutable from here)
2. Claude reads the source
3. Claude writes or updates wiki_pages rows:
   - A summary page for the source
   - Updates to existing entity or concept pages that the source touches
   - New cross-reference links between pages
   - Contradiction or staleness flags if new data conflicts with existing pages
4. Claude appends an entry to log.md
5. Claude updates index.md with any new pages
6. No embedding step. No chunking pipeline.
```

**Query** (Claude navigates the wiki, never the raw corpus):
```
1. User enters task
2. RLS filters index.md to ACL-entitled pages only
3. Claude reads index.md → identifies relevant page slugs
4. Claude reads those wiki_pages rows (compiled synthesis, already up to date)
5. If a specific raw asset is needed, Claude fetches it from assets by ID
6. Context pack assembled → user reviews → execution
7. If the answer is valuable (a comparison, analysis, or discovery), Claude
   saves it as a new wiki page so the knowledge compounds
```

**Lint** (periodic health check, on demand or scheduled):
```
Claude scans wiki_pages for: contradictions between pages, stale claims
superseded by newer sources, orphan pages with no inbound links, important
concepts mentioned but lacking their own page, missing cross-references,
data gaps that could be filled by ingesting a new source.
Results written to a lint_report wiki page with recommended actions.
```

#### Scaling the wiki without RAG — hierarchical index navigation
When `index.md` grows too large for one context load, split it into a navigable tree. Claude reads only the nodes it needs to traverse, going deeper only into relevant branches:

```
Level          What it contains                            Loaded when
────────────────────────────────────────────────────────────────────────
Root index     One-line summary of every domain/category  Always (tiny)
Domain index   One-paragraph summary per project/topic    When domain relevant
Project index  One-sentence summary per wiki page         When project relevant
Wiki page      Full compiled synthesis (wiki_pages row)   Pages Claude selects
Raw asset      Original source content (assets row)       Only when page cites it
```

Each index level is itself a wiki page. Claude navigates top-down: read root → pick domain → read domain index → pick pages → read pages. At most 2–3 extra calls before the final fetch. Still no embeddings, no similarity search. This is the same principle as Karpathy's `index.md` extended to a tree as the corpus grows.

#### ACL enforcement
Supabase Row Level Security filters both `assets` and `wiki_pages` by `acl_scope` against the authenticated user's entitlements. Unauthorized rows are invisible at the index load step — Claude never sees that those assets exist.

#### Supabase services used
- **Postgres**: assets, wiki_pages, cross_references, manifests, run_snapshots tables. No pgvector needed.
- **Row Level Security**: ACL enforcement at query time on both layers.
- **Supabase Auth**: user identity for RLS policies.
- **Edge Functions**: ingest handler (store asset → call Claude → write wiki pages + index + log), lint jobs, and snapshot creation. Server-side only — raw assets never touch the client.
- **Storage bucket** (optional): binary originals (PDFs, images); Postgres holds extracted text.

#### Why no RAG
RAG re-derives knowledge from raw documents on every query. The LLM wiki compiles knowledge once at ingest and keeps it current. For an enterprise memory system where the same domains, entities, and projects appear across hundreds of sources, compiled synthesis is dramatically cheaper and more consistent at query time than repeated retrieval. The bottleneck shifts from query latency to ingest quality — which is the right place for it to be.

#### How Claude managed memory fits as a required layer
Use a mandatory dual-layer model:

- **Canonical org memory** lives in Supabase and is the shared, auditable, provider-neutral ledger: raw sources, wiki pages, index pages, logs, snapshots, ACLs.
- **Claude Managed Agents memory stores** are the primary Claude memory path and act as the adaptive working memory layer: they carry forward stable preferences, recurring entities, navigation hints, recent context, unresolved questions, and dreaming cues across sessions.
- The product deliberately uses both on every Claude path: Managed Agents memory stores for continuity and adaptation, Supabase wiki for durability, sharing, governance, and reproducibility.

Primary implementation path:
- Use Managed Agents memory stores via API as the default project memory implementation.
- Seed each project memory store before task execution, attach it to sessions, and let Claude read or write memories during the agent loop.
- Promote accepted memory-derived outputs into canonical wiki pages and snapshots.
- Keep Claude Code local auto memory as optional developer-local support, not the system-of-record path.

Implementation clarifications:
- A memory store is an attached resource, not an automatic full-context payload. The agent reads memory files on demand after attach.
- The product must not attach all stores. Attach only the smallest set required for the current subtask.
- Managed Agents supports up to 8 attached stores per session, but product defaults should stay significantly lower for quality and cost control.

#### Memory-store hierarchy and routing metadata
Represent memory stores in an application-level tree (org -> domain -> project -> subproject) in Supabase. This hierarchy is a routing control plane, not a native Managed Agents hierarchy primitive.

LLM wiki usage for store routing metadata:
- Yes: use the Karpathy-style LLM wiki approach to organize and maintain memory-store metadata (store summaries, routing hints, freshness notes, ownership, and known task affinities).
- Treat this as a compiled routing layer (store-catalog wiki), not as the canonical source of raw memory content.
- During inference, load this store-catalog wiki first to decide which memory stores are candidates before any store attach.

Required metadata per store in the routing catalog:
- Identity: `memory_store_id`, `org_id`, `project_id`, `name`, `description`, `owner_team`, `status`.
- Hierarchy: `node_type`, `parent_node_id`, `depth`, `path_slug`, `related_store_ids`.
- Access and governance: `acl_scope`, `allowed_roles`, `data_classification`, `compliance_tags`, `region_residency`.
- Content signals: `top_topics`, `top_entities`, `supported_task_intents`, `source_systems`.
- Freshness and quality: `last_updated_at`, `staleness_score`, `coverage_score`, `contradiction_risk_score`.
- Operational stats: `memory_count`, `total_bytes`, `recent_write_rate_7d`, `recent_read_rate_7d`, `last_used_at`.
- Routing priors: `historical_helpfulness_by_intent`, `historical_selection_rate`, `historical_override_rate`, `default_attach_mode`, `attach_priority`.

Routing sequence before session start:
1. Parse task and infer intent, entities, and candidate project anchors.
2. Load store-catalog wiki pages first (routing metadata view).
3. ACL-filter candidate stores from the hierarchy catalog.
4. Score candidates by intent match, hierarchy proximity, freshness, and historical helpfulness.
5. Build a file-level shortlist first (memory paths or artifact IDs) and estimate token budget impact before attach.
6. Attach only the minimum stores needed for the subtask, then read only shortlisted memory files.
7. Fetch canonical assets only when needed.

Cross-store anti-bloat policy for a single subtask:
- Use staged retrieval: shortlist candidate files from secondary stores before full multi-store reads.
- Enforce a per-subtask memory-file budget (count and token estimate), not only a store-count cap.
- If two stores are needed, require explicit per-store evidence targets (what file(s) are needed and why).
- Deduplicate overlapping facts after reads and keep one canonical evidence item in the final context pack.
- If projected budget is exceeded, split into sequential micro-subtasks rather than loading both stores deeply at once.

Curated subtask-memory pattern (default when 2 to 3 stores are attached):
- Phase 1, discovery pass: run one lightweight read pass over the selected stores to collect candidate memory paths, short excerpts, and relevance scores.
- Phase 2, curation pass: build one temporary subtask memory bundle that includes only selected items across stores, with deduplication and hard token budget checks.
- Execute the subtask against the curated bundle plus required canonical artifacts, not against broad raw reads from all attached stores.
- Store the curation manifest (selected item IDs, dropped item IDs, reasons, and budgets) in the run snapshot for auditability.

Default attach policy per subtask:
- One primary `read_write` project store.
- Zero to two secondary `read_only` stores when justified by evidence.
- Optional shared org standards store as `read_only`.
- Hard cap: maximum 3 stores per subtask by default, with explicit escalation path above cap.

This gives you the benefit of future Claude memory improvements without letting the authoritative org knowledge disappear into a provider-only black box.

#### Recommended responsibility split

**Managed by canonical org memory in Supabase**
- Raw assets and their immutable history
- LLM-authored wiki pages and cross-references
- `index.md`, `log.md`, lint reports, and run snapshots
- ACL enforcement, provenance, audit trail, reproducibility
- The org memory manifest the user loads at session start

**Managed by Claude Managed Agents memory stores (primary path)**
- Session-to-session continuity for Claude-backed workflows
- User or team preferences such as preferred answer format, recurring stakeholders, naming conventions, and common task patterns
- Navigation shortcuts such as “Finance tasks usually start from pages X and Y” or “these project pages are often reviewed together”
- Working hypotheses, unresolved follow-ups, and candidate links discovered during ingest or query sessions
- Dreaming seeds: suggestions for consolidation, missing pages, contradictions to investigate, or likely next pages to update

**Managed by both layers together**
- Ingest decisions: Claude uses memory stores to recognize familiar patterns and likely destinations, then writes durable results into wiki pages
- Query preparation: Claude uses memory stores to bias where it looks first, while the visible context pack is assembled from canonical wiki pages and raw assets
- Consolidation: Claude accumulates tentative observations in memory stores, then promotes accepted insights into canonical org memory
- Team continuity: memory stores keep Claude sharp between sessions; Supabase ensures other users and providers can still see finalized knowledge

#### Dreaming / consolidation pattern
Treat Managed Agents memory stores as the required scratchpad for tentative insights between sessions, then periodically promote the useful ones into canonical org memory.

```
1. Ingest or query happens
2. Claude stores lightweight memory-store notes such as:
	- possible cross-links
	- likely stale pages
	- unresolved contradictions
	- candidate synthesis pages to write
3. A scheduled "dreaming" job asks Claude to review those memory-store notes
4. Claude proposes concrete wiki updates
5. Backend validates and writes accepted updates into wiki_pages / index / log
6. Only after write-back do they become org memory
```

This preserves the upside of managed memory while keeping the authoritative store auditable and provider-neutral.

**v1 scope note:** The dreaming/consolidation scheduled job is deferred to v2. In v1, tentative notes accumulate in memory stores and promotion is triggered manually by operator action or on task close, not by a background job. The promotion gate and write-back logic must still be implemented (Session 10), but scheduling infrastructure is out of scope for the prototype.

#### Wiki construction from project artifacts plus memory-derived outputs
For each project, construct and maintain the LLM wiki from two sources:

- **Project artifacts**: canonical raw sources from Supabase assets (documents, repositories, runbooks, APIs, files).
- **Memory-derived outputs**: accepted findings generated during Managed Agents sessions (decisions, cross-links, synthesis notes, reusable procedures), promoted from memory stores after validation.

Rule:
- Memory-store content is working state.
- Promoted memory-derived outputs become durable wiki artifacts.
- Wiki pages must always keep provenance links to original project artifacts and run snapshots.

Promotion gate:
- Memory-derived outputs are promotable only if provenance resolves to canonical assets and ACL checks pass.
- Persist explicit `memory_version_id -> asset_id` mappings in canonical audit tables.

#### Product rule: managed memory is working memory, wiki is ledger
The simplest rule is:

- Every Claude session reads and updates Managed Agents memory stores.
- Every org-relevant conclusion, summary, link, contradiction flag, or reusable answer must be written into Supabase-backed org memory.
- Managed memory may hold provisional reasoning and continuity state; wiki pages hold the finalized, shareable version.

In short: Managed Agents memory stores are mandatory for the live intelligence of the system, and Supabase-backed wiki memory is mandatory for the durable intelligence of the system.

That rule gives you a clean boundary while still letting Claude improve over time.

#### Project loading, wiki routing, and task workspace lifecycle
Keep these as separate responsibilities:

- **Project loading**: user selects a domain project (for example, Finance). The system attaches the matching project memory store to the session before task execution.
- **LLM wiki routing**: for the current task, Claude reads index and cross-reference pages to select relevant artifacts within the project and, when needed, linked artifacts across projects.
- **Workspace instantiation**: an orchestrator creates a task-scoped workspace from the selected artifacts.

Use this execution pattern:

```
1. User opens a base project
2. Project memory store is attached to the session and mounted for agent access
3. Task is submitted
4. Claude navigates wiki indexes and links to pick relevant artifacts
5. Orchestrator materializes a task workspace manifest and context pack
6. Claude executes inside that task workspace
7. Outputs are written back as run snapshots and candidate wiki updates
```

Default to **ephemeral task workspaces**. Do not create a permanent combined project per task by default.

Promotion policy for persistent cross-project workspaces:
- Promote only when the same cross-project task pattern repeats (for example, 3 times in 30 days), has a stable owner, and needs its own lifecycle.
- Even after promotion, canonical facts still write back to source project wiki pages and cross-references.

This prevents project sprawl while preserving enterprise-grade reuse.

#### Human-Like Execution Mode (prototype default)
Model runtime behavior after how strong human operators work: stable orientation, focused subtask work, temporary scratchpad, and deliberate consolidation.

Runtime rules:
- Keep one stable base memory context per anchored project for the full task.
- Decompose main tasks into explicit subtasks before deep execution.
- For each subtask, load only targeted memory overlays and wiki artifacts needed for that step.
- Use a temporary task scratchpad for intermediate reasoning, comparisons, and hypotheses.
- Promote only accepted conclusions to canonical wiki pages with provenance.
- Route write-back to the owning project or shared cross-project pages, not to a merged permanent project by default.
- Enforce per-subtask memory-store attach caps; escalate only when added stores are justified.
- Prefer asset fetch-on-demand after memory shortlist selection, not broad pre-loading.
- For cross-store subtasks, require file-level retrieval plans and budget checks before reading from secondary stores.
- If cross-store reads exceed budget, execute in sequence (store A pass, then store B pass, then synthesis) instead of one broad context load.
- When up to 3 stores are selected, perform discovery then curation, and run the subtask on the curated bundle rather than full store contents.
- Freeze each curated subtask bundle as immutable during execution; refresh only via an explicit re-curation call.
- In multi-agent runs, route memory write-back through application APIs with policy checks; avoid direct unmanaged writes from execution runtimes.

Execution loop:

```
1. Anchor task to a primary project
2. Load base memory store for that project
3. Plan subtasks with expected evidence per subtask
4. For each subtask:
	a. Select overlays from LLM wiki metadata
	b. If multiple stores are attached, run discovery pass and create curated subtask memory bundle
	c. Execute with base + curated overlay + task scratchpad
	d. Record rationale, evidence IDs, curation decisions, and confidence
5. Run synthesis checkpoint after N subtasks or major decision points
6. Promote accepted outputs to canonical wiki and snapshots
7. Close task with final answer + audit trail
```

Demo script (human-like behavior):

```
1. User submits a cross-functional task
2. Agent shows subtask plan (3-5 subtasks)
3. Agent displays memory loads per subtask:
	- base memory
	- overlays selected from wiki
4. Agent executes subtasks one by one and shows evidence trace
5. Agent performs synthesis checkpoint and resolves conflicts
6. Agent publishes final result and writes back accepted artifacts to wiki
7. Agent shows what remained temporary versus what became durable
```

Success signal for this mode:
- The run should be understandable as a sequence of focused work packets, each with explicit memory scope, evidence basis, and controlled write-back.

### Design Decisions
**Note:** Items below are design-decision records. Each maps to one or more roadmap sessions listed in parentheses. They are not implementation steps — the roadmap sessions are.

1. Lock end-user workflow and scope. *(Sessions 1, 1b)*
Depends on: none.
Define the primary journey: load org memory file, enter task, auto-select context, user reviews or edits context, then execute through a subtask-based loop with per-subtask discovery, curation, and controlled write-back via chosen model provider.

2. Define org memory file contract.
Depends on: 1.
Create a top-level org memory manifest format that includes source registry, project registry, hierarchy anchors, ACL policies, retrieval profiles, and pointers to indexed assets. This file is the user-facing entrypoint for all assisted work.

3. Define seed data and demo sources.
Depends on: 2.
Populate synthetic plus public web or GitHub data to simulate strategy docs, project business cases, code repos, runbooks, APIs, and shared-folder files. Include examples for all intake asset classes: document files, scrapeable URLs, and folder-based file collections. Ensure project-level artifacts exist so tasks like NPV computation can retrieve the specific business case file.

4. Define connectors and incremental indexing.
Depends on: 2, 3.
Implement source ingestion for manual document upload, URL scraping, folder upload, git, web or wiki, and shared folders or object storage. Enforce project assignment at upload time by requiring either existing-project selection or inline custom-project creation. Track status lifecycle and freshness so new files become retrievable within SLA.

5. Design canonical indexing model.
Depends on: 4.
Maintain metadata index, wiki-page index, and source pointers with lineage, versioning, ACL, confidence, and hierarchy placement. Ensure each selected wiki page and file maps back to concrete source-level origins.

6. Design progressive elaboration retrieval policy.
Depends on: 5.
Stage retrieval in levels: Level 0 org or domain summary, Level 1 task-relevant systems or docs, Level 2 specific wiki-page and file evidence. Require final selection to include the most specific high-relevance file when available.

7. Implement task-to-context selection with explainability.
Depends on: 6.
Given task text, rank candidates and assemble context pack under budget. Keep project loading separate from retrieval. Emit per-item rationale, rank score, source, timestamp, and why-included tags.

8. Design user context review controls.
Depends on: 7.
Build custom UI for pre-run review where users can inspect selected memory, expand to source, wiki-page, or file level, manually add context, remove context, and confirm final pack before execution.

8b. Design project and asset management controls.
Depends on: 2, 4.
Build UI that lists existing projects, supports inline custom project creation, and allows add/delete asset operations for supported classes (document, image, URL scrape, folder). Validate metadata and ACL before ingest starts, and preserve deletion audit history.

8c. Design external API surface for task-context curation.
Depends on: 7, 8.
Define API contracts for third-party callers to submit tasks/subtasks and retrieve curated memory bundles, rationale traces, and immutable snapshot identifiers. Include auth, ACL enforcement, idempotency keys, pagination, and error contracts.

9. Design model provider abstraction.
Depends on: 8.
Support provider choice via API key execution path for Claude or OpenAI. Keep provider-agnostic request and response envelope so context selection logic stays unchanged across backends. For Claude-backed flows, Managed Agents memory stores are the required companion layer; for non-Claude providers, the canonical wiki remains sufficient on its own.

10. Design Claude-assisted memory-shaping pipeline.
Depends on: 5, 9.
Run offline shaping jobs for summaries, cross-asset links, hierarchy refinements, conflict or staleness flags, and periodic consolidation outputs. Require Managed Agents memory stores to capture tentative notes and dreaming cues between sessions, then promote accepted outputs into canonical wiki pages before those insights count as org memory. Store outputs as derived layers with provenance while retaining canonical index ownership.

10b. Design memory-store routing and reconciliation layer. *(Session 8e)*
Depends on: 5, 7, 9, 10.
Build hierarchy-aware store routing metadata, ACL-first scoring, subtask attach caps, minimum one-canonical-memory-per-asset enforcement, ingest completion gates, and periodic reconciliation jobs for missing or broken asset-memory links.

11. Design task workspace orchestrator and promotion rules.
Depends on: 7, 9, 10, 10b.
Create a task-scoped workspace manifest assembled from wiki-selected artifacts, with provenance and ACL checks. Default to ephemeral workspaces. Define objective promotion thresholds for creating persistent cross-project program workspaces.

12. Define visualization and observability.
Depends on: 7, 8, 9, 10b, 11.
Provide dashboard views for indexed inventory, hierarchy, freshness, retrieval traces, user overrides, and per-task final loaded context. Include diff view between auto-selected and user-edited context packs. Include required transparency surfaces for raw vs normalized assets, ingest stage timelines, Managed Agents request/response traces, memory-store metadata objects, and LLM wiki structure explorer.

13. Define evaluation framework and benchmarks.
Depends on: 7, 8, 9, 10, 10b, 11, 12.
Run evals for indexing correctness, retrieval relevance, file-level specificity, user override impact, token efficiency, latency, answer quality, ACL safety, and managed-memory uplift. Include shaping ablation, managed-memory contribution analysis, Claude dual-layer performance checks, and provider parity checks. Before production labels are available, run a synthetic-first benchmark suite with known relevant assets per task and compute stage-wise precision/recall as the primary development north star.

Synthetic-first eval protocol (pre-production):
1. Build synthetic projects with explicit label sets per task: `relevant_asset_ids`, optional `required_asset_ids`, and distractor assets.
2. Execute the same task through inference and persist `retrieved_asset_ids` at store routing, shortlist, and final context-pack stages.
3. Compute and trend:
	- Asset precision = intersection(retrieved, relevant) / retrieved
	- Asset recall = intersection(retrieved, relevant) / relevant
	- Required-asset hit rate (all required assets present)
	- Recall@k, Precision@k, and nDCG@k
4. Segment metrics by task class and by retrieval stage to localize regressions quickly.
5. Surface all metrics and per-case diffs in UI and fail the benchmark gate on threshold regressions.

14. Execute staged rollout.
Depends on: 2-13.
Phase A: seed org memory file and index demo corpus.
Phase B: show live add-data indexing and retrievability.
Phase C: run task launcher workflow with user review and edit controls.
Phase D: run eval suite and publish scorecard.

15. Prepare v2 extension.
Depends on: 14.
Specify periodic in-task context reassessment triggers for long workflows, without implementing in v1.

### v1 Product Boundary and Platform Handoff
For this prototype, include first-party subtask execution after curated context selection, with full transparency and reproducible audit trails.

v1 in-scope flow:
1. User uploads asset.
2. Backend stores asset in Supabase with normalized text derivative and binary reference when applicable.
3. Backend writes canonical asset memory in Managed Agents store with deterministic path and explicit asset linkage metadata.
4. Claude may create additional supplemental memories at ingest time or runtime.
5. A separate metadata-shaping agent maintains store-level routing metadata (provider-agnostic agent allowed).
6. In prototype mode, the application can generate a task and subtask plan from user-provided objective context; users can edit before run.
7. At inference time, task is decomposed into subtasks.
8. Per subtask, select up to 3 memory stores.
9. Run discovery and curation pass across selected stores to produce curated subtask memory + required assets + export descriptors for raw binaries when needed.
10. UI shows end-to-end trace and curated memory for each subtask: selected stores, selected memories, dropped memories, selected assets, reasons, and budget usage.
11. First-party runtime executes each subtask using the curated bundle (Claude/OpenAI adapter path), then records outputs and rationale traces.
12. Execution runtimes request curated subtask context packages from this API and receive immutable bundles with snapshot IDs.
13. Execution runtimes submit memory write intents back to this API for controlled write-back.
14. Third-party platforms can call the same API-first task/subtask curation endpoints directly, without UI coupling.

v1 external handoff (supported, not required):
- Main task or subtask execution can also be delegated to an external orchestrator platform (for example, n8n or similar) using the curated context package API produced by this system.

Execution handoff and multi-agent write policy:
- The run environment (for example, Claude Code or another orchestrator) should call this API for each subtask and consume only the returned curated package.
- The curated package is the execution contract for that subtask and should not be implicitly expanded during runtime.
- Runtime memory updates should be sent as write intents to this API rather than writing directly to memory stores.
- Write intents must include provenance envelope fields (`task_id`, `subtask_id`, `run_id`, `agent_id`, `source_refs`) and an idempotency key.
- Apply optimistic concurrency on updates (for example using content hash preconditions) and perform re-read/merge/retry on conflicts.
- Keep canonical asset memories controlled; use supplemental paths for runtime notes and hypotheses.

API-first integration contract (third-party callers):
- `POST /v1/tasks/curate`: submit task + caller context and receive subtask plan with candidate memory-store routing summary.
- `POST /v1/subtasks/{subtask_id}/curate`: receive curated memory bundle, selected assets, rationale trace, and immutable `snapshot_id`.
- `POST /v1/subtasks/{subtask_id}/write-intents`: submit runtime memory updates for policy-checked write-back.
- `GET /v1/snapshots/{snapshot_id}`: retrieve exact curated package and explainability metadata for audit/replay.
- `GET /v1/snapshots/{snapshot_id}/export-assets`: retrieve controlled raw-asset export descriptors (for example signed URLs, mime type, byte size, hash, expiry, redaction policy).
- `GET /v1/runs/{run_id}/events`: retrieve structured event timeline for ingest, curation, export, and write-intent lifecycle.
- `GET /v1/assets/{asset_id}/representations`: retrieve raw-location metadata, normalized representation, extraction metadata, and provenance hashes for UI inspection.
- `GET /v1/memory-stores/{memory_store_id}/activity`: retrieve per-store request/response summaries, read/write actions, selected/dropped memory items, and reason codes.
- `GET /v1/wiki/graph`: retrieve index hierarchy and page-link graph for Karpathy-style wiki navigation views.
- All endpoints must enforce caller auth, ACL scoping, and deterministic idempotency semantics.

Third-party responsibility boundary:
- Third parties consume curated bundles and controlled raw-asset exports; they are not required to normalize source files for this platform.
- Third parties may perform optional task-specific parsing after download, but ingest correctness and canonical normalization remain platform-owned.

Prototype versus production operating mode:
- Prototype mode: users create projects and manage assets in the first-party UI; the app can generate task/subtasks, execute subtasks in-app, and display curated memory per subtask directly in the UI.
- Production mode: users continue to manage projects/assets in the app, while execution runtimes consume curated memory primarily through the API contract.

### Synthetic Demo Corpus

This is the complete reference dataset for development, demo, and eval. All sessions that touch ingestion, retrieval, curation, or eval draw from this corpus. No real customer data is used in the prototype.

#### Corpus structure
Four scoped projects plus one shared org-level project. Each project contains primary assets, distractor assets (same project, wrong topic), and explicit per-task relevance labels for eval.

---

#### Project 1 — Finance: Q3 FY26 Infrastructure Investment
`project_id: proj-finance-infra-q3`

| Filename | Type | Description |
|---|---|---|
| `infrastructure-investment-business-case-q3-fy26.pdf` | PDF | NPV model, 5-year cashflow projections, IRR calculation, risk assumptions, recommendation section |
| `cfo-q3-guidance.pdf` | PDF | CFO memo on discount rate (8.5%), hurdle rate, and capital allocation rules for Q3 |
| `vendor-comparison-matrix.xlsx` | XLSX | Cost, feature, and SLA comparison across three vendors: CloudA, CloudB, CloudC |
| `it-infrastructure-rfp-2026.docx` | DOCX | Formal RFP with technical requirements, scoring rubric, and evaluation timeline |
| `board-approval-memo-q2-fy26.md` | Markdown | Prior board memo approving the capital budget envelope for FY26 infrastructure |
| `infrastructure-depreciation-schedule.csv` | CSV | Current asset depreciation timeline by asset class and acquisition year |
| `vendor-cloudA-proposal.pdf` | PDF | Full proposal from CloudA including pricing tiers, SLA terms, and migration plan |
| `vendor-cloudB-proposal.pdf` | PDF | Full proposal from CloudB |
| `office-lease-renewal-2024.pdf` | PDF | **Distractor** — unrelated finance document; should never appear in infrastructure-task context |
| `travel-expense-policy.txt` | TXT | **Distractor** — unrelated HR/finance policy |

Demo tasks for this project:

1. **NPV recommendation task** — `"Calculate the NPV of the Q3 infrastructure investment at the CFO-specified discount rate and recommend whether to proceed."`
   - `required_asset_ids`: business-case-q3-fy26, cfo-q3-guidance
   - `relevant_asset_ids`: board-approval-memo-q2-fy26, infrastructure-depreciation-schedule
   - `distractor_asset_ids`: office-lease-renewal-2024, travel-expense-policy

2. **Vendor selection task** — `"Which vendor should we select based on cost, capabilities, and SLA alignment with our RFP requirements?"`
   - `required_asset_ids`: vendor-comparison-matrix, it-infrastructure-rfp-2026
   - `relevant_asset_ids`: vendor-cloudA-proposal, vendor-cloudB-proposal, infrastructure-investment-business-case-q3-fy26
   - `distractor_asset_ids`: office-lease-renewal-2024, travel-expense-policy

---

#### Project 2 — Legal/Compliance: Data Privacy
`project_id: proj-compliance-privacy`

| Filename | Type | Description |
|---|---|---|
| `gdpr-compliance-checklist-v3.md` | Markdown | Internal GDPR checklist — 42 controls with owner and status columns |
| `ccpa-policy-2025.pdf` | PDF | Acme internal California Consumer Privacy Act policy, effective Jan 2025 |
| `data-retention-schedule.xlsx` | XLSX | Retention periods by data class (PII, transaction, log, contract, HR) |
| `dpa-template-v2.docx` | DOCX | Data Processing Agreement template with standard clauses and fill-in fields |
| `privacy-incident-response-playbook.md` | Markdown | Step-by-step response procedures for data breach and privacy incidents |
| `vendor-data-handling-requirements.pdf` | PDF | Requirements vendors must meet before handling Acme personal data |
| `ico-guidance-legitimate-interests.pdf` | PDF | Scraped and normalized ICO guidance on legitimate interests (source: URL ingest) |
| `employee-handbook-2025.pdf` | PDF | **Distractor** — general HR document |
| `office-supplies-procurement.csv` | CSV | **Distractor** — procurement data with no privacy relevance |

Demo tasks for this project:

3. **DPA drafting task** — `"Draft a data processing agreement for a new analytics vendor we are onboarding."`
   - `required_asset_ids`: dpa-template-v2, gdpr-compliance-checklist-v3
   - `relevant_asset_ids`: vendor-data-handling-requirements, data-retention-schedule
   - `distractor_asset_ids`: employee-handbook-2025, office-supplies-procurement

4. **Retention lookup task** — `"What is our current data retention period for customer transaction records and what policy governs it?"`
   - `required_asset_ids`: data-retention-schedule
   - `relevant_asset_ids`: gdpr-compliance-checklist-v3, ccpa-policy-2025
   - `distractor_asset_ids`: employee-handbook-2025, office-supplies-procurement

---

#### Project 3 — Engineering: Platform Incident Operations
`project_id: proj-eng-incident-ops`

| Filename | Type | Description |
|---|---|---|
| `api-gateway-runbook.md` | Markdown | Step-by-step incident response for API gateway — covers 502, 504, rate-limit, and cert expiry scenarios |
| `database-failover-runbook.md` | Markdown | DB failover and read-replica promotion procedures |
| `incident-postmortem-2026-03-15.md` | Markdown | Postmortem for a major API gateway outage on 15 Mar 2026 — root cause: misconfigured upstream timeout |
| `incident-postmortem-2025-11-22.md` | Markdown | Older postmortem for a DB connection pool exhaustion incident |
| `service-dependency-map.png` | PNG (image/OCR) | Architecture diagram showing service-to-service dependencies; OCR extracts service names and arrows |
| `alert-thresholds-config.yml` | YAML | Current alerting thresholds for all platform services |
| `on-call-rotation-q2-2026.csv` | CSV | On-call schedule by week and service area for Q2 2026 |
| `platform-sla-commitments.pdf` | PDF | Customer-facing SLA commitments by service tier |
| `marketing-campaign-brief.pdf` | PDF | **Distractor** — unrelated marketing document |
| `q1-sales-report.xlsx` | XLSX | **Distractor** — unrelated sales data |
| `platform-services-repo` | Git repository | GitHub repo containing live copies of the alert thresholds config and incident runbooks; anchors the git connector (Session 5) to a corpus asset with eval labels |

Demo tasks for this project:

5. **Active incident task** — `"The API gateway is returning 502 errors in production. What are the immediate steps?"`
   - `required_asset_ids`: api-gateway-runbook
   - `relevant_asset_ids`: incident-postmortem-2026-03-15, service-dependency-map, alert-thresholds-config
   - `distractor_asset_ids`: marketing-campaign-brief, q1-sales-report

6. **On-call and SLA task** — `"Who is on call for the platform right now and which customer SLA commitments are at risk given the current outage?"`
   - `required_asset_ids`: on-call-rotation-q2-2026, platform-sla-commitments
   - `relevant_asset_ids`: alert-thresholds-config, api-gateway-runbook
   - `distractor_asset_ids`: marketing-campaign-brief, q1-sales-report

10. **Alert drift task** — `"What changed in the alert thresholds configuration in the last 30 days and are those changes reflected in our incident response runbooks?"`
   - `required_asset_ids`: platform-services-repo
   - `relevant_asset_ids`: alert-thresholds-config, api-gateway-runbook
   - `distractor_asset_ids`: marketing-campaign-brief, q1-sales-report
   - Note: requires git connector (Session 5); corpus anchor for Session 5 exit criteria.

---

#### Project 4 — Corporate Development: TargetCo M&A Due Diligence
`project_id: proj-corpdev-targetco-dd`

| Filename | Type | Description |
|---|---|---|
| `targetco-financial-summary-fy25.pdf` | PDF | TargetCo audited financials FY25: P&L, balance sheet, cashflow, key ratios |
| `targetco-tech-stack-assessment.md` | Markdown | Technical due diligence notes — stack, technical debt, security findings, migration risk |
| `targetco-customer-contract-template.docx` | DOCX | TargetCo standard customer contract with auto-renewal and IP assignment clauses |
| `targetco-ip-registry.xlsx` | XLSX | TargetCo IP assets: patents, trademarks, proprietary software, and ownership status |
| `targetco-key-risks-memo.md` | Markdown | Deal team memo identifying top 8 risks: customer concentration, IP encumbrance, key-person dependency, etc. |
| `targetco-org-chart.png` | PNG (image/OCR) | TargetCo org chart with names, titles, and reporting lines extracted by OCR |
| `comparable-transaction-analysis.xlsx` | XLSX | EV/Revenue and EV/EBITDA multiples for 12 comparable M&A transactions in the same sector |
| `acme-internal-roadmap-2026.pdf` | PDF | **Distractor** — Acme's own internal roadmap, not relevant to TargetCo DD |

Demo tasks for this project:

7. **Key risks summary task** — `"Summarize the top risks in acquiring TargetCo and assess which are deal-breakers versus manageable."`
   - `required_asset_ids`: targetco-key-risks-memo, targetco-financial-summary-fy25
   - `relevant_asset_ids`: targetco-tech-stack-assessment, targetco-ip-registry, targetco-customer-contract-template
   - `distractor_asset_ids`: acme-internal-roadmap-2026

8. **Valuation task** — `"What is a reasonable valuation range for TargetCo based on comparable transactions?"`
   - `required_asset_ids`: comparable-transaction-analysis, targetco-financial-summary-fy25
   - `relevant_asset_ids`: targetco-ip-registry, targetco-key-risks-memo
   - `distractor_asset_ids`: acme-internal-roadmap-2026

---

#### Shared Org-Level Project (read-only, cross-project)
`project_id: proj-org-shared`

| Filename | Type | Description |
|---|---|---|
| `org-glossary.md` | Markdown | Canonical definitions for terms and abbreviations used across all projects |
| `org-data-classification-policy.pdf` | PDF | Data handling tiers (Public, Internal, Confidential, Restricted) with handling rules per tier |
| `org-ai-usage-policy.md` | Markdown | Policy governing AI tool usage: approved providers, prohibited data classes, output review requirements |
| `org-vendor-approval-process.md` | Markdown | Process for approving new vendors — procurement, security review, legal sign-off steps |

---

#### Cross-project demo task (tests multi-store routing)

9. **Cross-project vendor compliance task** — `"Does CloudB, the infrastructure vendor we are evaluating, meet our data classification and vendor approval requirements?"`
   - Anchored to: `proj-finance-infra-q3` (primary)
   - Cross-project reads: `proj-compliance-privacy`, `proj-org-shared`
   - `required_asset_ids`: vendor-cloudB-proposal (Finance), org-data-classification-policy (Org), vendor-data-handling-requirements (Compliance)
   - `relevant_asset_ids`: vendor-comparison-matrix (Finance), org-vendor-approval-process (Org), gdpr-compliance-checklist-v3 (Compliance)
   - Expected store routing: Finance project store (primary read-write) + Compliance project store (secondary read-only) + Org shared store (secondary read-only). Validates 3-store cap and cross-store deduplication.

---

#### Asset format coverage map
Ensure the corpus exercises every v1 intake class before Session 8b is considered complete.

| Intake class | Example assets from corpus |
|---|---|
| Document upload (text-extractable) | business-case-q3-fy26.pdf, dpa-template-v2.docx, data-retention-schedule.xlsx, api-gateway-runbook.md, on-call-rotation-q2-2026.csv, vendor-cloudA-proposal.pdf |
| Document upload (image-heavy PDF) | cfo-q3-guidance.pdf, platform-sla-commitments.pdf, targetco-financial-summary-fy25.pdf |
| Image upload (OCR + caption) | service-dependency-map.png, targetco-org-chart.png |
| URL scrape | ico-guidance-legitimate-interests (scraped from ICO website and stored as normalized text) |
| Folder upload | `seed-data/proj-eng-incident-ops/` — all incident ops files ingested as a folder in Session 4 to test recursive folder ingest |
| Git repository | `platform-services-repo` (Project 3) — GitHub repo ingested via git connector in Session 5 |

---

#### Asset ID convention
Asset IDs used in eval label files, corpus tables, and API responses follow this convention: use the filename stem (filename without extension), preserving the hyphen-separated slug as written in the corpus table. Examples: `infrastructure-investment-business-case-q3-fy26.pdf` → `infrastructure-investment-business-case-q3-fy26`; `vendor-cloudB-proposal.pdf` → `vendor-cloudB-proposal`. For git repos and non-file assets, use the slug name as listed in the corpus table (e.g. `platform-services-repo`). This convention must be applied consistently in Session 4 seed scripts, Session 8c API responses, and Session 19 benchmark harness. Deviations require an explicit comment in the seed script.

#### Eval label format (per task)
Every demo task above maps to an eval case with the following label fields, used by the Session 19 benchmark harness:

```json
{
  "task_id": "task-001-npv-recommendation",
  "project_id": "proj-finance-infra-q3",
  "task_text": "Calculate the NPV of the Q3 infrastructure investment...",
  "required_asset_ids": ["business-case-q3-fy26", "cfo-q3-guidance"],
  "relevant_asset_ids": ["board-approval-memo-q2-fy26", "infrastructure-depreciation-schedule"],
  "distractor_asset_ids": ["office-lease-renewal-2024", "travel-expense-policy"],
  "cross_project_stores": [],
  "task_class": "financial-analysis",
  "specificity_requirement": true
}
```

`specificity_requirement: true` means the task cannot pass the eval gate unless every `required_asset_id` is present in the final context pack. Tasks 1, 3, 5, 6, 7, 8, 9, and 10 are specificity-required.

---

### Parallel Implementation Roadmap

#### Operating model
1. Run three tracks in parallel after foundation is ready: Platform Track, Retrieval Track, and UI Track.
	- Clarification: for an individual contributor or a single AI session, execute only the first unchecked session in order; team-level parallelism happens through different owners running different sessions in separate branches.
2. Keep sessions small: one primary deliverable per session.
3. End every session with a demo in the UI, even if the feature is behind a stub.
4. Testing policy per session:
	- Unit tests are mandatory for new logic.
	- E2E tests use **Playwright** as the standard framework for all browser-level and API-level smoke paths.
	- At least one Playwright E2E smoke path must be updated or added when user-visible behavior changes.
	- API-level sessions (no UI yet) must add a Playwright API test (using Playwright's `request` context) covering the happy path and at least one error case.
	- If full E2E is not possible yet, add a contract test and convert to a full Playwright E2E in the next dependent session.
	- Playwright tests live in `e2e/` at repo root, organised by session tag (e.g. `e2e/session-08c/`).
5. Git delivery policy per session:
	- Create or update work in a session-scoped branch.
	- Run unit and E2E checks for that session before commit.
	- Commit with a session tag in the message, for example: Session 10 - specific-file picker.
	- Push to remote immediately after commit.
	- Open or update a pull request after each session so changes are reviewable and recoverable.
6. Security policy for Git credentials:
	- Never store personal access tokens in repository files, scripts, logs, or plan documents.
	- Use local git credential manager or environment-based auth only.
	- If a token is exposed in chat or notes, rotate it before continuing repository operations.

#### Session completion checklist
1. Deliverable implemented and manually demoed.
2. Session unit tests pass.
3. Session Playwright E2E or API test passes, or contract-test fallback added with follow-up task.
4. Docs or plan updates committed.
5. Commit created with session identifier.
6. Commit pushed to remote repository.
7. Pull request opened or updated with test evidence.

#### Phase-to-session traceability
Use this table as the source of truth for reporting progress against one-pager phases.

| One-pager phase | Roadmap session mapping | Phase completion gate |
| --- | --- | --- |
| Phase 0: lay engineering foundation | Sessions 1-4 plus 1b, 1c, 1d | Repo scaffolded, tech stack locked, DB schema and RLS live, SCHEMA.md and wiki bootstrap authored, API contract designed, manifest schema valid, UI shell rendering a mocked context pack with hardcoded traceable evidence items for at least one demo task. Claude Managed Agents memory API verified: create, seed, attach, read, write paths confirmed against live Anthropic documentation and go/no-go recorded in tech stack file. |
| Phase 1: context-control MVP | Sessions 5-15 plus 5b, 8b, 8c, 8d, 8e | Project and asset lifecycle, document and image upload ingest, folder upload ingest, retrieval levels 0-2, context review, explainability, Managed Agents integration, memory-store routing and scoring, and provider abstraction are demoable in one flow. 15–25 real pilot tasks run through the complete flow. |
| Phase 2: governance hardening | Sessions 16, 16b, 17b | Immutable or signed snapshots and traces, restricted-best-match escalation, and poisoning safeguards are enforced and test-covered. |
| Phase 3: scale and low-cost ops | Sessions 17, 18, 20 | Freshness SLA, budget guardrails, and scale gates are measured and reported from automated runs. |
| Phase 4: memory-shaping ROI | Sessions 19, 19b, 21 | Shaping uplift and provider parity are shown on benchmark scorecards including real-user task mix. |
#### UI screen delivery mapping (session-by-session)
Use this map to implement the UI information architecture without ambiguity.

1. Session 3 (UI Track): task launcher shell foundation.
Deliver: app shell, navigation frame, initial project selection entrypoint, placeholder context panel.
Screens impacted: Project hub (skeleton), Task and subtask planner (placeholder).

2. Session 8 (UI Track): index dashboard early visibility.
Deliver: Project hub and early LLM wiki explorer read views.
Screens impacted: Project hub, LLM wiki explorer (read-only first pass).

2b. Session 8b (UI/Data Integration Track): project and asset management lifecycle.
Deliver: project workspace with create-project, add/remove assets, supported intake class handling, and soft-delete audit visibility.
Screens impacted: Project hub, Project workspace, Ingest operations.

2c. Session 8c (Platform API Track): external curation API contract implementation.
Deliver: first implementation of `/v1/tasks/curate`, `/v1/subtasks/{subtask_id}/curate`, and snapshot retrieval contract with auth, ACL, and idempotency semantics.
Screens impacted: Task and subtask planner (mode banner), Subtask curation (snapshot contract), Explainability and audit (API trace context).

3. Session 13 (UI Track): context review and override UX.
Deliver: Subtask curation workflow and curated memory preview with manual add/remove.
Screens impacted: Subtask curation, Task and subtask planner (editable flow).

4. Session 14 (UI Track): explainability and non-inclusion panel.
Deliver: Explainability and audit screen with inclusion/non-inclusion rationale.
Screens impacted: Explainability and audit, Subtask curation rationale overlays.

5. Session 16 (Governance Track): snapshot and audit trail.
Deliver: replayable run timeline and snapshot-linked traceability.
Screens impacted: Explainability and audit, Ingest operations (replay mode), Run event stream.

6. Session 17 (Platform Track): incremental indexing and status lifecycle.
Deliver: ingest/job state transitions and freshness state updates.
Screens impacted: Project workspace asset states, Ingest operations live timeline.

7. Session 19 (Eval Track): benchmark harness.
Deliver: synthetic-first eval metrics pipeline wired to UI.
Screens impacted: Eval command center, Eval case inspector.

8. Cross-session API integration milestone (Sessions 8c, 8d, 8e, 15, 16).
Deliver: production-mode path where external runtimes consume curated memory via API while UI remains full-observability control plane. Managed Agents I/O panel surfaces memory store operations from Session 8d. Memory-store routing events and scoring decisions from Session 8e surface in the Memory-store metadata panel.
Screens impacted: Task and subtask planner (prototype/production mode banner), Subtask curation (snapshot id contract), Explainability and audit (API trace context), Managed Agents I/O panel, Memory-store metadata panel.

Acceptance alignment rule:
- A UI screen is considered complete only when its primary interactions are demoed and its underlying events are visible through the transparency contract.
- Every screen-level acceptance must be backed by at least one Playwright E2E test that exercises the primary user flow and checks for visible transparency events.

#### Wave 0: Foundation (parallel kickoff)
1. - [x] Session 1, Platform Track: scaffold repo and baseline architecture.
Deliverable: project layout, shared types, test runner setup (Vitest for unit tests, Playwright for E2E and API tests).
Exit criteria: unit test runner and Playwright harness both execute in CI or local script; `e2e/` directory structure in place.

1b. - [x] Session 1b, Platform Track: tech stack decision, record, and API verification spike.
Deliverable: locked tech stack document committed to repo — frontend framework (Next.js recommended), backend language, API layer style (REST recommended for API-first surface), CI system, monorepo layout, and deployment target. Additionally, verify the exact Anthropic API product name, endpoint paths, and required account tier for Claude Managed Agents memory stores before any ingest sessions begin: confirm that create, seed, attach, read, and write operations work as described in this plan, confirm the deterministic file-path model (e.g. `/assets/{asset_id}.md`) is supported, and update the tech stack doc with the verified API surface and any deviations from plan assumptions. This is a go/no-go gate: if the memory store API does not exist or works materially differently, a plan amendment is required before Session 4 begins.
Exit criteria: tech stack file committed; Session 1 scaffold updated to match decisions; Claude Managed Agents memory API verified and findings documented in tech stack file; go/no-go recorded; all subsequent sessions can build without re-asking these questions.

1c. - [x] Session 1c, Data Track: database schema, migrations, RLS, and Supabase Auth setup.
Deliverable: initial Supabase migrations for all five canonical tables (assets, wiki_pages, cross_references, manifests, run_snapshots), RLS policies per table keyed to acl_scope and authenticated user entitlements, and Supabase Auth bootstrap. The `assets` table status enum must include `blocked_on_memory_write` as a valid status value alongside the standard ingest lifecycle values (pending, processing, indexed, failed, deleted) so Session 8d can set this status without a schema migration.
Exit criteria: migrations run cleanly in a local Supabase instance; RLS tests confirm unauthorized rows are invisible; `blocked_on_memory_write` status value is present in the assets status enum; Playwright API test confirms auth-gated endpoint rejects unauthenticated callers.

1d. - [ ] Session 1d, Platform Track: API contract design and OpenAPI spec.
Deliverable: OpenAPI 3.1 spec covering all v1 endpoints from the API-first integration contract, including auth scheme, ACL envelope, idempotency key convention, pagination, and error contracts. No implementation yet — spec only.
Exit criteria: spec validates cleanly; every endpoint listed in the v1 integration contract is represented; spec committed to repo so subsequent sessions implement against it.

2. - [x] Session 2, Platform Track: manifest schema and validator.
Deliverable: org memory manifest schema and validation service.
Exit criteria: valid manifest passes and invalid manifest fails with clear errors.

2b. - [ ] Session 2b, Platform Track: SCHEMA.md authoring and wiki bootstrap.
Deliverable: initial SCHEMA.md committed to repo (wiki structure, naming conventions, page-type formats, ingest workflow, query workflow, lint rules). Supabase seed migration that creates the root index.md row, the empty log.md row, and one example wiki page for each page type so Claude has a template reference.
Exit criteria: SCHEMA.md present in repo root; seed migration runs cleanly; index.md and log.md rows exist in local DB; at least one page of each type (summary, entity, concept, comparison, synthesis) exists as a seeded example.

3. - [x] Session 3, UI Track: early task launcher shell.
Depends on: Session 1b (frontend framework must be locked before UI implementation begins).
Deliverable: load manifest, enter task, view placeholder context panel.
Exit criteria: UI can run end-to-end with mocked backend responses.

#### Wave 1: Ingestion and visibility first
4. - [ ] Session 4, Data Track: seed corpus and synthetic data packs.
Deliverable: all synthetic assets defined in the **Synthetic Demo Corpus** section authored and committed under `seed-data/` with one directory per project. Eval label JSON files committed under `eval/cases/`. Seed loader script creates stub DB records for all assets directly (without requiring the full ingest pipeline) in a local Supabase instance.
Exit criteria: all 10 demo tasks have an eval label file (including task 10 alert-drift for the git connector); every asset in the corpus is discoverable from the seed loader including the `platform-services-repo` stub record; seed script is idempotent; Playwright API test confirms asset count per project matches corpus spec. Note: folder ingest pipeline smoke test (proj-eng-incident-ops folder through the real ingest pipeline) is deferred to Session 5b exit criteria after the ingest pipeline is built; git ingest pipeline smoke test (platform-services-repo) is deferred to Session 5 exit criteria.

5. - [ ] Session 5, Data Track: git connector MVP.
Deliverable: repo ingestion with lineage metadata.
Exit criteria: `platform-services-repo` from Project 3 corpus ingests successfully, produces per-file asset records assigned to `proj-eng-incident-ops` with lineage metadata, and is visible in UI inventory panel; Playwright API test covers repo ingest, per-file asset record creation, and project assignment.

5b. - [ ] Session 5b, Data Track: document upload, image ingest, and folder upload pipeline.
Deliverable: backend ingest pipeline for document uploads (PDF, docx, txt, md, csv, xlsx, pptx), image uploads (png, jpg, jpeg, tiff, webp), and folder uploads (recursive multi-file ingest across all supported types). Documents produce normalized text derivatives. Images run minimal OCR plus short caption and confidence metadata. Binary originals stored in Supabase Storage bucket with content hash. All derivatives linked to canonical asset record with provenance. Folder ingest discovers all files recursively, assigns each to the selected project, and runs the same per-file normalization pipeline.
Exit criteria: upload a PDF, a PNG, and a folder (using the `seed-data/proj-eng-incident-ops/` directory) through the API; all produce normalized text derivatives; image record includes OCR text, caption, and confidence; binary originals retrievable by signed URL; folder ingest produces one canonical asset record per file with correct project assignment; Playwright API tests cover document upload, image upload, folder upload, derivative creation, signed URL retrieval, and folder asset count.

6. - [ ] Session 6, Data Track: web or wiki connector MVP.
Deliverable: page ingestion with section metadata and timestamps.
Exit criteria: the ICO guidance URL from Project 2 corpus (`ico-guidance-legitimate-interests`) ingests successfully via URL scrape, produces a normalized text asset record assigned to `proj-compliance-privacy`, and is visible in UI; Playwright API test covers URL ingest, normalized text creation, and project assignment.

7. - [ ] Session 7, Data Track: storage connector MVP.
Deliverable: shared-folder or object-store ingestion.
Exit criteria: at least one object-store or shared-folder source ingests and produces project-assigned asset records; Playwright API test covers storage connector ingest, asset record creation, and project assignment.

8. - [ ] Session 8, UI Track: index dashboard early visibility.
Deliverable: source inventory, indexing status, freshness indicators.
Exit criteria: you can validate indexing progress after each ingestion session.

8b. - [ ] Session 8b, UI/Data Integration Track: project and asset lifecycle controls.
Deliverable: create project, select project, add asset, soft-delete asset with audit visibility across supported intake classes.
Exit criteria: user can fully manage project-scoped assets in UI and every action emits auditable events.

8c. - [ ] Session 8c, Platform API Track: external API curation surface MVP.
Deliverable: task and subtask curation endpoints plus snapshot read endpoint with ACL and idempotency.
Exit criteria: third-party caller can request curated subtask bundles and replay exact snapshot output.

8d. - [ ] Session 8d, Platform Track: Claude Managed Agents memory store integration.
Depends on: Session 5b (use stub upload path if 5b is not yet complete).
Pre-implementation note: verify the exact Anthropic API product name, endpoint paths, and required account tier for "Claude Managed Agents memory stores" (create, seed, attach, read, write operations) before implementation begins; update the tech stack doc if the name or API surface has changed since this document was authored.
Deliverable: full Managed Agents memory API integration — create and seed project memory stores, attach/detach stores per session, write canonical asset memories at ingest (deterministic paths, provenance fields), idempotent update with optimistic concurrency, and ingest completion gate that blocks until memory write succeeds. Define max-retry count and exponential backoff for Managed Agents API unavailability; on retry exhaustion set `ingest_status = blocked_on_memory_write` (not a hard failure) so the asset record is preserved and the memory write can be retried on next pass or by operator action. Implement supplemental memory paths (sessions, decisions, hypotheses, open questions, links). Emit structured events for all memory operations including retry attempts and final gate resolution. Define and implement the SCHEMA.md injection contract: specify and document exactly how SCHEMA.md is loaded into every Claude API call (system prompt prefix, context attachment file, or equivalent mechanism); include validation that the loaded SCHEMA.md version matches the current repo version before each session starts.
Exit criteria: upload an asset through Session 5b pipeline (or stub path); canonical asset memory exists at deterministic path in the project store; idempotent re-upload updates rather than duplicates; ingest is blocked when memory write fails; retry exhaustion sets `ingest_status = blocked_on_memory_write` and asset record remains intact with no data loss; SCHEMA.md injection is implemented and version check passes; Playwright API tests cover create-store, seed, idempotent update, failure-gate, retry-exhaustion paths, and SCHEMA.md version validation.

8e. - [ ] Session 8e, Platform Track: memory-store routing catalog and scoring layer.
Depends on: Sessions 2b (wiki bootstrap complete), 8d (stores exist).
Deliverable: implement Design Decision 10b — build and seed store-catalog wiki pages (one page per project memory store) with the full required routing metadata (identity, hierarchy, ACL, content signals, freshness/quality scores, operational stats, routing priors). Implement the routing scoring function: parse task intent and entities, ACL-filter candidate stores, score by intent match, hierarchy proximity, freshness, and historical helpfulness, and return a ranked store shortlist with per-store evidence targets and token budget estimates. Implement anti-bloat policy enforcement: per-subtask store-count cap (max 3 by default), per-subtask memory-file budget, and cross-store deduplication flag. Emit structured routing events for every scoring and filtering decision.
Exit criteria: given a test task anchored to a project, the routing function returns a ranked store list with per-store evidence targets and budget estimates; ACL-ineligible stores are absent from results; scoring is deterministic for the same input; budget-exceeded path triggers escalation rather than silent expansion; Playwright API test covers routing request, ACL filtering, cap enforcement, and budget-exceeded escalation path.

#### Wave 2: Retrieval core and context control
9. - [ ] Session 9, Retrieval Track: canonical metadata and file-evidence model.
Deliverable: unified asset and wiki-page/file evidence records with ACL, trust, hierarchy, provenance.
Exit criteria: each selected evidence item resolves to wiki page slug and/or file path or URL with source lineage.

10. - [ ] Session 10, Retrieval Track: Level 0 and Level 1 retrieval plus promotion gate.
Constraint: the `semantic` component of `score_breakdown` must be produced without embeddings or vector indexes (v1 constraint from the Context Rationale Schema). Allowed methods: symbolic/lexical features, taxonomy or intent matches, and LLM-judged reranking over wiki pages and metadata only. Any embedding-based method is v2-only and requires an explicit plan amendment before implementation.
Semantic scoring implementation rule: compute semantic scores offline per wiki-page update and cache the result; recompute only when relevant wiki pages are modified (cache invalidation trigger: `wiki_pages.updated_at` change for pages in the candidate set). This keeps the live retrieval path free of per-query LLM calls and compliant with low-cost prototype mode.
Deliverable: (1) task router and ranker for summary and domain retrieval with offline-cached semantic scores; (2) promotion gate — implement the memory-derived output promotion flow: validate provenance resolves to canonical assets, pass ACL check, write accepted output into `wiki_pages` / `index` / `log` with `memory_version_id → asset_id` mapping persisted in canonical audit tables. The v1 promotion path is manual-trigger only (operator action or task close); no background scheduler is required.
Exit criteria: top candidates returned with rationale and scores; no embedding model or vector index is invoked; semantic scores are read from cache, not computed live per query; a memory-derived output can be promoted into a wiki page with provenance and ACL check passing; `memory_version_id → asset_id` mapping is persisted in canonical audit tables; Playwright API test covers retrieval request with cached scores and one promotion flow scenario.

11. - [ ] Session 11, Retrieval Track: Level 2 specific-file picker.
Deliverable: evidence selector enforcing specific-file inclusion when available.
Exit criteria: NPV-style tasks include correct business-case file.

12. - [ ] Session 12, Retrieval Track: context assembler, budget caps, and cross-store deduplication.
Deliverable: deterministic context pack with token budgets by level. Cross-store deduplication: after multi-store reads, identify overlapping facts and retain one canonical evidence item per concept in the final context pack; dropped duplicates are logged in the curation manifest with deduplication reason. Curation manifest must record selected item IDs, dropped item IDs, deduplication reasons, and budget usage for every context pack produced.
Exit criteria: hard budget enforcement and stable pack ordering; cross-project Task 9 (vendor compliance, 3-store input) produces a deduplicated final pack with no duplicate evidence items; curation manifest is persisted and queryable; Playwright API test validates deduplication output for a two-store input case.

13. - [ ] Session 13, UI Track: context review and override UX.
Deliverable: inspect, add, remove, and confirm context items.
Exit criteria: user edits persist and are reflected in final payload.

14. - [ ] Session 14, UI Track: explainability and non-inclusion panel.
Deliverable: inclusion reasons and excluded-item reason codes.
Exit criteria: every included item and top excluded items are explainable in UI.

#### Wave 3: Execution, governance, and cost control
15. - [ ] Session 15, Runtime Track: provider adapter abstraction.
Deliverable: unified execution path with Claude and OpenAI adapters. Document and enforce the dual-API-key requirement: even when OpenAI is selected as the execution provider, a Claude API key is required for all memory store operations (ingest, canonical asset memory writes, store attach/detach). The UI must surface this constraint during provider selection and API key configuration — users selecting OpenAI must be shown that a Claude key is also required for the memory path. The provider abstraction layer must record this constraint in code comments and update the tech stack doc.
Exit criteria: same context pack runs against both providers; UI provider selection screen displays the dual-key requirement when OpenAI is chosen; attempting to run an OpenAI-provider task without a configured Claude key returns a clear error before execution starts; Playwright E2E test covers provider switch, dual-key validation, and missing-key error path.

16. - [ ] Session 16, Governance Track: snapshot and audit trail.
Deliverable: immutable context snapshot ID and run trace.
Exit criteria: each run is reproducible from snapshot and rationale metadata.

16b. - [ ] Session 16b, Governance Track: restricted-best-match and signed-trace enforcement.
Deliverable: escalation flow when only low-confidence or ACL-restricted evidence is available, plus immutable or signed trace verification path.
Exit criteria: restricted-best-match cases are surfaced with reason codes and trace signatures validate in replay.

17. - [ ] Session 17, Platform Track: incremental indexing and status lifecycle.
Deliverable: queue, delta detection, and freshness updates.
Exit criteria: changed sources become retrievable within SLA and reflected in dashboard.

17b. - [ ] Session 17b, Security Track: ingest poisoning controls and source trust governance.
Deliverable: source trust policy checks, stale-source demotion rules, poisoning detection or quarantine hooks, and operator override workflow.
Exit criteria: suspicious assets are blocked or quarantined with auditable reason codes before they affect retrieval.

18. - [ ] Session 18, Cost Track: low-cost execution controls.
Deliverable: retrieval-only mode, cost estimator, hard caps, kill-switch.
Exit criteria: budget gates enforce weekly and per-task limits.

#### Wave 4: Quality proof and scale proof
19. - [ ] Session 19, Eval Track: benchmark harness.
Deliverable: metrics pipeline, scenario runner, provider parity, shaping ablation.
Exit criteria: automated scorecard generated from benchmark suite.

19b. - [ ] Session 19b, Eval Track: real-user task blend and parity hardening.
Deliverable: benchmark suite extension that includes labeled real-user tasks, provider variance analysis, and anti-drift recrawl checks.
Exit criteria: scorecard reports synthetic and real-user slices separately, with pass or fail gates for parity and drift.

20. - [ ] Session 20, Scale Track: load and soak tests.
Deliverable: pilot and departmental concurrency tests plus bottleneck report.
Exit criteria: scale acceptance gates reported as pass, warning, or fail.

21. - [ ] Session 21, Program Track: pilot review and decision.
Deliverable: trust, evidence, cost, adoption report with recommendation.
Exit criteria: go, pivot, or stop decision recorded.

### Verification
1. User entrypoint works: any user can load org memory file and start a task without manual data placement.
2. Specificity check works: tasks requiring project artifacts retrieve the correct specific file (and supporting wiki page when applicable) when present.
3. Pre-run control works: users can view, add, remove, and confirm context before model execution.
4. Explainability works: every loaded item shows provenance, rank reason, timestamp, and retrieval level.
5. Incremental indexing works: newly added source appears in index status and becomes retrievable within SLA.
6. Provider abstraction works: same context pack can execute through Claude or OpenAI via API key with stable interface behavior.
7. Safety works: ACL-filtered retrieval prevents unauthorized context inclusion.
8. Evals pass: relevance, specificity, latency, token efficiency, and answer quality thresholds are met.
9. Restricted-best-match handling works: when high-confidence evidence is unavailable, escalation path is shown with machine-readable reason codes.
10. Poisoning and trust controls work: suspicious or low-trust ingest is quarantined or demoted before retrieval.
11. Audit integrity works: snapshots and run traces are immutable or signature-verifiable during replay.
12. Real-user eval mix works: benchmark scorecard includes a labeled real-user slice in addition to synthetic tasks.
13. Anti-drift safety works: scheduled recrawl or consistency checks detect stale indexes and trigger remediation.

### Acceptance Thresholds
1. Retrieval relevance lift: at least 20 percent relative improvement in nDCG at k equals 5 versus broad-load baseline.
2. File-level specificity: at least 85 percent of benchmark tasks requiring specific artifacts include the correct target file in final context.
3. User override utility: at least 70 percent of user add or remove overrides are judged helpful or neutral, with less than 10 percent harmful.
4. Token efficiency: at least 35 percent fewer input tokens than broad-load baseline at quality parity.
5. Context assembly latency: p50 under 1.5 seconds and p95 under 3.0 seconds, excluding generation time.
6. Live ingest SLA: new code or repo artifacts retrievable under 5 minutes; docs, web pages, and shared files under 30 minutes.
7. Shaping overhead budget: no more than 15 percent net token overhead per benchmark run.
8. Shaping ablation uplift: with-shaping run yields at least 8 percent relative relevance lift or at least 10 percent quality lift at similar token budget.
9. Explainability coverage: 100 percent of loaded items have rationale and provenance visible in UI.
10. ACL safety: zero violations in benchmark and demo runs.

### Low-Cost Prototype Mode
1. Retrieval-first testing default: run most experiments in no-generation mode and call LLMs only for shortlisted eval scenarios.
2. Two-stage eval policy: Stage 1 uses heuristic or offline scoring for all scenarios, Stage 2 runs paid model calls on a small gold subset only.
3. Strict token budgets by retrieval level: cap Level 0, Level 1, and Level 2 budgets independently and hard-fail pack assembly if budget is exceeded.
4. Prompt caching and reusable prefixes: cache stable org summary and policy blocks.
5. Cheap model routing for prototype: default to lowest-cost tier for shaping and draft answers, escalate only for final benchmark checkpoints.
6. Batch shaping jobs: scheduled batches during off-peak windows with capped daily token quotas.
7. Managed-memory cost controls: keep provider-native memory usage focused on compact hints, unresolved items, and stable preferences; promote only high-value outputs into canonical wiki pages.
8. Scenario sampling controls: stratified eval sampling rather than full-corpus eval on every commit.
9. Provider cost guardrails: block execution when estimated request cost exceeds per-task cap unless user explicitly overrides.
10. Daily budget kill-switch: pause non-critical LLM jobs when daily or weekly token budget is reached.

### Cost Acceptance Gates
1. Prototype spend gate: total LLM spend remains under fixed weekly budget target.
2. Per-task spend gate: at least 90 percent of task runs remain below configured cap.
3. Eval spend gate: at least 70 percent of eval scenarios execute in retrieval-only or low-cost mode.
4. Shaping spend gate: offline shaping consumes no more than 20 percent of weekly token budget.
5. Regression test gate: pull request validation runs without paid generation by default, except designated nightly benchmark runs.

### Tech Stack Decisions (locked before Session 1 implementation begins)

The following decisions must be recorded in Session 1b before any implementation starts. The recommendations below are defaults; the Session 1b deliverable may override them with explicit rationale.

- **Frontend**: Next.js (App Router) — component library TBD in Session 1b.
- **Backend**: Node.js / TypeScript on Supabase Edge Functions for ingest handlers and shaping jobs; REST API layer for the API-first surface.
- **Database**: Supabase (Postgres + RLS + Auth + Storage). No pgvector. No embedding pipeline in v1.
- **Unit tests**: Vitest.
- **E2E and API tests**: Playwright (browser E2E via `@playwright/test`; API-only tests via Playwright `request` context).
- **CI**: GitHub Actions (or equivalent); PR validation runs unit + Playwright tests without paid LLM calls.
- **Monorepo layout**: single repo, `apps/web` for frontend, `packages/` for shared types and validators, `supabase/` for migrations and edge functions, `e2e/` for all Playwright tests organised by session tag.
- **LLM provider SDK**: Anthropic SDK (primary); OpenAI SDK (secondary adapter). Both wrapped behind provider abstraction (Session 15).
- **Managed Agents**: Claude Managed Agents memory API (Anthropic). Required for all memory store operations regardless of execution provider choice. Verify the exact product name, API endpoint paths, and required account tier before Session 8d implementation begins; update this line if the name or API surface has changed since this document was authored.


1. Manifest identity fields: manifest_id, org_id, version, created_at, updated_at, owner_team, schema_version.
2. Governance fields: default_acl_policy, data_residency, retention_policy, pii_policy, audit_log_mode.
3. Source registry fields: source_id, source_type, connector, location_uri, include_patterns, exclude_patterns, polling_or_webhook_mode, freshness_sla, trust_score.
4. Hierarchy anchor fields: hierarchy_node_id, parent_node_id, node_type (org, domain, system, project), canonical_name, aliases, objective_tags.
5. Retrieval profile fields: profile_id, task_class, level_0_budget, level_1_budget, level_2_budget, rerank_policy, recency_weight, authority_weight, specificity_requirement.
6. Model routing fields: provider_allowlist, default_provider, fallback_provider, max_context_tokens, provider_caps.
7. Memory-shaping fields: shaping_enabled, shaping_frequency, allowed_shaping_outputs, promotion_rules, reviewer_required.
8. Safety and policy fields: acl_enforcement_mode, blocked_sources, blocked_tags, legal_hold_flags.
9. Index linkage fields: metadata_index_ref, wiki_index_ref, lineage_store_ref, source_registry_ref.
10. Observability fields: telemetry_sink, trace_sampling_rate, alert_thresholds, eval_scorecard_ref.

### Context Rationale Schema Definition
1. Context item identity: context_item_id, source_id, asset_id, wiki_page_slug, file_path_or_url, retrieval_level.
2. Why-loaded fields: inclusion_reason, matched_task_terms, intent_class, profile_id_used, specificity_flag.
3. Ranking evidence fields: initial_score, rerank_score, score_breakdown (semantic, keyword, recency, authority, specificity), rank_position.
4. Provenance fields: indexed_at, last_modified_at, lineage_chain, derived_or_raw, shaping_job_id.
5. Governance fields: acl_scope, user_entitlement_check, policy_filters_applied.
6. Budget fields: token_estimate, cumulative_tokens_after_add, budget_bucket (level_0, level_1, level_2).
7. User override fields: user_action (kept, removed, manually_added), override_reason, override_timestamp.
8. Execution fields: selected_for_final_pack, provider_sent_to, prompt_slot, sent_at.
9. Quality feedback fields: post_run_helpfulness, citation_used_in_answer, evaluator_label.
10. Explainability text fields: short_rationale_text and detailed_rationale_text.

Semantic scoring contract:
- `semantic` in `score_breakdown` must be produced without embeddings or vector indexes in v1. Allowed methods: symbolic or lexical features, taxonomy or intent matches, and LLM-judged reranking over wiki pages and metadata.
- Any future embedding-based method is v2-only and requires explicit plan amendment before implementation.

### Scale Proof Plan
1. Define scale axes: total indexed assets, ingest rate, concurrent users, concurrent retrieval requests, and context assembly size.
2. Build benchmark tiers: Pilot (10-20 repos, 200-500 docs), Department (50-100 repos, 2k-5k docs), Enterprise Simulation (200+ repos, 20k+ docs).
3. Generate controlled workloads with realistic bursts.
4. Run ingestion stress tests for sustained and burst updates.
5. Run retrieval stress tests at increasing concurrency and record p50, p95, p99 latency and failure rate.
6. Run end-to-end throughput tests including review actions and provider execution.
7. Validate quality under load for relevance, specificity, and ACL safety.
8. Measure cost scaling per successful task and per indexed asset.
9. Execute 24-72 hour soak test.
10. Publish pass or fail scorecard and bottleneck mitigation plan.

### Scale Acceptance Gates
1. Reliability: at least 99.5 percent successful context assembly at peak load.
2. Retrieval latency: p95 under 3.0 seconds and p99 under 5.0 seconds at target concurrency.
3. Error budgets: less than 0.5 percent retrieval failures and less than 1.0 percent ingestion failures after retries.
4. Freshness: SLA compliance of at least 95 percent during stress windows.
5. Quality stability: no more than 5 percent relative drop from low-load baseline.
6. ACL safety: zero unauthorized context inclusions across stress and soak tests.
7. Cost: per-task cost increase no more than 30 percent from Pilot to Enterprise Simulation.
8. Operability: queues recover to nominal within 15 minutes after bursts.

### Deep Research Verdict
1. Worth implementing if positioned as an organizational memory governance and context-control layer, not a generic enterprise search tool.
2. Strongest differentiation: pre-execution transparency, user context editing, and file-specific evidence enforcement.
3. Main risk: being perceived as commodity RAG unless anchored to high-stakes workflows.
4. Continue only if pilot shows decision-confidence and auditability lift, not just answer quality lift.

### Critical Missing Requirements To Include
Status: all items below must map to explicit roadmap sessions and verification checks before a production pilot.
1. Non-inclusion explainability in UI.
2. Context snapshot mode with immutable hash.
3. Restricted-best-match handling with escalation path.
4. Source trust governance and stale-source demotion.
5. Data poisoning controls at ingest.
6. Real-user tasks in eval mix.
7. Provider variance parity checks.
8. Anti-drift recrawl for index correctness.
9. Immutable or signed audit traces.
10. Cost-aware defaults for development.

### Strategic Positioning
Decision-grade AI context control for enterprises.

Primary beachhead: finance and compliance.
Secondary beachhead: incident operations and due diligence.

### Go or No-Go Gates
1. User trust: at least 80 percent of pilot users report higher confidence from pre-run context controls.
2. Evidence: at least 85 percent target-file hit rate on artifact-specific tasks.
3. Audit: 100 percent of runs produce reproducible context snapshot and rationale trail.
4. Cost: weekly spend remains within agreed prototype budget.
5. Adoption: at least three recurring teams use the launcher weekly without manual handholding.
