# Org Memory Task Launcher: One-Pager

## Vision
Any employee can start AI-assisted work by loading one organizational memory manifest, describing a task, reviewing exactly what context was selected, editing that context if needed, and then running execution on Claude or OpenAI.

## Problem
Enterprise AI assistants fail in high-stakes work because users cannot reliably see or control what evidence is loaded.

Common failure modes:
- Wrong or stale documents included.
- Critical specific files not included.
- No audit trail for why context was chosen.
- Limited governance and weak ACL guarantees.
- Rising token costs with little predictability.

## Product Thesis
Treat the context pack as a first-class product object.

The system should:
1. Auto-select context progressively from org memory.
2. Use the LLM wiki both as the cross-project knowledge graph and as a compiled store-catalog routing layer for memory-store selection.
3. Enforce specific-file evidence when tasks require it.
4. Show per-item rationale and provenance before execution.
5. Let users add or remove context before run.
6. Execute with provider choice at runtime.
7. Use Claude Managed Agents memory stores as the primary project memory layer.
8. Enforce subtask memory routing limits: maximum 3 stores per subtask, then discovery+curation to build a minimal subtask memory bundle.
9. Materialize a task-scoped workspace from selected artifacts, defaulting to ephemeral unless reuse thresholds are met.
10. Require project assignment at asset upload time: select existing project or create a custom one inline.
11. Support asset intake classes: documents, images, URLs to scrape, and folders containing files.
12. Support in-app project and asset management lifecycle: create project, add assets, and remove assets with audit visibility.
13. Treat one canonical memory per asset as mandatory while allowing supplemental memories for continuity.
14. Normalize all ingested assets inside this platform (including images via minimal OCR plus caption in v1), while preserving binary originals for export and audit.
15. Expose full background transparency in UI: ingest stages, raw vs normalized asset views, Claude Managed Agents I/O, memory-store metadata, and LLM wiki structure so users and developers can monitor progress.
16. Use a concrete UI screen model: project hub, project workspace, ingest operations, task/subtask planner, subtask curation, explainability and audit, wiki explorer, and eval command center.

## Why This Is Compelling
This is not another enterprise search tool.

Differentiation:
- Pre-execution transparency and editability.
- Decision-grade evidence controls.
- File-level specificity enforcement.
- Immutable context snapshots for auditability.
- Provider-agnostic execution with one retrieval stack.

## Core Workflow
1. User loads org memory manifest.
2. User uploads assets by selecting an existing project or creating a custom project.
3. User can upload document files, images, provide URLs for scraping, or upload folders of files.
4. User opens a base project and provides objective context.
5. System retrieves progressively:
   - Level 0: org and domain summary.
   - Level 1: task-relevant systems or docs.
   - Level 2: specific wiki pages and files.
6. On ingest, each asset goes through a two-step sequence: (Step 1) canonical asset record with normalized text derivative written to DB; (Step 2) canonical asset memory written to Managed Agents memory store at a deterministic path with required provenance fields and asset linkage metadata. Ingest completion is gated on Step 2 succeeding; on API unavailability the system retries up to a configured max-retry count, then sets `ingest_status = blocked_on_memory_write` so the asset record is preserved for retry without data loss.
7. Claude can create supplemental memories beyond asset count during ingest and runtime.
8. In prototype mode, the app can generate task and subtask plan; user can edit.
9. During inference, task is decomposed into subtasks.
10. Store-catalog wiki pages are loaded first to route which memory stores are candidates for each subtask.
11. System selects up to 3 stores for a subtask, runs a lightweight discovery pass, then curates only needed memory items plus required assets.
12. UI shows full trace and curated memory for each subtask: selected stores, selected and dropped memories, selected assets, reasons, and budget usage.
13. UI also shows ingest and memory internals: what was extracted from each asset, where raw originals are stored, what was sent to Managed Agents, what came back per memory store, and how store metadata drove routing.
14. Curated context package is handed off via API to execution platform (Claude/OpenAI path in-app or external orchestrator), with controlled raw-asset export descriptors when binary originals are required.
15. Output and context snapshot are logged for reproducibility, then promoted to durable wiki memory if accepted.

Wiki construction model:
- Base wiki synthesis comes from canonical project artifacts.
- Accepted memory-derived outputs from Managed Agents sessions are promoted into wiki pages with provenance.

v1 boundary:
- Product scope includes curated subtask context packaging, transparent review, and first-party execution for demoable end-to-end runs.
- Prototype mode runs execution in-app by default; the same curated package can also be delegated to an external orchestrator via API.
- Third-party runtimes consume normalized context and controlled asset exports; they are not responsible for canonical asset normalization.
- Prototype mode prioritizes in-app generation and display of tasks, subtasks, and curated memory per subtask.
- Production usage keeps project/asset management in-app while external runtimes consume curated memory through API.
- Ingest always uses the Claude Managed Agents memory API for canonical asset memory writes regardless of execution provider choice. Provider selection (Claude vs. OpenAI) applies only to the subtask execution step.
- Folder upload (recursive ingest of multi-file collections) is in-scope for v1.

## High-Value Use Cases
- Finance: NPV and investment decisions with project-specific business case evidence.
- Compliance and legal: policy-grounded decisions with traceable sources.
- Incident operations: rapid runbook plus prior-incident evidence.
- Due diligence: cross-source, auditable context assembly.

## Build Strategy
Phase 0: Lay engineering foundation — scaffold repo, define tech stack, establish DB schema and RLS, author SCHEMA.md and wiki bootstrap, define API contract, build manifest schema and UI shell. Gate: seed pilot scenarios exist, UI shell renders a mocked context pack with hardcoded traceable evidence items for at least one demo task, and Claude Managed Agents memory API is verified with go/no-go recorded in the tech stack file.
Phase 1: Ship context-control MVP with review, provider adapters, and task workspace orchestration. Validate value by running 15 to 25 real pilot tasks through the full flow.
Phase 2: Add governance hardening, immutable audit trails, and promotion policy for persistent cross-project workspaces.
Phase 3: Prove scale and low-cost operations.
Phase 4: Prove memory-shaping ROI.

## Success Metrics
- Relevance lift: at least 20 percent improvement in nDCG at k equals 5.
- Specific file hit rate: at least 85 percent on artifact-specific tasks.
- User trust: at least 80 percent report higher confidence due to context review controls.
- ACL safety: zero unauthorized context inclusions.
- Token efficiency: at least 35 percent lower input tokens than broad-load baseline.
- Cost discipline: weekly spend stays within prototype budget caps.

## Go or No-Go Criteria
Continue if all are true:
1. Pilot users report measurable trust uplift.
2. Specific-file retrieval accuracy meets threshold.
3. Every run produces reproducible context snapshot and rationale trace.
4. Costs remain within controlled prototype budgets.
5. At least three teams use the workflow weekly.

## Strategic Positioning
Decision-grade AI context governance for enterprises.

Not a replacement for enterprise search portals in v1.
Position as the context control layer that makes AI outputs trustworthy, auditable, and cost-predictable in high-stakes work.
