"use client";

/**
 * AssetInventory — Session 5
 *
 * Client component that:
 *   1. Fetches assets from GET /api/v1/assets (with optional project filter).
 *   2. Provides a one-click git ingest action for the prototype corpus.
 *   3. Renders a simple table showing asset metadata including lineage.
 */

import { useState, useEffect, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types (lightweight, not importing from @org-memory/types to avoid SSR edge)
// ---------------------------------------------------------------------------

interface LineageMeta {
  repo_url?: string;
  repo_slug?: string;
  branch?: string;
  relative_path?: string;
  ingest_run_id?: string;
  folder_path?: string;
  [key: string]: unknown;
}

interface AssetRow {
  asset_id: string;
  project_id: string;
  source_type: string;
  file_path_or_url: string;
  ingest_status: string;
  ingested_at: string;
  parent_asset_id: string | null;
  lineage_metadata: LineageMeta;
}

interface AssetsResponse {
  data: AssetRow[];
  pagination: { has_more: boolean; next_cursor: string | null; total_count: number | null };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROJECTS = [
  { id: "", label: "All projects" },
  { id: "proj-finance-infra-q3", label: "Finance — Infra Q3" },
  { id: "proj-compliance-privacy", label: "Legal/Compliance" },
  { id: "proj-eng-incident-ops", label: "Engineering — Incident Ops" },
  { id: "proj-corpdev-targetco-dd", label: "CorpDev — TargetCo DD" },
  { id: "proj-org-shared", label: "Org Shared" },
];

const SOURCE_TYPE_BADGE: Record<string, { label: string; color: string }> = {
  document: { label: "doc", color: "#2563eb" },
  image: { label: "img", color: "#7c3aed" },
  url_scrape: { label: "url", color: "#0891b2" },
  folder: { label: "folder", color: "#d97706" },
  git_repo: { label: "git", color: "#16a34a" },
  object_store: { label: "store", color: "#9333ea" },
};

const STATUS_COLOR: Record<string, string> = {
  indexed: "#16a34a",
  processing: "#d97706",
  pending: "#6b7280",
  failed: "#dc2626",
  deleted: "#9ca3af",
  blocked_on_memory_write: "#b45309",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AssetInventory() {
  const [projectFilter, setProjectFilter] = useState("");
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Git ingest state
  const [ingesting, setIngesting] = useState(false);
  const [ingestResult, setIngestResult] = useState<string | null>(null);
  const [ingestError, setIngestError] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Fetch assets
  // ---------------------------------------------------------------------------

  const fetchAssets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (projectFilter) params.set("project_id", projectFilter);
      const res = await fetch(`/api/v1/assets?${params.toString()}`, {
        headers: { Authorization: "Bearer prototype-dev-token" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: AssetsResponse = await res.json();
      setAssets(json.data);
      setTotalCount(json.pagination.total_count);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch assets");
    } finally {
      setLoading(false);
    }
  }, [projectFilter]);

  useEffect(() => {
    fetchAssets();
  }, [fetchAssets]);

  // ---------------------------------------------------------------------------
  // Git ingest action
  // ---------------------------------------------------------------------------

  async function triggerGitIngest() {
    setIngesting(true);
    setIngestResult(null);
    setIngestError(null);
    try {
      const res = await fetch("/api/v1/ingest/git", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer prototype-dev-token",
        },
        body: JSON.stringify({
          repo_url: "https://github.com/acme-corp/platform-services",
          repo_slug: "platform-services-repo",
          project_id: "proj-eng-incident-ops",
          org_id: "00000000-0000-0000-0000-000000000001",
          acl_scope: "org:acme",
          branch: "main",
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setIngestResult(
        `Ingested ${json.file_asset_count} file(s) from platform-services-repo ` +
          `(run: ${json.ingest_run_id.slice(0, 8)}…)`,
      );
      // Refresh to show new records
      await fetchAssets();
    } catch (e) {
      setIngestError(e instanceof Error ? e.message : "Ingest failed");
    } finally {
      setIngesting(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const gitAssets = assets.filter((a) => a.source_type === "git_repo");
  const childAssets = assets.filter(
    (a) => a.parent_asset_id !== null && a.parent_asset_id !== undefined,
  );

  return (
    <div>
      {/* ------------------------------------------------------------------ */}
      {/* Git ingest panel */}
      {/* ------------------------------------------------------------------ */}
      <section
        aria-label="Git ingest panel"
        style={{
          border: "1px solid #d1fae5",
          borderRadius: 8,
          background: "#f0fdf4",
          padding: "16px 20px",
          marginBottom: 24,
        }}
      >
        <h2 style={{ margin: "0 0 8px", fontSize: 15, color: "#065f46" }}>
          Git Connector — Prototype Ingest
        </h2>
        <p style={{ margin: "0 0 12px", fontSize: 13, color: "#374151" }}>
          Ingest <strong>platform-services-repo</strong> (acme-corp/platform-services,{" "}
          <code>proj-eng-incident-ops</code>). Creates one child asset per file with
          lineage metadata.
        </p>
        <button
          onClick={triggerGitIngest}
          disabled={ingesting}
          style={{
            background: ingesting ? "#9ca3af" : "#16a34a",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            padding: "8px 18px",
            cursor: ingesting ? "default" : "pointer",
            fontWeight: 600,
            fontSize: 13,
          }}
          aria-busy={ingesting}
        >
          {ingesting ? "Ingesting…" : "Ingest platform-services-repo"}
        </button>
        {ingestResult && (
          <p
            role="status"
            aria-live="polite"
            style={{ margin: "10px 0 0", fontSize: 13, color: "#166534" }}
          >
            ✓ {ingestResult}
          </p>
        )}
        {ingestError && (
          <p
            role="alert"
            aria-live="assertive"
            style={{ margin: "10px 0 0", fontSize: 13, color: "#991b1b" }}
          >
            ✗ {ingestError}
          </p>
        )}
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Filters */}
      {/* ------------------------------------------------------------------ */}
      <div style={{ marginBottom: 16, display: "flex", gap: 12, alignItems: "center" }}>
        <label htmlFor="project-filter" style={{ fontSize: 13, fontWeight: 600 }}>
          Project:
        </label>
        <select
          id="project-filter"
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          style={{ padding: "6px 10px", borderRadius: 4, border: "1px solid #d1d5db", fontSize: 13 }}
        >
          {PROJECTS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <button
          onClick={fetchAssets}
          style={{
            padding: "6px 14px",
            borderRadius: 4,
            border: "1px solid #d1d5db",
            background: "#f9fafb",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          Refresh
        </button>
        {totalCount !== null && (
          <span style={{ fontSize: 13, color: "#6b7280" }}>
            {totalCount} asset{totalCount !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Summary chips */}
      {/* ------------------------------------------------------------------ */}
      {gitAssets.length > 0 && (
        <p style={{ fontSize: 13, color: "#374151", marginBottom: 12 }}>
          <strong>{gitAssets.length}</strong> git repo{gitAssets.length !== 1 ? "s" : ""} ·{" "}
          <strong>{childAssets.length}</strong> per-file record{childAssets.length !== 1 ? "s" : ""} with lineage
        </p>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Table */}
      {/* ------------------------------------------------------------------ */}
      {loading ? (
        <p style={{ color: "#6b7280", fontSize: 13 }} aria-live="polite">
          Loading assets…
        </p>
      ) : error ? (
        <p role="alert" style={{ color: "#dc2626", fontSize: 13 }}>
          Error: {error}
        </p>
      ) : assets.length === 0 ? (
        <p style={{ color: "#6b7280", fontSize: 13 }}>
          No assets found. Run the seed script or trigger git ingest above.
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table
            aria-label="Asset inventory"
            style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}
          >
            <thead>
              <tr style={{ background: "#f3f4f6" }}>
                {["Type", "File / URL", "Project", "Status", "Lineage", "Ingested"].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: "8px 10px",
                      textAlign: "left",
                      borderBottom: "1px solid #e5e7eb",
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {assets.map((a) => {
                const badge = SOURCE_TYPE_BADGE[a.source_type] ?? {
                  label: a.source_type,
                  color: "#6b7280",
                };
                const statusColor = STATUS_COLOR[a.ingest_status] ?? "#6b7280";
                const lineageSummary = buildLineageSummary(a.lineage_metadata);
                return (
                  <tr
                    key={a.asset_id}
                    style={{ borderBottom: "1px solid #f3f4f6" }}
                  >
                    <td style={{ padding: "7px 10px" }}>
                      <span
                        style={{
                          background: badge.color,
                          color: "#fff",
                          borderRadius: 4,
                          padding: "2px 6px",
                          fontSize: 11,
                          fontWeight: 700,
                          letterSpacing: "0.03em",
                        }}
                      >
                        {badge.label}
                      </span>
                    </td>
                    <td
                      style={{
                        padding: "7px 10px",
                        maxWidth: 280,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={a.file_path_or_url}
                    >
                      {a.file_path_or_url}
                    </td>
                    <td style={{ padding: "7px 10px", color: "#4b5563" }}>
                      {a.project_id}
                    </td>
                    <td style={{ padding: "7px 10px" }}>
                      <span style={{ color: statusColor, fontWeight: 600 }}>
                        {a.ingest_status}
                      </span>
                    </td>
                    <td
                      style={{
                        padding: "7px 10px",
                        color: "#6b7280",
                        maxWidth: 220,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={lineageSummary}
                    >
                      {lineageSummary}
                    </td>
                    <td style={{ padding: "7px 10px", color: "#9ca3af", whiteSpace: "nowrap" }}>
                      {new Date(a.ingested_at).toLocaleDateString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function buildLineageSummary(meta: LineageMeta): string {
  if (!meta || Object.keys(meta).length === 0) return "—";
  if (meta.relative_path) {
    return `${meta.repo_slug ?? "repo"} › ${meta.relative_path}`;
  }
  if (meta.repo_slug) {
    return `repo: ${meta.repo_slug} (${meta.branch ?? "main"})`;
  }
  if (meta.folder_path) {
    return `folder: ${meta.folder_path}`;
  }
  return JSON.stringify(meta).slice(0, 60);
}
