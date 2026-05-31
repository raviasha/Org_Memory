"use client";

/**
 * /ingest — Sessions 8b / 17
 *
 * Ingest Operations screen.
 * Shows two panels:
 *   1. Soft-delete audit entries across all projects (Session 8b).
 *   2. Incremental indexing job history with delta and freshness status (Session 17).
 *
 * Deleted asset rows are never purged from the audit view.
 */

import { useState, useEffect } from "react";
import Link from "next/link";

interface AssetRow {
  asset_id: string;
  project_id: string;
  source_type: string;
  file_path_or_url: string;
  ingest_status: string;
  freshness_status: string | null;
  indexed_at: string | null;
  ingested_at: string;
  deleted_at: string | null;
  deleted_by: string | null;
}

// Session 17: index job row
interface IndexJobRow {
  job_id: string;
  asset_id: string;
  project_id: string;
  status: string;
  delta_detected: boolean | null;
  requested_at: string;
  completed_at: string | null;
  error_message: string | null;
}

// Session 17: freshness badge colours
const FRESHNESS_COLOR: Record<string, { color: string; bg: string }> = {
  fresh:         { color: "#065f46", bg: "#d1fae5" },
  stale:         { color: "#92400e", bg: "#fef3c7" },
  never_indexed: { color: "#6b7280", bg: "#f3f4f6" },
};

const JOB_STATUS_COLOR: Record<string, { color: string; bg: string }> = {
  queued:    { color: "#1d4ed8", bg: "#dbeafe" },
  running:   { color: "#92400e", bg: "#fef3c7" },
  completed: { color: "#065f46", bg: "#d1fae5" },
  no_change: { color: "#6b7280", bg: "#f3f4f6" },
  failed:    { color: "#991b1b", bg: "#fee2e2" },
};

export default function IngestOpsPage() {
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [projectFilter, setProjectFilter] = useState("");

  // Session 17: index jobs state
  const [indexJobs, setIndexJobs] = useState<IndexJobRow[]>([]);
  const [indexJobsLoading, setIndexJobsLoading] = useState(false);

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

  // Session 17: fetch index jobs
  useEffect(() => {
    setIndexJobsLoading(true);
    const params = new URLSearchParams({ limit: "100" });
    if (projectFilter) params.set("project_id", projectFilter);
    fetch(`/api/v1/index-jobs?${params.toString()}`, {
      headers: { Authorization: "Bearer prototype-dev-token" },
    })
      .then((r) => r.ok ? r.json() : { data: [] })
      .then((json) => setIndexJobs(json.data ?? []))
      .catch(() => setIndexJobs([]))
      .finally(() => setIndexJobsLoading(false));
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

      {/* ------------------------------------------------------------------ */}
      {/* Session 17: Incremental Indexing — index jobs panel */}
      {/* ------------------------------------------------------------------ */}
      <section aria-label="Incremental indexing jobs" style={{ marginTop: 40 }}>
        <h2 style={{ fontSize: 16, margin: "0 0 4px" }}>Incremental Indexing Jobs</h2>
        <p style={{ margin: "0 0 12px", fontSize: 13, color: "#6b7280" }}>
          Delta-detection and re-index queue. Changed sources transition stale → fresh after
          completion. Use the Reindex button on the project workspace to queue a job.
        </p>

        {indexJobsLoading && indexJobs.length === 0 ? (
          <p style={{ fontSize: 13, color: "#6b7280" }}>Loading index jobs…</p>
        ) : indexJobs.length === 0 ? (
          <p style={{ fontSize: 13, color: "#9ca3af" }}>
            No index jobs recorded yet.
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 13,
                minWidth: 700,
              }}
            >
              <thead>
                <tr style={{ background: "#eff6ff", borderBottom: "2px solid #bfdbfe" }}>
                  <th style={TH}>Job ID</th>
                  <th style={TH}>Asset ID</th>
                  <th style={TH}>Project</th>
                  <th style={TH}>Status</th>
                  <th style={TH}>Delta</th>
                  <th style={TH}>Requested</th>
                  <th style={TH}>Completed</th>
                </tr>
              </thead>
              <tbody>
                {indexJobs.map((j) => {
                  const jc = JOB_STATUS_COLOR[j.status] ?? JOB_STATUS_COLOR.queued;
                  return (
                    <tr
                      key={j.job_id}
                      data-job-id={j.job_id}
                      data-job-status={j.status}
                      style={{ borderBottom: "1px solid #eff6ff" }}
                    >
                      <td style={TD}><code style={{ fontSize: 11 }}>{j.job_id.slice(0, 8)}…</code></td>
                      <td style={TD}><code style={{ fontSize: 11 }}>{j.asset_id.slice(0, 8)}…</code></td>
                      <td style={TD}>
                        <Link href={`/projects/${j.project_id}`} style={{ fontSize: 12, color: "#2563eb", textDecoration: "none" }}>
                          {j.project_id}
                        </Link>
                      </td>
                      <td style={TD}>
                        <span style={{
                          fontSize: 11, fontWeight: 600,
                          padding: "2px 7px", borderRadius: 10,
                          color: jc.color, background: jc.bg,
                        }}>
                          {j.status}
                        </span>
                        {j.error_message && (
                          <span title={j.error_message} style={{ marginLeft: 6, fontSize: 11, color: "#dc2626" }}>⚠</span>
                        )}
                      </td>
                      <td style={TD}>{j.delta_detected === null ? "—" : j.delta_detected ? "yes" : "no"}</td>
                      <td style={{ ...TD, color: "#9ca3af", fontSize: 12 }}>{fmtTs(j.requested_at)}</td>
                      <td style={{ ...TD, color: "#9ca3af", fontSize: 12 }}>{fmtTs(j.completed_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
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
