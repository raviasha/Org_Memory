# Tech Stack — Org Memory App

_Committed as part of Session 1b. Subsequent sessions build against this document without re-asking these questions._

---

## Decisions

### Frontend
| Concern | Decision | Rationale |
|---|---|---|
| Framework | **Next.js 14** (App Router) | Already scaffolded in `apps/web`; excellent TypeScript support, API routes eliminate a separate Node server for the prototype |
| Language | **TypeScript** | Enforced workspace-wide |
| UI library | **React 18** | Bundled with Next.js |
| Styling | **Tailwind CSS** (to add in Session 3) | Utility-first; fast iteration for transparency panels |

### Backend / API layer
| Concern | Decision | Rationale |
|---|---|---|
| API style | **REST** (Next.js Route Handlers) | API-first surface requirement; REST is predictable for third-party callers; follows plan recommendation |
| API prefix | `/api/v1/…` (app-internal) | Distinct from Supabase auto-generated endpoints |
| Auth | **Supabase Auth** + JWT passed in `Authorization: Bearer` header | Native to Supabase; consistent with RLS session model |
| Runtime | **Node.js ≥ 20** (Next.js on Vercel edge/node targets) | Already enforced by `engines` field in root `package.json` |

### Database
| Concern | Decision | Rationale |
|---|---|---|
| Database | **Supabase (PostgreSQL 15)** | Provides Postgres, Auth, Storage, and Edge Functions in one managed service; local dev via Supabase CLI |
| Schema migrations | `supabase/migrations/` with timestamp prefix | Standard Supabase CLI convention; already in use |
| RLS | Enabled on all tables, keyed to `acl_scope` and `auth.uid()` | See Session 1c migration |
| Storage bucket | `assets` bucket in Supabase Storage | Binary originals (PDFs, images); Postgres holds extracted text |

### Monorepo
| Concern | Decision | Rationale |
|---|---|---|
| Monorepo tool | **Turborepo** | Already configured in `turbo.json`; handles build ordering and caching |
| Package manager | **npm workspaces** | `package.json` `workspaces` field already in use |
| Package layout | `apps/web` (Next.js), `packages/types`, `packages/validators` | Established in Session 1 |

### Testing
| Concern | Decision | Rationale |
|---|---|---|
| Unit tests | **Vitest** | Fast, native ESM, TypeScript; already configured |
| E2E / API tests | **Playwright** | Already configured in `playwright.config.ts`; `request` context used for API-only tests that don't need a browser |
| Test organisation | `e2e/session-NN/` per session | Established in Session 1 |

### CI / CD
| Concern | Decision | Rationale |
|---|---|---|
| CI system | **GitHub Actions** | Standard; free tier covers prototype volume; secrets stored in repository settings |
| Deployment target | **Vercel** (Next.js) + **Supabase Cloud** (DB) | One-click Next.js deploy on Vercel; Supabase Cloud for managed Postgres + Auth |

---

## Claude Managed Agents Memory API — Verification Findings

_Verified against live Anthropic documentation on 2026-05-13._
_Docs URL: `https://docs.anthropic.com/en/managed-agents/memory`_

### Product name
**Claude Managed Agents** — the umbrella product. Memory persistence is provided by **memory stores**, a resource type within Managed Agents.

### Required beta header
All Managed Agents API requests must include:
```
anthropic-beta: managed-agents-2026-04-01
```
The official SDK sets this header automatically when using `client.beta.*` methods.

### Account tier
No dedicated enterprise tier is required for the prototype. The feature is currently in **beta**. Prerequisites are:
- An Anthropic Console account
- An API key

Contact Anthropic support if higher throughput / capacity limits are needed.

### Agent toolset requirement
To enable file-based memory reads and writes inside a session container, the agent must be created with the `agent_toolset_20260401` tool type:
```json
{ "type": "agent_toolset_20260401" }
```
This unlocks bash, file operations, web search, and other pre-built agent tools. Without it, the agent cannot access mounted memory stores via the filesystem.

### Memory store lifecycle endpoints (REST)

| Operation | SDK method | REST path |
|---|---|---|
| Create store | `client.beta.memory_stores.create` | `POST /v1/beta/memory-stores` |
| Retrieve store | `client.beta.memory_stores.retrieve` | `GET /v1/beta/memory-stores/{memory_store_id}` |
| Update store | `client.beta.memory_stores.update` | `PATCH /v1/beta/memory-stores/{memory_store_id}` |
| List stores | `client.beta.memory_stores.list` | `GET /v1/beta/memory-stores` |
| Archive store | `client.beta.memory_stores.archive` | `POST /v1/beta/memory-stores/{memory_store_id}/archive` |
| Delete store | `client.beta.memory_stores.delete` | `DELETE /v1/beta/memory-stores/{memory_store_id}` |

Store IDs use the `memstore_…` prefix.

### Memory CRUD endpoints (REST)

| Operation | SDK method | REST path |
|---|---|---|
| Create memory | `client.beta.memory_stores.memories.create` | `POST /v1/beta/memory-stores/{memory_store_id}/memories` |
| Retrieve memory | `client.beta.memory_stores.memories.retrieve` | `GET /v1/beta/memory-stores/{memory_store_id}/memories/{memory_id}` |
| Update memory | `client.beta.memory_stores.memories.update` | `PATCH /v1/beta/memory-stores/{memory_store_id}/memories/{memory_id}` |
| List memories | `client.beta.memory_stores.memories.list` | `GET /v1/beta/memory-stores/{memory_store_id}/memories` |
| Delete memory | `client.beta.memory_stores.memories.delete` | `DELETE /v1/beta/memory-stores/{memory_store_id}/memories/{memory_id}` |

Memory versions (audit trail):

| Operation | REST path |
|---|---|
| List versions | `GET /v1/beta/memory-stores/{memory_store_id}/memory-versions` |
| Retrieve version | `GET /v1/beta/memory-stores/{memory_store_id}/memory-versions/{memory_version_id}` |
| Redact version | `POST /v1/beta/memory-stores/{memory_store_id}/memory-versions/{memory_version_id}/redact` |

Version IDs use the `memver_…` prefix. Versions are retained for 30 days.

### Session creation with memory stores attached

Memory stores are attached via the `resources[]` array at session creation time. **They cannot be attached to a running session.**

```json
{
  "agent": "<agent_id>",
  "environment_id": "<environment_id>",
  "resources": [
    {
      "type": "memory_store",
      "memory_store_id": "<store_id>",
      "access": "read_write",
      "instructions": "Project memory for this task. Check before starting."
    }
  ]
}
```

Access values: `read_write` (default) or `read_only`.

### How the agent accesses memory during a session

Each attached store is mounted inside the session container at:
```
/mnt/memory/<store_name>/
```
The agent reads and writes files at this path using standard agent toolset file operations (same tools used for the rest of the filesystem). Writes are persisted back to the store automatically. Reads and writes appear in the session event stream as `agent.tool_use` / `agent.tool_result` events.

### Deterministic file-path model — CONFIRMED ✓

The plan's proposed path convention (`/assets/{asset_id}.md`) is **fully supported**. Memory paths are arbitrary strings. Example paths from docs: `/formatting_standards.md`, `/preferences/formatting.md`, `/archive/2026_q1_formatting.md`. The plan's canonical asset path (`/assets/{asset_id}.md`) and supplemental paths (`/sessions/*`, `/decisions/*`, etc.) are all valid.

### Seeding a store before any session runs — CONFIRMED ✓

Pre-loading content before a session is explicitly supported:
```bash
# CLI example
ant beta:memory-stores:memories create \
  --memory-store-id "$store_id" \
  --path "/assets/some-asset-id.md" \
  --content "Normalized text of the asset..."
```

### Optimistic concurrency — CONFIRMED ✓

`memories.update` accepts a `content_sha256` precondition. If the hash no longer matches the live content, the update is rejected so the caller can re-read and retry. This is the mechanism for safe concurrent writes described in the plan.

### Limits
- **Maximum 8 memory stores per session** (matches the plan's cap; plan defaults should stay well below this)
- **Individual memory size cap**: 100 kB per memory file (~25 k tokens). Design memory as many small, focused files rather than a few large ones.
- **Version retention**: 30 days (recent versions always kept regardless of age)
- Archiving a store is **one-way** (no unarchive)

### Deviations from plan assumptions

| Plan assumption | Reality | Impact |
|---|---|---|
| Plan calls this "Claude Managed Agents memory stores" | Correct product name; no deviation | None |
| Up to 8 stores per session | Confirmed. Plan defaults (1–3) remain appropriate | None |
| Deterministic `/assets/{asset_id}.md` paths | Confirmed. Paths are arbitrary strings | None |
| `read_write` and `read_only` access modes | Confirmed | None |
| Memory versions with version IDs | Confirmed. IDs use `memver_…` prefix | None |
| Attach stores before execution | Confirmed. Cannot attach to a running session | Scheduling constraint: store must be created and populated before session start |
| `memory_version_id → asset_id` audit mapping | Implementable via memory content and `content_sha256`; no native cross-reference field on version objects | Application must store `asset_id` inside the memory content or as a separate provenance memory |

### Go / No-Go Decision

**GO** ✅

The Claude Managed Agents memory store API exists, is publicly documented, and supports all operations required by the plan: create, seed, attach, read, write, optimistic-concurrency update, and versioned audit trail. Deterministic file paths are fully supported. The 100 kB per-memory limit is the only structural constraint to design around — enforce it in the ingest pipeline (Session 4) by splitting large normalized texts across multiple memory files when needed.

No plan amendment is required before Session 4.

---

## Summary — What subsequent sessions should assume

1. **All app code is TypeScript**. No JavaScript files except `next.config.js`.
2. **API routes** live in `apps/web/src/app/api/v1/…` (Next.js Route Handlers).
3. **Supabase client** is initialised server-side in API routes using the service-role key; browser-side using the anon key + Supabase Auth JWT.
4. **Anthropic SDK** is the official `@anthropic-ai/sdk` package. Use `client.beta.*` methods for all Managed Agents operations.
5. **Beta header** `managed-agents-2026-04-01` is sent automatically by the SDK but must be included in raw `curl` / Playwright API tests.
6. **Memory store IDs** (`memstore_…`) are stored in the `manifests` or a dedicated `memory_stores` table in Supabase so the application can attach the correct store for each project/session without calling the Anthropic list endpoint on every request.
7. **Agent and environment IDs** are long-lived, created once per deployment environment, and stored in environment variables (`ANTHROPIC_AGENT_ID`, `ANTHROPIC_ENVIRONMENT_ID`).
8. **Individual memory files** must stay under 100 kB. The ingest pipeline must chunk or summarise content that exceeds this limit.
9. **Memory paths** follow the convention defined in the plan: `/assets/{asset_id}.md` for canonical asset memories, and `/sessions/*`, `/decisions/*`, etc. for supplemental memories.
