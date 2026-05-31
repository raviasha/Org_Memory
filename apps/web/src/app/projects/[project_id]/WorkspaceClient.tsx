"use client";

/**
 * WorkspaceClient — Session 8b
 *
 * Project workspace client component. Provides:
 *   - Project header (name, team, description, status badge)
 *   - Asset table showing all assets including soft-deleted ones
 *   - File upload form to add assets to the project
 *   - Remove action per non-deleted asset (soft-delete)
 *   - "Ingest Operations" section showing soft-delete audit entries
 *     (timestamp, actor, asset_id) for deleted assets
 */

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProjectKPI {
  project_id: string;
  name: string;
  description: string | null;
  owner_team: string | null;
  acl_scope: string;
  status: string;
  created_at: string;
  updated_at: string;
  asset_count: number;
  indexed_count: number;
  failed_count: number;
  last_ingest_at: string | null;
}

interface AssetRow {
  asset_id: string;
  project_id: string;
  source_type: string;
  file_path_or_url: string;
  ingest_status: string;
  ingested_at: string;
  last_modified_at: string;
  parent_asset_id: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_COLOR: Record<string, { color: string; bg: string }> = {
  indexed: { color: "#065f46", bg: "#d1fae5" },
  processing: { color: "#92400e", bg: "#fef3c7" },
  pending: { color: "#4b5563", bg: "#f3f4f6" },
  failed: { color: "#991b1b", bg: "#fee2e2" },
  deleted: { color: "#6b7280", bg: "#f3f4f6" },
  blocked_on_memory_write: { color: "#92400e", bg: "#fef3c7" },
};

function shortId(id: string) {
  return id.slice(0, 8) + "…";
}

function fmtTs(ts: string | null) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  projectId: string;
}

export default function WorkspaceClient({ projectId }: Props) {
  // Project header state
  const [project, setProject] = useState<ProjectKPI | null>(null);
  const [projectLoading, setProjectLoading] = useState(true);

  // Assets state
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [assetsError, setAssetsError] = useState<string | null>(null);

  // Upload state
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Remove (soft-delete) state
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Fetch project
  // ---------------------------------------------------------------------------

  useEffect(() => {
    setProjectLoading(true);
    fetch(`/api/v1/projects?limit=200`, {
      headers: { Authorization: "Bearer prototype-dev-token" },
    })
      .then((r) => r.json())
      .then((json) => {
        const found = (json.data ?? []).find(
          (p: ProjectKPI) => p.project_id === projectId,
        );
        setProject(found ?? null);
      })
      .catch(() => setProject(null))
      .finally(() => setProjectLoading(false));
  }, [projectId]);

  // ---------------------------------------------------------------------------
  // Fetch assets (include deleted for audit view)
  // ---------------------------------------------------------------------------

  const fetchAssets = useCallback(async () => {
    setAssetsLoading(true);
    setAssetsError(null);
    try {
      const res = await fetch(
        `/api/v1/assets?project_id=${encodeURIComponent(projectId)}&limit=200`,
        { headers: { Authorization: "Bearer prototype-dev-token" } },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setAssets(json.data ?? []);
    } catch (e) {
      setAssetsError(e instanceof Error ? e.message : "Failed to load assets");
    } finally {
      setAssetsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchAssets();
  }, [fetchAssets]);

  // ---------------------------------------------------------------------------
  // Upload file
  // ---------------------------------------------------------------------------

  async function handleUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadResult(null);
    setUploadError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("project_id", projectId);
      formData.append("org_id", "00000000-0000-0000-0000-000000000001");
      formData.append("acl_scope", "org:acme");

      const res = await fetch("/api/v1/ingest/upload", {
        method: "POST",
        headers: { Authorization: "Bearer prototype-dev-token" },
        body: formData,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setUploadResult(`Uploaded: ${json.filename} (${json.asset_id.slice(0, 8)}…)`);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await fetchAssets();
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Remove (soft-delete) asset
  // ---------------------------------------------------------------------------

  async function handleRemove(assetId: string, filePath: string) {
    if (
      !window.confirm(
        `Remove asset "${filePath.split("/").pop()}"? It will be soft-deleted and visible in the audit trail.`,
      )
    )
      return;

    setRemovingId(assetId);
    setRemoveError(null);
    try {
      const res = await fetch(`/api/v1/assets/${assetId}`, {
        method: "DELETE",
        headers: { Authorization: "Bearer prototype-dev-token" },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      // Update local state optimistically
      setAssets((prev) =>
        prev.map((a) =>
          a.asset_id === assetId
            ? {
                ...a,
                ingest_status: "deleted",
                deleted_at: json.deleted_at,
                deleted_by: json.deleted_by,
              }
            : a,
        ),
      );
    } catch (e) {
      setRemoveError(e instanceof Error ? e.message : "Remove failed");
    } finally {
      setRemovingId(null);
    }
  }

  // ---------------------------------------------------------------------------
  // Derived data
  // ---------------------------------------------------------------------------

  const activeAssets = assets.filter((a) => a.ingest_status !== "deleted");
  const deletedAssets = assets.filter((a) => a.ingest_status === "deleted");

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div>
      {/* Back link */}
      <Link
        href="/projects"
        style={{ fontSize: 13, color: "#6b7280", textDecoration: "none", display: "inline-block", marginBottom: 16 }}
      >
        ← Back to projects
      </Link>

      {/* Project header */}
      {projectLoading ? (
        <p style={{ color: "#6b7280", fontSize: 14 }}>Loading project…</p>
      ) : project ? (
        <div style={{ marginBottom: 28 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
            <h1 style={{ margin: 0, fontSize: 22 }}>{project.name}</h1>
            <span
              data-project-status={project.status ?? "active"}
              style={{
                fontSize: 11,
                fontWeight: 700,
                padding: "3px 10px",
                borderRadius: 12,
                background: project.status === "deleted" ? "#fee2e2" : "#d1fae5",
                color: project.status === "deleted" ? "#991b1b" : "#065f46",
                textTransform: "uppercase",
              }}
            >
              {project.status ?? "active"}
            </span>
          </div>
          <p style={{ margin: "0 0 4px", fontSize: 13, color: "#6b7280" }}>
            <code style={{ fontSize: 12 }}>{project.project_id}</code>
            {project.owner_team ? ` · ${project.owner_team}` : ""}
          </p>
          {project.description && (
            <p style={{ margin: 0, fontSize: 13, color: "#555" }}>{project.description}</p>
          )}
        </div>
      ) : (
        <p style={{ color: "#dc2626", fontSize: 14 }}>Project not found.</p>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Add asset — file upload */}
      {/* ------------------------------------------------------------------ */}
      <section
        aria-label="Add asset to project"
        style={{
          border: "1px solid #d1fae5",
          borderRadius: 8,
          background: "#f0fdf4",
          padding: "16px 20px",
          marginBottom: 28,
          maxWidth: 560,
        }}
      >
        <h2 style={{ margin: "0 0 12px", fontSize: 15, color: "#065f46" }}>
          Add file to project
        </h2>
        <form onSubmit={handleUpload} style={{ display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
          <input
            type="file"
            ref={fileInputRef}
            required
            style={{
              fontSize: 13,
              border: "1px solid #d1d5db",
              borderRadius: 5,
              padding: "6px 8px",
              background: "#fff",
              flex: 1,
              minWidth: 0,
            }}
          />
          <button
            type="submit"
            disabled={uploading}
            style={{
              background: uploading ? "#9ca3af" : "#16a34a",
              color: "#fff",
              border: "none",
              borderRadius: 5,
              padding: "8px 16px",
              cursor: uploading ? "default" : "pointer",
              fontWeight: 600,
              fontSize: 13,
              whiteSpace: "nowrap",
            }}
          >
            {uploading ? "Uploading…" : "Upload file"}
          </button>
        </form>
        {uploadResult && (
          <p style={{ margin: "10px 0 0", fontSize: 13, color: "#16a34a" }}>{uploadResult}</p>
        )}
        {uploadError && (
          <p role="alert" style={{ margin: "10px 0 0", fontSize: 13, color: "#dc2626" }}>
            {uploadError}
          </p>
        )}
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Asset table */}
      {/* ------------------------------------------------------------------ */}
      <section aria-label="Project assets" style={{ marginBottom: 36 }}>
        <h2 style={{ fontSize: 16, margin: "0 0 12px" }}>
          Assets
          {activeAssets.length > 0 && (
            <span style={{ fontWeight: 400, fontSize: 13, color: "#6b7280", marginLeft: 8 }}>
              ({activeAssets.length} active{deletedAssets.length > 0 ? `, ${deletedAssets.length} deleted` : ""})
            </span>
          )}
        </h2>

        {removeError && (
          <p role="alert" style={{ color: "#dc2626", fontSize: 13, marginBottom: 10 }}>
            {removeError}
          </p>
        )}

        {assetsError && (
          <p role="alert" style={{ color: "#dc2626", fontSize: 13 }}>{assetsError}</p>
        )}

        {assetsLoading && assets.length === 0 ? (
          <p style={{ color: "#6b7280", fontSize: 14 }}>Loading assets…</p>
        ) : assets.length === 0 ? (
          <p style={{ color: "#6b7280", fontSize: 14 }}>
            No assets yet. Upload a file above to get started.
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 13,
                minWidth: 680,
              }}
            >
              <thead>
                <tr style={{ background: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                  <th style={TH}>Asset ID</th>
                  <th style={TH}>File / URL</th>
                  <th style={TH}>Type</th>
                  <th style={TH}>Status</th>
                  <th style={TH}>Ingested</th>
                  <th style={TH}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {assets.map((a) => {
                  const sc = STATUS_COLOR[a.ingest_status] ?? STATUS_COLOR.pending;
                  const isDeleted = a.ingest_status === "deleted";
                  return (
                    <tr
                      key={a.asset_id}
                      data-asset-id={a.asset_id}
                      data-ingest-status={a.ingest_status}
                      style={{
                        borderBottom: "1px solid #f3f4f6",
                        opacity: isDeleted ? 0.55 : 1,
                        background: isDeleted ? "#fafafa" : "transparent",
                      }}
                    >
                      <td style={TD}>
                        <code style={{ fontSize: 11 }}>{shortId(a.asset_id)}</code>
                      </td>
                      <td style={{ ...TD, maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {a.file_path_or_url.split("/").pop() ?? a.file_path_or_url}
                      </td>
                      <td style={TD}>
                        <span style={{ fontSize: 11, color: "#6b7280" }}>{a.source_type}</span>
                      </td>
                      <td style={TD}>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            padding: "2px 7px",
                            borderRadius: 10,
                            color: sc.color,
                            background: sc.bg,
                          }}
                        >
                          {a.ingest_status}
                        </span>
                      </td>
                      <td style={{ ...TD, color: "#9ca3af" }}>{fmtTs(a.ingested_at)}</td>
                      <td style={TD}>
                        {!isDeleted && (
                          <button
                            onClick={() => handleRemove(a.asset_id, a.file_path_or_url)}
                            disabled={removingId === a.asset_id}
                            aria-label={`Remove asset ${a.asset_id}`}
                            style={{
                              fontSize: 12,
                              color: "#dc2626",
                              background: "transparent",
                              border: "1px solid #fca5a5",
                              borderRadius: 4,
                              padding: "3px 8px",
                              cursor: removingId === a.asset_id ? "default" : "pointer",
                            }}
                          >
                            {removingId === a.asset_id ? "Removing…" : "Remove"}
                          </button>
                        )}
                        {isDeleted && (
                          <span style={{ fontSize: 11, color: "#9ca3af" }}>Soft-deleted</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Ingest Operations — Soft-delete audit trail */}
      {/* ------------------------------------------------------------------ */}
      <section aria-label="Ingest operations" style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 16, margin: "0 0 4px" }}>Ingest Operations</h2>
        <p style={{ margin: "0 0 12px", fontSize: 13, color: "#6b7280" }}>
          Soft-delete audit entries. Deleted assets remain in the database and are
          listed here with timestamp, actor, and asset identifier.
        </p>

        {deletedAssets.length === 0 ? (
          <p style={{ fontSize: 13, color: "#9ca3af" }}>No deleted assets in this project.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 13,
                minWidth: 520,
              }}
            >
              <thead>
                <tr style={{ background: "#fef2f2", borderBottom: "1px solid #fecaca" }}>
                  <th style={TH}>Asset ID</th>
                  <th style={TH}>File / URL</th>
                  <th style={TH}>Deleted at</th>
                  <th style={TH}>Deleted by</th>
                </tr>
              </thead>
              <tbody>
                {deletedAssets.map((a) => (
                  <tr
                    key={a.asset_id}
                    data-asset-id={a.asset_id}
                    data-deleted-at={a.deleted_at ?? ""}
                    style={{ borderBottom: "1px solid #fef2f2" }}
                  >
                    <td style={TD}>
                      <code style={{ fontSize: 11 }}>{a.asset_id}</code>
                    </td>
                    <td style={{ ...TD, maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {a.file_path_or_url.split("/").pop() ?? a.file_path_or_url}
                    </td>
                    <td style={{ ...TD, color: "#9ca3af" }}>{fmtTs(a.deleted_at)}</td>
                    <td style={{ ...TD, color: "#9ca3af" }}>{a.deleted_by ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table style helpers
// ---------------------------------------------------------------------------

const TH: React.CSSProperties = {
  padding: "8px 12px",
  textAlign: "left",
  fontWeight: 600,
  fontSize: 12,
  color: "#374151",
};

const TD: React.CSSProperties = {
  padding: "8px 12px",
  verticalAlign: "middle",
};
