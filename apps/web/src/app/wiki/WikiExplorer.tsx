"use client";

/**
 * WikiExplorer — Session 8
 *
 * Client component that renders the LLM Wiki Explorer read-only first pass.
 * Fetches wiki pages from GET /api/v1/wiki/pages and displays:
 *   - Index and log navigation pages (root/)
 *   - All other pages grouped by page_type
 *   - Per-page: slug, title, type badge, source asset count, cross-ref counts, freshness
 *
 * Includes a type-filter selector for focused exploration.
 */

import { useState, useEffect } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WikiPageSummary {
  page_id: string;
  slug: string;
  title: string;
  page_type: string;
  acl_scope: string;
  source_asset_ids: string[];
  created_at: string;
  updated_at: string;
  shaping_job_id: string | null;
  inbound_ref_count: number;
  outbound_ref_count: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_TYPE_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  index: { label: "index", color: "#1e40af", bg: "#dbeafe" },
  log: { label: "log", color: "#374151", bg: "#f3f4f6" },
  summary: { label: "summary", color: "#065f46", bg: "#d1fae5" },
  entity: { label: "entity", color: "#4c1d95", bg: "#ede9fe" },
  concept: { label: "concept", color: "#92400e", bg: "#fef3c7" },
  comparison: { label: "comparison", color: "#7c3aed", bg: "#f3e8ff" },
  synthesis: { label: "synthesis", color: "#0e7490", bg: "#cffafe" },
  store_catalog: { label: "store_catalog", color: "#0369a1", bg: "#e0f2fe" },
  lint_report: { label: "lint_report", color: "#b45309", bg: "#fef9c3" },
};

const ALL_TYPES = ["all", ...Object.keys(PAGE_TYPE_CONFIG)];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function freshnessLabel(updatedAt: string): string {
  const now = Date.now();
  const ts = new Date(updatedAt).getTime();
  const diffMs = now - ts;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return `${Math.floor(diffDays / 30)}mo ago`;
}

function groupByType(pages: WikiPageSummary[]): Record<string, WikiPageSummary[]> {
  const groups: Record<string, WikiPageSummary[]> = {};
  for (const p of pages) {
    if (!groups[p.page_type]) groups[p.page_type] = [];
    groups[p.page_type].push(p);
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function WikiExplorer() {
  const [pages, setPages] = useState<WikiPageSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState("all");

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ limit: "200" });
    fetch(`/api/v1/wiki/pages?${params.toString()}`, {
      headers: { Authorization: "Bearer prototype-dev-token" },
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json) => setPages(json.data ?? []))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load wiki pages"))
      .finally(() => setLoading(false));
  }, []);

  const filtered = typeFilter === "all" ? pages : pages.filter((p) => p.page_type === typeFilter);
  const grouped = groupByType(filtered);

  // Render order: navigation types first, then content types
  const renderOrder = ["index", "log", "summary", "entity", "concept", "comparison", "synthesis", "store_catalog", "lint_report"];
  const orderedTypes = [
    ...renderOrder.filter((t) => grouped[t]),
    ...Object.keys(grouped).filter((t) => !renderOrder.includes(t)),
  ];

  return (
    <div>
      {/* ------------------------------------------------------------------ */}
      {/* Filter bar */}
      {/* ------------------------------------------------------------------ */}
      <div style={{ marginBottom: 20, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, color: "#6b7280", fontWeight: 500 }}>Filter by type:</span>
        {ALL_TYPES.map((t) => {
          const config = PAGE_TYPE_CONFIG[t];
          const isSelected = typeFilter === t;
          return (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              aria-pressed={isSelected}
              style={{
                fontSize: 12,
                fontWeight: 600,
                padding: "3px 10px",
                borderRadius: 12,
                border: isSelected ? "2px solid #1a1a2e" : "1px solid #d1d5db",
                cursor: "pointer",
                color: isSelected ? "#fff" : config?.color ?? "#374151",
                background: isSelected ? "#1a1a2e" : config?.bg ?? "#f9fafb",
              }}
            >
              {t === "all" ? "All" : config?.label ?? t}
            </button>
          );
        })}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Summary bar */}
      {/* ------------------------------------------------------------------ */}
      {!loading && !error && (
        <p style={{ fontSize: 13, color: "#6b7280", margin: "0 0 20px" }}>
          {filtered.length} page{filtered.length !== 1 ? "s" : ""}
          {typeFilter !== "all" ? ` of type "${typeFilter}"` : ""} — wiki shaping jobs will grow this index over time.
        </p>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Loading / error states */}
      {/* ------------------------------------------------------------------ */}
      {loading && (
        <p style={{ color: "#6b7280", fontSize: 14 }}>Loading wiki pages…</p>
      )}
      {error && (
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
          Error loading wiki pages: {error}
        </p>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Page groups */}
      {/* ------------------------------------------------------------------ */}
      {!loading && !error && filtered.length === 0 && (
        <p style={{ color: "#6b7280", fontSize: 14 }}>
          No wiki pages found. Run a wiki bootstrap migration to seed the initial pages.
        </p>
      )}

      {orderedTypes.map((pType) => {
        const config = PAGE_TYPE_CONFIG[pType];
        const typePages = grouped[pType] ?? [];

        return (
          <section
            key={pType}
            aria-label={`Wiki pages — ${pType}`}
            style={{ marginBottom: 28 }}
          >
            <h2
              style={{
                margin: "0 0 10px",
                fontSize: 14,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                gap: 8,
                color: "#374151",
              }}
            >
              <span
                style={{
                  display: "inline-block",
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "2px 8px",
                  borderRadius: 10,
                  color: config?.color ?? "#374151",
                  background: config?.bg ?? "#f3f4f6",
                }}
              >
                {config?.label ?? pType}
              </span>
              <span style={{ color: "#9ca3af", fontWeight: 400 }}>{typePages.length} page{typePages.length !== 1 ? "s" : ""}</span>
            </h2>

            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 13,
              }}
            >
              <thead>
                <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                  <th style={{ textAlign: "left", padding: "6px 8px", color: "#6b7280", fontWeight: 600 }}>
                    Slug
                  </th>
                  <th style={{ textAlign: "left", padding: "6px 8px", color: "#6b7280", fontWeight: 600 }}>
                    Title
                  </th>
                  <th style={{ textAlign: "right", padding: "6px 8px", color: "#6b7280", fontWeight: 600 }}>
                    Sources
                  </th>
                  <th style={{ textAlign: "right", padding: "6px 8px", color: "#6b7280", fontWeight: 600 }}>
                    Refs ↑↓
                  </th>
                  <th style={{ textAlign: "right", padding: "6px 8px", color: "#6b7280", fontWeight: 600 }}>
                    Updated
                  </th>
                </tr>
              </thead>
              <tbody>
                {typePages.map((p) => (
                  <tr
                    key={p.page_id}
                    data-slug={p.slug}
                    style={{ borderBottom: "1px solid #f3f4f6" }}
                  >
                    <td style={{ padding: "7px 8px", verticalAlign: "top" }}>
                      <code style={{ fontSize: 12, color: "#374151" }}>{p.slug}</code>
                    </td>
                    <td style={{ padding: "7px 8px", verticalAlign: "top", color: "#111827" }}>
                      {p.title}
                    </td>
                    <td
                      style={{ padding: "7px 8px", verticalAlign: "top", textAlign: "right", color: "#6b7280" }}
                    >
                      {p.source_asset_ids.length}
                    </td>
                    <td
                      style={{ padding: "7px 8px", verticalAlign: "top", textAlign: "right", color: "#6b7280" }}
                    >
                      {p.inbound_ref_count}↑ {p.outbound_ref_count}↓
                    </td>
                    <td
                      style={{ padding: "7px 8px", verticalAlign: "top", textAlign: "right", color: "#9ca3af", whiteSpace: "nowrap" }}
                    >
                      {freshnessLabel(p.updated_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
    </div>
  );
}
