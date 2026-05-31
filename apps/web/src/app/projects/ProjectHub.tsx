"use client";

/**
 * ProjectHub — Sessions 8 + 8b
 *
 * Client component that:
 *   1. Fetches project KPIs from GET /api/v1/projects
 *   2. Renders the Project Hub index dashboard with status indicators
 *   3. Provides inline create-project form (Session 8b)
 *   4. Provides soft-delete action per project (Session 8b)
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
  status: string;
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

  // Create-project form state
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newTeam, setNewTeam] = useState("");

  // Delete state (keyed by project_id)
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function fetchProjects() {
    setLoading(true);
    setError(null);
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
  }

  useEffect(() => {
    fetchProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------------
  // Create project
  // ---------------------------------------------------------------------------

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/v1/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer prototype-dev-token",
        },
        body: JSON.stringify({
          name: newName.trim(),
          description: newDesc.trim() || null,
          owner_team: newTeam.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      // Optimistically add to list and refresh
      setProjects((prev) => [json.project, ...prev]);
      setShowCreate(false);
      setNewName("");
      setNewDesc("");
      setNewTeam("");
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Failed to create project");
    } finally {
      setCreating(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Delete project
  // ---------------------------------------------------------------------------

  async function handleDelete(projectId: string) {
    if (!window.confirm(`Delete project "${projectId}"? This action is reversible via audit trail.`)) return;
    setDeletingId(projectId);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}`, {
        method: "DELETE",
        headers: { Authorization: "Bearer prototype-dev-token" },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setProjects((prev) => prev.filter((p) => p.project_id !== projectId));
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "Failed to delete project");
    } finally {
      setDeletingId(null);
    }
  }

  // ---------------------------------------------------------------------------
  // Render states
  // ---------------------------------------------------------------------------

  if (loading && projects.length === 0) {
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

  return (
    <div>
      {/* ------------------------------------------------------------------ */}
      {/* Create project controls */}
      {/* ------------------------------------------------------------------ */}
      <div style={{ marginBottom: 24, display: "flex", alignItems: "center", gap: 12 }}>
        <button
          onClick={() => setShowCreate((v) => !v)}
          aria-label="Create project"
          style={{
            background: "#1a1a2e",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            padding: "8px 16px",
            cursor: "pointer",
            fontWeight: 600,
            fontSize: 13,
          }}
        >
          {showCreate ? "Cancel" : "+ Create project"}
        </button>
        {deleteError && (
          <span role="alert" style={{ color: "#dc2626", fontSize: 13 }}>
            {deleteError}
          </span>
        )}
      </div>

      {showCreate && (
        <form
          onSubmit={handleCreate}
          aria-label="Create project form"
          style={{
            border: "1px solid #c7d2fe",
            borderRadius: 8,
            background: "#eef2ff",
            padding: "20px 24px",
            marginBottom: 24,
            maxWidth: 480,
          }}
        >
          <h2 style={{ margin: "0 0 16px", fontSize: 15, color: "#1e40af" }}>
            New project
          </h2>

          <label style={{ display: "block", marginBottom: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>
              Project name *
            </span>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              required
              placeholder="e.g. Engineering — Infra Migration"
              style={{
                display: "block",
                width: "100%",
                marginTop: 4,
                padding: "7px 10px",
                border: "1px solid #d1d5db",
                borderRadius: 5,
                fontSize: 14,
                boxSizing: "border-box",
              }}
            />
          </label>

          <label style={{ display: "block", marginBottom: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>
              Description
            </span>
            <input
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="Short description (optional)"
              style={{
                display: "block",
                width: "100%",
                marginTop: 4,
                padding: "7px 10px",
                border: "1px solid #d1d5db",
                borderRadius: 5,
                fontSize: 14,
                boxSizing: "border-box",
              }}
            />
          </label>

          <label style={{ display: "block", marginBottom: 16 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>
              Owner team
            </span>
            <input
              value={newTeam}
              onChange={(e) => setNewTeam(e.target.value)}
              placeholder="e.g. Engineering"
              style={{
                display: "block",
                width: "100%",
                marginTop: 4,
                padding: "7px 10px",
                border: "1px solid #d1d5db",
                borderRadius: 5,
                fontSize: 14,
                boxSizing: "border-box",
              }}
            />
          </label>

          {createError && (
            <p role="alert" style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>
              {createError}
            </p>
          )}

          <div style={{ display: "flex", gap: 10 }}>
            <button
              type="submit"
              disabled={creating || !newName.trim()}
              style={{
                background: creating ? "#9ca3af" : "#1e40af",
                color: "#fff",
                border: "none",
                borderRadius: 5,
                padding: "8px 18px",
                cursor: creating ? "default" : "pointer",
                fontWeight: 600,
                fontSize: 13,
              }}
            >
              {creating ? "Creating…" : "Create project"}
            </button>
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              style={{
                background: "transparent",
                border: "1px solid #9ca3af",
                borderRadius: 5,
                padding: "8px 14px",
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Project list */}
      {/* ------------------------------------------------------------------ */}

      {projects.length === 0 && !loading ? (
        <p style={{ color: "#6b7280", fontSize: 14 }}>
          No projects found. Create a project above or run the seed script.
        </p>
      ) : (
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
                data-status={p.status ?? "active"}
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
                    href={`/projects/${p.project_id}`}
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
                    data-indexing-status={status}
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

                {/* Actions row */}
                <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                  <Link
                    href={`/projects/${p.project_id}`}
                    style={{
                      fontSize: 12,
                      color: "#2563eb",
                      textDecoration: "none",
                      padding: "4px 10px",
                      border: "1px solid #bfdbfe",
                      borderRadius: 4,
                      background: "#eff6ff",
                    }}
                  >
                    Open workspace
                  </Link>
                  <button
                    onClick={() => handleDelete(p.project_id)}
                    disabled={deletingId === p.project_id}
                    aria-label={`Delete project ${p.name}`}
                    style={{
                      fontSize: 12,
                      color: "#dc2626",
                      background: "transparent",
                      border: "1px solid #fca5a5",
                      borderRadius: 4,
                      padding: "4px 10px",
                      cursor: deletingId === p.project_id ? "default" : "pointer",
                    }}
                  >
                    {deletingId === p.project_id ? "Deleting…" : "Delete"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
