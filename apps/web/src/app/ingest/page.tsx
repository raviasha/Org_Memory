"use client";

/**
 * /ingest — Session 8b
 *
 * Ingest Operations screen.
 * Shows soft-delete audit entries across all projects: asset_id, project,
 * deleted_at timestamp, and deleted_by actor. These entries persist even after
 * soft-delete and are never purged.
 *
 * Future sessions (Session 16) will extend this screen with the full ingest
 * timeline, Managed Agents I/O panel, and memory-write provenance.
 */

import { useState, useEffect } from "react";
import Link from "next/link";

interface AssetRow {
  asset_id: string;
  project_id: string;
  source_type: string;
  file_path_or_url: string;
  ingest_status: string;
  ingested_at: string;
  deleted_at: string | null;
  deleted_by: string | null;
}

export default function IngestOpsPage() {
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [projectFilter, setProjectFilter] = useState("");

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ limit: "200" });
    if (projectFilter) params.set("project_id", projectFilter);
    fetch(`/api/v1/assets?${params.toString()}`, {
      headers: { Authorization: "Bearer prototype-dev-token" },
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((json) => {
        const all: AssetRow[] = json.data ?? [];
        setAssets(all.filter((a) => a.ingest_status === "deleted"));
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [projectFilter]);

  function fmtTs(ts: string | null) {
    if (!ts) return "—";
    return new Date(ts).toLocaleString();
  }

  const PROJECTS = [
    { id: "", label: "All projects" },
    { id: "proj-finance-infra-q3", label: "Finance — Infra Q3" },
    { id: "proj-compliance-privacy", label: "Legal/Compliance" },
    { id: "proj-eng-incident-ops", label: "Engineering — Incident Ops" },
    { id: "proj-corpdev-targetco-dd", label: "CorpDev — TargetCo DD" },
    { id: "proj-org-shared", label: "Org Shared" },
  ];

  return (
    <>
      <h1 style={{ marginTop: 0 }}>Ingest Operations</h1>
      <p style={{ color: "#555", marginBottom: 24 }}>
        Soft-delete audit trail. Every removed asset is recorded here with
        timestamp, actor, and full asset ID. Rows are never purged.
      </p>

      {/* Filter */}
      <div style={{ marginBottom: 20 }}>
        <label style={{ fontSize: 13, fontWeight: 600, color: "#374151", marginRight: 8 }}>
          Filter by project:
        </label>
        <select
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          style={{
            fontSize: 13,
            padding: "5px 10px",
            border: "1px solid #d1d5db",
            borderRadius: 5,
            background: "#fff",
          }}
        >
          {PROJECTS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <p role="alert" style={{ color: "#dc2626", fontSize: 14 }}>
          {error}
        </p>
      )}

      {loading ? (
        <p style={{ color: "#6b7280", fontSize: 14 }}>Loading…</p>
      ) : assets.length === 0 ? (
        <p style={{ color: "#6b7280", fontSize: 14 }}>
          No soft-deleted assets found
          {projectFilter ? ` in project ${projectFilter}` : ""}.
        </p>
      ) : (
        <section aria-label="Ingest operations audit log">
          <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 12 }}>
            {assets.length} deleted asset{assets.length !== 1 ? "s" : ""}
            {projectFilter ? ` in ${projectFilter}` : " across all projects"}
          </p>
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 13,
                minWidth: 640,
              }}
            >
              <thead>
                <tr style={{ background: "#fef2f2", borderBottom: "2px solid #fecaca" }}>
                  <th style={TH}>Asset ID</th>
                  <th style={TH}>Project</th>
                  <th style={TH}>File / URL</th>
                  <th style={TH}>Type</th>
                  <th style={TH}>Deleted at</th>
                  <th style={TH}>Deleted by</th>
                </tr>
              </thead>
              <tbody>
                {assets.map((a) => (
                  <tr
                    key={a.asset_id}
                    data-asset-id={a.asset_id}
                    style={{ borderBottom: "1px solid #fef2f2" }}
                  >
                    <td style={TD}>
                      <code style={{ fontSize: 11 }}>{a.asset_id}</code>
                    </td>
                    <td style={TD}>
                      <Link
                        href={`/projects/${a.project_id}`}
                        style={{ fontSize: 12, color: "#2563eb", textDecoration: "none" }}
                      >
                        {a.project_id}
                      </Link>
                    </td>
                    <td
                      style={{
                        ...TD,
                        maxWidth: 240,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {a.file_path_or_url.split("/").pop() ?? a.file_path_or_url}
                    </td>
                    <td style={{ ...TD, color: "#6b7280" }}>{a.source_type}</td>
                    <td style={{ ...TD, color: "#9ca3af", whiteSpace: "nowrap" }}>
                      {fmtTs(a.deleted_at)}
                    </td>
                    <td style={{ ...TD, color: "#9ca3af" }}>{a.deleted_by ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

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
