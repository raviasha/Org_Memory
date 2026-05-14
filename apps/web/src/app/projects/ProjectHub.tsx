"use client";

/**
 * ProjectHub — Session 8
 *
 * Client component that fetches project KPIs from GET /api/v1/projects and
 * renders the Project Hub index dashboard.
 *
 * Displayed per project:
 *   - Name, team, description
 *   - Asset count, indexed count, failed count
 *   - Last ingest timestamp
 *   - Indexing status indicator (fully indexed / in progress / has failures / empty)
 */

import { useState, useEffect } from "react";
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
  created_at: string;
  updated_at: string;
  asset_count: number;
  indexed_count: number;
  failed_count: number;
  last_ingest_at: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function freshnessLabel(lastIngestAt: string | null): string {
  if (!lastIngestAt) return "No ingest";
  const now = Date.now();
  const ts = new Date(lastIngestAt).getTime();
  const diffMs = now - ts;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return `${Math.floor(diffDays / 30)}mo ago`;
}

type IndexingStatus = "fully_indexed" | "in_progress" | "has_failures" | "empty";

function indexingStatus(p: ProjectKPI): IndexingStatus {
  if (p.asset_count === 0) return "empty";
  if (p.failed_count > 0) return "has_failures";
  if (p.indexed_count < p.asset_count) return "in_progress";
  return "fully_indexed";
}

const STATUS_CONFIG: Record<IndexingStatus, { label: string; color: string; bg: string }> = {
  fully_indexed: { label: "Indexed", color: "#065f46", bg: "#d1fae5" },
  in_progress: { label: "In progress", color: "#92400e", bg: "#fef3c7" },
  has_failures: { label: "Has failures", color: "#991b1b", bg: "#fee2e2" },
  empty: { label: "Empty", color: "#4b5563", bg: "#f3f4f6" },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ProjectHub() {
  const [projects, setProjects] = useState<ProjectKPI[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch("/api/v1/projects?limit=50", {
      headers: { Authorization: "Bearer prototype-dev-token" },
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json) => setProjects(json.data ?? []))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load projects"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <p style={{ color: "#6b7280", fontSize: 14 }}>Loading projects…</p>;
  }

  if (error) {
    return (
      <p
        role="alert"
        style={{
          color: "#dc2626",
          background: "#fee2e2",
          padding: "12px 16px",
          borderRadius: 6,
          fontSize: 14,
        }}
      >
        Error loading projects: {error}
      </p>
    );
  }

  if (projects.length === 0) {
    return (
      <p style={{ color: "#6b7280", fontSize: 14 }}>
        No projects found. Run the seed script to populate the database.
      </p>
    );
  }

  return (
    <ul
      aria-label="Project list"
      style={{
        listStyle: "none",
        padding: 0,
        margin: 0,
        display: "grid",
        gap: 12,
        gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
      }}
    >
      {projects.map((p) => {
        const status = indexingStatus(p);
        const { label: statusLabel, color: statusColor, bg: statusBg } = STATUS_CONFIG[status];
        const freshness = freshnessLabel(p.last_ingest_at);

        return (
          <li
            key={p.project_id}
            data-project-id={p.project_id}
            style={{
              border: "1px solid #e5e7eb",
              borderRadius: 8,
              padding: "16px 20px",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {/* Header row */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
              <Link
                href={`/assets?project_id=${p.project_id}`}
                style={{
                  fontWeight: 600,
                  fontSize: 15,
                  textDecoration: "none",
                  color: "#1a1a2e",
                  flex: 1,
                }}
              >
                {p.name}
              </Link>
              <span
                data-status={status}
                style={{
                  display: "inline-block",
                  fontSize: 11,
                  fontWeight: 600,
                  padding: "2px 8px",
                  borderRadius: 12,
                  color: statusColor,
                  background: statusBg,
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                }}
              >
                {statusLabel}
              </span>
            </div>

            {/* Team + project_id */}
            <p style={{ margin: 0, fontSize: 12, color: "#9ca3af" }}>
              {p.owner_team ?? "Unknown team"} ·{" "}
              <code style={{ fontSize: 11 }}>{p.project_id}</code>
            </p>

            {/* Description */}
            {p.description && (
              <p style={{ margin: 0, color: "#555", fontSize: 13, lineHeight: 1.5 }}>
                {p.description}
              </p>
            )}

            {/* KPI row */}
            <div
              aria-label="Project KPIs"
              style={{
                display: "flex",
                gap: 16,
                marginTop: 4,
                fontSize: 12,
                color: "#6b7280",
              }}
            >
              <span>
                <strong style={{ color: "#111" }}>{p.asset_count}</strong> assets
              </span>
              <span>
                <strong style={{ color: "#16a34a" }}>{p.indexed_count}</strong> indexed
              </span>
              {p.failed_count > 0 && (
                <span>
                  <strong style={{ color: "#dc2626" }}>{p.failed_count}</strong> failed
                </span>
              )}
              <span>Last ingest: {freshness}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
