/**
 * lib/evidence-resolver.ts — Session 9
 *
 * Canonical metadata and file-evidence model resolver.
 *
 * Provides:
 *   - listEvidence(filters)    → paginated EvidenceItem list (DB query)
 *   - resolveEvidence(id)      → EvidenceItemResolved with full lineage
 *   - refreshEvidenceForProject(project_id)  → re-sync evidence_items from
 *                                              assets + wiki_pages for a project
 *
 * The evidence_items table is the primary persistence layer.  The triggers
 * trg_evidence_from_asset and trg_evidence_from_wiki_page keep it in sync
 * automatically.  refreshEvidenceForProject() is a manual escape hatch for
 * bulk re-sync after bulk imports or schema changes.
 */

// ---------------------------------------------------------------------------
// Inlined types (mirrors packages/types/src/index.ts — path alias not resolved
// by Next.js compiler in this monorepo setup)
// ---------------------------------------------------------------------------

export type RetrievalLevel = "level_0" | "level_1" | "level_2";
export type EvidenceType = "asset" | "wiki_page" | "hybrid";

export interface EvidenceItem {
  evidence_id: string;
  org_id: string;
  project_id: string;
  evidence_type: EvidenceType;
  asset_id: string | null;
  wiki_page_id: string | null;
  wiki_page_slug: string | null;
  file_path_or_url: string | null;
  title: string;
  summary_snippet: string;
  retrieval_level: RetrievalLevel;
  trust_score: number;
  keyword_hints: string[];
  acl_scope: string;
  hierarchy_path: string;
  lineage_chain: string[];
  provenance_hash: string | null;
  source_asset_ids: string[];
  created_at: string;
  updated_at: string;
  last_refreshed_at: string;
}

interface LineageAsset {
  asset_id: string;
  project_id?: string;
  source_type?: string;
  file_path_or_url: string | null;
  acl_scope?: string;
  ingest_status?: string;
  content_hash?: string | null;
  ingested_at?: string;
}

interface LineageWikiPage {
  page_id: string;
  slug: string;
  title: string;
  page_type?: string;
  source_asset_ids?: string[];
  acl_scope?: string;
  updated_at?: string;
}

export interface EvidenceItemResolved extends EvidenceItem {
  lineage_resolved: {
    asset: LineageAsset | null;
    wiki_page: LineageWikiPage | null;
    contributing_assets: LineageAsset[];
  };
}

// ---------------------------------------------------------------------------
// Types used internally
// ---------------------------------------------------------------------------

export interface EvidenceFilters {
  project_id?: string;
  org_id?: string;
  retrieval_level?: RetrievalLevel;
  acl_scope?: string;
  evidence_type?: "asset" | "wiki_page" | "hybrid";
  /** Max rows to return (default 50, max 200). */
  limit?: number;
  /** Opaque cursor: evidence_id of the last seen row. */
  cursor?: string;
}

export interface EvidenceListResult {
  data: EvidenceItem[];
  pagination: {
    has_more: boolean;
    next_cursor: string | null;
    total_count: number;
  };
}

// ---------------------------------------------------------------------------
// DB row type (subset of evidence_items columns we select)
// ---------------------------------------------------------------------------

interface EvidenceRow {
  evidence_id: string;
  org_id: string;
  project_id: string;
  evidence_type: "asset" | "wiki_page" | "hybrid";
  asset_id: string | null;
  wiki_page_id: string | null;
  wiki_page_slug: string | null;
  file_path_or_url: string | null;
  title: string;
  summary_snippet: string;
  retrieval_level: RetrievalLevel;
  trust_score: number;
  keyword_hints: string[];
  acl_scope: string;
  hierarchy_path: string;
  lineage_chain: string[];
  provenance_hash: string | null;
  source_asset_ids: string[];
  created_at: string;
  updated_at: string;
  last_refreshed_at: string;
}

function rowToItem(row: EvidenceRow): EvidenceItem {
  return {
    evidence_id: row.evidence_id,
    org_id: row.org_id,
    project_id: row.project_id,
    evidence_type: row.evidence_type,
    asset_id: row.asset_id,
    wiki_page_id: row.wiki_page_id,
    wiki_page_slug: row.wiki_page_slug,
    file_path_or_url: row.file_path_or_url,
    title: row.title,
    summary_snippet: row.summary_snippet,
    retrieval_level: row.retrieval_level,
    trust_score: row.trust_score,
    keyword_hints: row.keyword_hints ?? [],
    acl_scope: row.acl_scope,
    hierarchy_path: row.hierarchy_path,
    lineage_chain: row.lineage_chain ?? [],
    provenance_hash: row.provenance_hash,
    source_asset_ids: row.source_asset_ids ?? [],
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_refreshed_at: row.last_refreshed_at,
  };
}

// ---------------------------------------------------------------------------
// Static corpus — evidence items derived from the synthetic demo corpus
// (mirrors the seed-data directory; used when Supabase is unavailable)
// ---------------------------------------------------------------------------

function makeAssetItem(
  id: string,
  projectId: string,
  filePath: string,
  aclScope: string,
  trustScore: number,
  level: RetrievalLevel,
): EvidenceItem {
  const stem = filePath.replace(/^.*\//, "").replace(/\.[^.]+$/, "");
  return {
    evidence_id: id,
    org_id: "00000000-0000-0000-0000-000000000001",
    project_id: projectId,
    evidence_type: "asset",
    asset_id: id,
    wiki_page_id: null,
    wiki_page_slug: null,
    file_path_or_url: filePath,
    title: stem,
    summary_snippet: `Source file: ${filePath}`,
    retrieval_level: level,
    trust_score: trustScore,
    keyword_hints: [stem],
    acl_scope: aclScope,
    hierarchy_path: `${aclScope}/${projectId}`,
    lineage_chain: [projectId, id],
    provenance_hash: null,
    source_asset_ids: [id],
    created_at: "2026-05-01T00:00:00Z",
    updated_at: "2026-05-01T00:00:00Z",
    last_refreshed_at: "2026-05-01T00:00:00Z",
  };
}

function makeWikiItem(
  id: string,
  projectId: string,
  slug: string,
  title: string,
  aclScope: string,
  level: RetrievalLevel,
): EvidenceItem {
  return {
    evidence_id: `wiki-${id}`,
    org_id: "00000000-0000-0000-0000-000000000001",
    project_id: projectId,
    evidence_type: "wiki_page",
    asset_id: null,
    wiki_page_id: id,
    wiki_page_slug: slug,
    file_path_or_url: null,
    title,
    summary_snippet: `Wiki page: ${title}`,
    retrieval_level: level,
    trust_score: level === "level_0" ? 0.95 : 0.80,
    keyword_hints: [slug, title],
    acl_scope: aclScope,
    hierarchy_path: `${aclScope}/${projectId}`,
    lineage_chain: [projectId, id],
    provenance_hash: null,
    source_asset_ids: [],
    created_at: "2026-05-01T00:00:00Z",
    updated_at: "2026-05-01T00:00:00Z",
    last_refreshed_at: "2026-05-01T00:00:00Z",
  };
}

const STATIC_EVIDENCE_CORPUS: EvidenceItem[] = [
  // ── Finance: Q3 FY26 Infrastructure Investment ──────────────────────────
  makeAssetItem("a1001", "proj-finance-infra-q3", "seed-data/proj-finance-infra-q3/infrastructure-investment-business-case-q3-fy26.pdf", "org:acme", 0.90, "level_2"),
  makeAssetItem("a1002", "proj-finance-infra-q3", "seed-data/proj-finance-infra-q3/cfo-q3-guidance.pdf", "org:acme", 0.90, "level_2"),
  makeAssetItem("a1003", "proj-finance-infra-q3", "seed-data/proj-finance-infra-q3/vendor-comparison-matrix.xlsx", "org:acme", 0.90, "level_2"),
  makeAssetItem("a1004", "proj-finance-infra-q3", "seed-data/proj-finance-infra-q3/it-infrastructure-rfp-2026.docx", "org:acme", 0.90, "level_2"),
  makeAssetItem("a1005", "proj-finance-infra-q3", "seed-data/proj-finance-infra-q3/board-approval-memo-q2-fy26.md", "org:acme", 0.90, "level_2"),
  makeAssetItem("a1006", "proj-finance-infra-q3", "seed-data/proj-finance-infra-q3/infrastructure-depreciation-schedule.csv", "org:acme", 0.90, "level_2"),
  makeAssetItem("a1007", "proj-finance-infra-q3", "seed-data/proj-finance-infra-q3/vendor-cloudA-proposal.pdf", "org:acme", 0.90, "level_2"),
  makeAssetItem("a1008", "proj-finance-infra-q3", "seed-data/proj-finance-infra-q3/vendor-cloudB-proposal.pdf", "org:acme", 0.90, "level_2"),
  makeWikiItem("wp1001", "proj-finance-infra-q3", "proj-finance-infra-q3/index", "Finance Infra Q3 Index", "org:acme", "level_0"),
  makeWikiItem("wp1002", "proj-finance-infra-q3", "proj-finance-infra-q3/npv-analysis", "NPV Analysis Summary", "org:acme", "level_1"),

  // ── Compliance / Privacy ─────────────────────────────────────────────────
  makeAssetItem("a2001", "proj-compliance-privacy", "seed-data/proj-compliance-privacy/gdpr-compliance-checklist-v3.md", "org:acme", 0.90, "level_2"),
  makeAssetItem("a2002", "proj-compliance-privacy", "seed-data/proj-compliance-privacy/privacy-incident-response-playbook.md", "org:acme", 0.90, "level_2"),
  makeWikiItem("wp2001", "proj-compliance-privacy", "proj-compliance-privacy/index", "Compliance Privacy Index", "org:acme", "level_0"),

  // ── Engineering: Incident Operations ─────────────────────────────────────
  makeAssetItem("a3001", "proj-eng-incident-ops", "seed-data/proj-eng-incident-ops/api-gateway-runbook.md", "org:acme", 0.90, "level_2"),
  makeAssetItem("a3002", "proj-eng-incident-ops", "seed-data/proj-eng-incident-ops/database-failover-runbook.md", "org:acme", 0.90, "level_2"),
  makeAssetItem("a3003", "proj-eng-incident-ops", "seed-data/proj-eng-incident-ops/incident-postmortem-2026-03-15.md", "org:acme", 0.90, "level_2"),
  makeAssetItem("a3004", "proj-eng-incident-ops", "seed-data/proj-eng-incident-ops/alert-thresholds-config.yml", "org:acme", 0.85, "level_2"),
  makeAssetItem("a3005", "proj-eng-incident-ops", "seed-data/proj-eng-incident-ops/on-call-rotation-q2-2026.csv", "org:acme", 0.85, "level_2"),
  makeAssetItem("a3006", "proj-eng-incident-ops", "seed-data/proj-eng-incident-ops/platform-services-repo", "org:acme", 0.85, "level_1"),
  makeWikiItem("wp3001", "proj-eng-incident-ops", "proj-eng-incident-ops/index", "Engineering Incident Ops Index", "org:acme", "level_0"),

  // ── CorpDev: TargetCo Due Diligence ──────────────────────────────────────
  makeAssetItem("a4001", "proj-corpdev-targetco-dd", "seed-data/proj-corpdev-targetco-dd/targetco-key-risks-memo.md", "org:acme", 0.90, "level_2"),
  makeAssetItem("a4002", "proj-corpdev-targetco-dd", "seed-data/proj-corpdev-targetco-dd/targetco-tech-stack-assessment.md", "org:acme", 0.90, "level_2"),
  makeWikiItem("wp4001", "proj-corpdev-targetco-dd", "proj-corpdev-targetco-dd/index", "TargetCo Due Diligence Index", "org:acme", "level_0"),

  // ── Org Shared ────────────────────────────────────────────────────────────
  makeWikiItem("wp5001", "proj-org-shared", "root/index", "Org Memory Root Index", "org:acme", "level_0"),
  makeWikiItem("wp5002", "proj-org-shared", "root/log", "Org Memory Activity Log", "org:acme", "level_0"),
  makeWikiItem("wp5003", "proj-org-shared", "stores/org-shared-catalog", "Org Shared Memory Store Catalog", "org:acme", "level_1"),
];

// ---------------------------------------------------------------------------
// In-memory fallback store (used when Supabase is unavailable in dev/test)
// ---------------------------------------------------------------------------

type FallbackStore = {
  items: EvidenceItem[];
};

const GLOBAL_KEY = "__evidence_fallback_store__";
declare const globalThis: { [GLOBAL_KEY]?: FallbackStore };

function getFallbackStore(): FallbackStore {
  if (!globalThis[GLOBAL_KEY]) {
    globalThis[GLOBAL_KEY] = { items: STATIC_EVIDENCE_CORPUS };
  }
  return globalThis[GLOBAL_KEY]!;
}

// ---------------------------------------------------------------------------
// listEvidence
// ---------------------------------------------------------------------------

export async function listEvidence(
  filters: EvidenceFilters = {},
): Promise<EvidenceListResult> {
  const limit = Math.min(filters.limit ?? 50, 200);

  // ── Try Supabase ──────────────────────────────────────────────────────────
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (supabaseUrl && supabaseKey) {
    try {
      const { createClient } = await import("@supabase/supabase-js");
      const db = createClient(supabaseUrl, supabaseKey, {
        auth: { persistSession: false },
      });

      let query = db
        .from("evidence_items")
        .select("*", { count: "exact" })
        .order("evidence_id", { ascending: true })
        .limit(limit + 1); // fetch one extra to determine has_more

      if (filters.project_id)       query = query.eq("project_id", filters.project_id);
      if (filters.org_id)           query = query.eq("org_id", filters.org_id);
      if (filters.retrieval_level)  query = query.eq("retrieval_level", filters.retrieval_level);
      if (filters.acl_scope)        query = query.eq("acl_scope", filters.acl_scope);
      if (filters.evidence_type)    query = query.eq("evidence_type", filters.evidence_type);
      if (filters.cursor)           query = query.gt("evidence_id", filters.cursor);

      const { data, error, count } = await query;

      if (error) throw error;

      const rows = (data ?? []) as EvidenceRow[];
      const hasMore = rows.length > limit;
      const pageRows = hasMore ? rows.slice(0, limit) : rows;

      return {
        data: pageRows.map(rowToItem),
        pagination: {
          has_more: hasMore,
          next_cursor: hasMore ? pageRows[pageRows.length - 1].evidence_id : null,
          total_count: count ?? pageRows.length,
        },
      };
    } catch {
      // Fall through to in-memory store
    }
  }

  // ── In-memory fallback ────────────────────────────────────────────────────
  const store = getFallbackStore();
  let items = [...store.items];

  if (filters.project_id)      items = items.filter(i => i.project_id === filters.project_id);
  if (filters.org_id)          items = items.filter(i => i.org_id === filters.org_id);
  if (filters.retrieval_level) items = items.filter(i => i.retrieval_level === filters.retrieval_level);
  if (filters.acl_scope)       items = items.filter(i => i.acl_scope === filters.acl_scope);
  if (filters.evidence_type)   items = items.filter(i => i.evidence_type === filters.evidence_type);
  if (filters.cursor) {
    const idx = items.findIndex(i => i.evidence_id === filters.cursor);
    if (idx >= 0) items = items.slice(idx + 1);
  }

  const hasMore = items.length > limit;
  const pageItems = hasMore ? items.slice(0, limit) : items;

  return {
    data: pageItems,
    pagination: {
      has_more: hasMore,
      next_cursor: hasMore ? pageItems[pageItems.length - 1].evidence_id : null,
      total_count: store.items.length,
    },
  };
}

// ---------------------------------------------------------------------------
// resolveEvidence
// ---------------------------------------------------------------------------

export async function resolveEvidence(
  evidenceId: string,
): Promise<EvidenceItemResolved | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (supabaseUrl && supabaseKey) {
    try {
      const { createClient } = await import("@supabase/supabase-js");
      const db = createClient(supabaseUrl, supabaseKey, {
        auth: { persistSession: false },
      });

      // 1. Fetch the evidence item
      const { data: evData, error: evErr } = await db
        .from("evidence_items")
        .select("*")
        .eq("evidence_id", evidenceId)
        .single();

      if (evErr || !evData) return null;

      const item = rowToItem(evData as EvidenceRow);

      // 2. Resolve linked asset (if any)
      let asset = null;
      if (item.asset_id) {
        const { data: assetData } = await db
          .from("assets")
          .select(
            "asset_id, project_id, source_type, file_path_or_url, acl_scope, ingest_status, content_hash, ingested_at",
          )
          .eq("asset_id", item.asset_id)
          .single();
        asset = assetData ?? null;
      }

      // 3. Resolve linked wiki page (if any)
      let wikiPage = null;
      if (item.wiki_page_id) {
        const { data: wpData } = await db
          .from("wiki_pages")
          .select("page_id, slug, title, page_type, source_asset_ids, acl_scope, updated_at")
          .eq("page_id", item.wiki_page_id)
          .single();
        wikiPage = wpData ?? null;
      }

      // 4. Resolve contributing assets (source_asset_ids that are valid UUIDs)
      let contributingAssets: EvidenceItemResolved["lineage_resolved"]["contributing_assets"] =
        [];
      if (item.source_asset_ids.length > 0) {
        // Filter to valid UUID-shaped strings only
        const uuids = item.source_asset_ids.filter((id: string) =>
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id),
        );
        if (uuids.length > 0) {
          const { data: contribData } = await db
            .from("assets")
            .select("asset_id, file_path_or_url, source_type, content_hash")
            .in("asset_id", uuids);
          contributingAssets = (contribData ?? []) as typeof contributingAssets;
        }
      }

      return {
        ...item,
        lineage_resolved: {
          asset,
          wiki_page: wikiPage,
          contributing_assets: contributingAssets,
        },
      };
    } catch {
      // Fall through to in-memory store
    }
  }

  // ── In-memory fallback ────────────────────────────────────────────────────
  const store = getFallbackStore();
  const item = store.items.find(i => i.evidence_id === evidenceId) ?? null;
  if (!item) return null;

  // Build synthetic lineage_resolved from the item's own fields
  const resolvedAsset: LineageAsset | null = item.asset_id
    ? {
        asset_id: item.asset_id,
        file_path_or_url: item.file_path_or_url,
        source_type: "file",
        acl_scope: item.acl_scope,
        ingest_status: "completed",
        content_hash: item.provenance_hash ?? null,
        ingested_at: item.created_at,
      }
    : null;

  const resolvedWikiPage: LineageWikiPage | null = item.wiki_page_id
    ? {
        page_id: item.wiki_page_id,
        slug: item.wiki_page_slug ?? "",
        title: item.title,
        page_type: "index",
        source_asset_ids: item.source_asset_ids,
        acl_scope: item.acl_scope,
        updated_at: item.updated_at,
      }
    : null;

  return {
    ...item,
    lineage_resolved: {
      asset: resolvedAsset,
      wiki_page: resolvedWikiPage,
      contributing_assets: [],
    },
  };
}

// ---------------------------------------------------------------------------
// refreshEvidenceForProject  (manual re-sync escape hatch)
// ---------------------------------------------------------------------------

export async function refreshEvidenceForProject(
  projectId: string,
): Promise<{ refreshed_assets: number; refreshed_wiki_pages: number }> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return { refreshed_assets: 0, refreshed_wiki_pages: 0 };
  }

  const { createClient } = await import("@supabase/supabase-js");
  const db = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });

  // Count first, then trigger re-evaluation by touching updated_at.
  // The DB triggers will handle the actual evidence_items upsert.
  const { count: assetCount } = await db
    .from("assets")
    .select("asset_id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .neq("ingest_status", "deleted");

  await db
    .from("assets")
    .update({ last_modified_at: new Date().toISOString() })
    .eq("project_id", projectId)
    .neq("ingest_status", "deleted");

  // For wiki pages, query by slug prefix matching the project_id
  const { count: wikiCount } = await db
    .from("wiki_pages")
    .select("page_id", { count: "exact", head: true })
    .like("slug", `${projectId}/%`);

  await db
    .from("wiki_pages")
    .update({ updated_at: new Date().toISOString() })
    .like("slug", `${projectId}/%`);

  return {
    refreshed_assets: assetCount ?? 0,
    refreshed_wiki_pages: wikiCount ?? 0,
  };
}
