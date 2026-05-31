"use client";

/**
 * /explainability — Session 14
 *
 * Explainability and Audit screen.
 *
 * Displays:
 *   - Per-item rationale cards with provenance links and timestamps (included items)
 *   - Non-inclusion reasons for top excluded candidates with machine-readable reason codes
 *   - Replayable run event stream ordered by occurred_at
 *
 * Usage:
 *   /explainability?snapshot_id=<id>    Load by snapshot ID
 *   /explainability                     Show empty state with snapshot_id input
 */

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Provenance {
  source_ref: string | null;
  retrieval_level: string | null;
  score: number | null;
  selected_at: string | null;
}

interface ExplainedItem {
  item_id: string;
  type: string;
  title: string;
  source_ref: string | null;
  inclusion_reason: string;
  retrieval_level: string | null;
  score: number | null;
  token_estimate: number;
  provenance: Provenance;
}

interface ExplainedDroppedItem {
  item_id: string;
  type: string;
  title: string;
  exclusion_reason: string;
  reason_code: string;
}

interface RunEvent {
  event_id: string;
  run_id: string;
  correlation_id: string;
  task_id: string;
  subtask_id: string | null;
  snapshot_id: string | null;
  event_type: string;
  actor: "system" | "user";
  reason_code: string;
  description: string;
  item_id: string | null;
  item_title: string | null;
  metadata: Record<string, unknown>;
  occurred_at: string;
}

interface ExplainabilityData {
  snapshot_id: string;
  run_id: string;
  task_id: string;
  subtask_id: string;
  project_id: string;
  created_at: string;
  selected_items: ExplainedItem[];
  dropped_items: ExplainedDroppedItem[];
  run_events: RunEvent[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function levelBadgeStyle(level: string | null): React.CSSProperties {
  switch (level) {
    case "level_0":
      return { background: "#dbeafe", color: "#1d4ed8" };
    case "level_1":
      return { background: "#d1fae5", color: "#065f46" };
    case "level_2":
      return { background: "#ede9fe", color: "#5b21b6" };
    default:
      return { background: "#f3f4f6", color: "#6b7280" };
  }
}

function levelLabel(level: string | null): string {
  switch (level) {
    case "level_0":
      return "L0 · Org summary";
    case "level_1":
      return "L1 · Domain wiki";
    case "level_2":
      return "L2 · Specific file";
    default:
      return "—";
  }
}

function reasonCodeBadge(code: string): React.CSSProperties {
  switch (code) {
    case "below_threshold":
      return { background: "#fef3c7", color: "#92400e" };
    case "low_freshness":
      return { background: "#ffedd5", color: "#c2410c" };
    case "duplicate":
      return { background: "#e0e7ff", color: "#3730a3" };
    case "acl_restricted":
      return { background: "#fee2e2", color: "#991b1b" };
    case "budget_exceeded":
      return { background: "#fef9c3", color: "#713f12" };
    default:
      return { background: "#f3f4f6", color: "#6b7280" };
  }
}

function eventTypeColor(eventType: string): string {
  switch (eventType) {
    case "task_created":
    case "subtask_created":
      return "#3b82f6";
    case "curation_started":
    case "curation_completed":
      return "#8b5cf6";
    case "item_selected":
      return "#16a34a";
    case "item_dropped":
      return "#dc2626";
    case "context_confirmed":
      return "#0891b2";
    case "override_applied":
      return "#d97706";
    default:
      return "#6b7280";
  }
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function RationaleCard({ item }: { item: ExplainedItem }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      aria-label={`Rationale card for ${item.title}`}
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 8,
        padding: "12px 14px",
        marginBottom: 10,
        background: "#fff",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        {/* Type badge */}
        <span
          style={{
            flexShrink: 0,
            padding: "2px 7px",
            borderRadius: 4,
            fontSize: 10,
            fontWeight: 700,
            background: item.type === "wiki_page" ? "#ede9fe" : "#dbeafe",
            color: item.type === "wiki_page" ? "#5b21b6" : "#1d4ed8",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}
        >
          {item.type === "wiki_page" ? "wiki" : "asset"}
        </span>

        {/* Title and level */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontWeight: 600,
              fontSize: 14,
              color: "#111827",
              marginBottom: 3,
              wordBreak: "break-word",
            }}
          >
            {item.title}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span
              style={{
                fontSize: 11,
                padding: "1px 7px",
                borderRadius: 10,
                ...levelBadgeStyle(item.retrieval_level),
              }}
            >
              {levelLabel(item.retrieval_level)}
            </span>
            {item.score !== null && (
              <span style={{ fontSize: 11, color: "#6b7280" }}>
                score: <strong>{item.score.toFixed(2)}</strong>
              </span>
            )}
            <span style={{ fontSize: 11, color: "#9ca3af" }}>{item.token_estimate}t</span>
          </div>
        </div>

        {/* Expand toggle */}
        <button
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? `Collapse rationale for ${item.title}` : `Expand rationale for ${item.title}`}
          style={{
            flexShrink: 0,
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "#9ca3af",
            fontSize: 13,
            padding: "2px 6px",
          }}
        >
          {expanded ? "▲" : "▼"}
        </button>
      </div>

      {/* Inclusion reason (always visible) */}
      <p
        style={{
          margin: "8px 0 0",
          fontSize: 13,
          color: "#374151",
          lineHeight: 1.5,
        }}
      >
        {item.inclusion_reason}
      </p>

      {/* Expanded provenance */}
      {expanded && (
        <div
          aria-label={`Provenance for ${item.title}`}
          style={{
            marginTop: 10,
            padding: "10px 12px",
            background: "#f8fafc",
            borderRadius: 6,
            borderLeft: "3px solid #c7d2fe",
            fontSize: 12,
            color: "#6b7280",
          }}
        >
          <div style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "4px 12px" }}>
            <span style={{ color: "#374151", fontWeight: 600 }}>Source:</span>
            <code style={{ fontSize: 11, wordBreak: "break-all" }}>
              {item.provenance.source_ref ?? "—"}
            </code>
            <span style={{ color: "#374151", fontWeight: 600 }}>Retrieval level:</span>
            <span>{levelLabel(item.provenance.retrieval_level)}</span>
            <span style={{ color: "#374151", fontWeight: 600 }}>Score:</span>
            <span>{item.provenance.score !== null ? item.provenance.score.toFixed(2) : "—"}</span>
            <span style={{ color: "#374151", fontWeight: 600 }}>Selected at:</span>
            <span>
              {item.provenance.selected_at
                ? new Date(item.provenance.selected_at).toLocaleString()
                : "—"}
            </span>
            <span style={{ color: "#374151", fontWeight: 600 }}>Item ID:</span>
            <code style={{ fontSize: 10 }}>{item.item_id}</code>
          </div>
        </div>
      )}
    </div>
  );
}

function NonInclusionCard({ item }: { item: ExplainedDroppedItem }) {
  return (
    <div
      aria-label={`Non-inclusion: ${item.title}`}
      style={{
        border: "1px solid #fca5a5",
        borderRadius: 8,
        padding: "10px 14px",
        marginBottom: 8,
        background: "#fff",
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
      }}
    >
      <span style={{ fontSize: 16, flexShrink: 0 }}>✗</span>
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <span style={{ fontWeight: 600, fontSize: 14, color: "#374151" }}>{item.title}</span>
          <span
            aria-label={`Reason code: ${item.reason_code}`}
            style={{
              fontSize: 10,
              padding: "1px 7px",
              borderRadius: 10,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.03em",
              ...reasonCodeBadge(item.reason_code),
            }}
          >
            {item.reason_code.replace(/_/g, " ")}
          </span>
          <span
            style={{
              fontSize: 10,
              padding: "1px 5px",
              borderRadius: 4,
              background: "#f3f4f6",
              color: "#6b7280",
            }}
          >
            {item.type}
          </span>
        </div>
        <p style={{ margin: 0, fontSize: 12, color: "#6b7280", lineHeight: 1.5 }}>
          {item.exclusion_reason}
        </p>
      </div>
    </div>
  );
}

function RunEventRow({ event }: { event: RunEvent }) {
  const [showMeta, setShowMeta] = useState(false);
  const color = eventTypeColor(event.event_type);

  return (
    <div
      aria-label={`Run event: ${event.event_type}`}
      style={{
        display: "flex",
        gap: 12,
        padding: "8px 0",
        borderBottom: "1px solid #f3f4f6",
      }}
    >
      {/* Timeline dot */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          flexShrink: 0,
          width: 16,
        }}
      >
        <div
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: color,
            marginTop: 3,
          }}
        />
      </div>

      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              color,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            {event.event_type.replace(/_/g, " ")}
          </span>
          <span
            style={{
              fontSize: 10,
              background: event.actor === "user" ? "#fef3c7" : "#f0f9ff",
              color: event.actor === "user" ? "#92400e" : "#0369a1",
              padding: "1px 5px",
              borderRadius: 4,
            }}
          >
            {event.actor}
          </span>
          <span style={{ fontSize: 11, color: "#9ca3af" }}>
            {formatTimestamp(event.occurred_at)}
          </span>
        </div>
        <p style={{ margin: "0 0 2px", fontSize: 12, color: "#374151", lineHeight: 1.5 }}>
          {event.description}
        </p>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <code style={{ fontSize: 10, color: "#9ca3af" }}>
            reason: {event.reason_code}
          </code>
          {Object.keys(event.metadata).length > 0 && (
            <button
              onClick={() => setShowMeta((v) => !v)}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "#6b7280",
                fontSize: 11,
                padding: 0,
                textDecoration: "underline",
              }}
            >
              {showMeta ? "hide metadata" : "show metadata"}
            </button>
          )}
        </div>
        {showMeta && (
          <pre
            aria-label="Event metadata"
            style={{
              margin: "6px 0 0",
              padding: "6px 10px",
              background: "#f8fafc",
              borderRadius: 4,
              fontSize: 10,
              color: "#6b7280",
              overflowX: "auto",
            }}
          >
            {JSON.stringify(event.metadata, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page content
// ---------------------------------------------------------------------------

function ExplainabilityContent() {
  const searchParams = useSearchParams();
  const initialSnapshotId = searchParams.get("snapshot_id") ?? "";

  const [snapshotIdInput, setSnapshotIdInput] = useState(initialSnapshotId);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ExplainabilityData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"included" | "excluded" | "events">("included");

  const loadExplainability = useCallback(async (snapshotId: string) => {
    if (!snapshotId.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/v1/snapshots/${encodeURIComponent(snapshotId.trim())}/explainability`,
        { headers: { Authorization: "Bearer prototype-dev-token" } },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const json: ExplainabilityData = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load explainability data.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-load when snapshot_id is in query params
  useEffect(() => {
    if (initialSnapshotId) {
      loadExplainability(initialSnapshotId);
    }
  }, [initialSnapshotId, loadExplainability]);

  function handleLookup(e: React.FormEvent) {
    e.preventDefault();
    loadExplainability(snapshotIdInput);
  }

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "32px 24px" }}>
      <h1 style={{ margin: "0 0 8px", fontSize: 24, fontWeight: 700 }}>
        Explainability &amp; Audit
      </h1>
      <p style={{ margin: "0 0 24px", color: "#6b7280", fontSize: 14 }}>
        Inspect per-item rationale, excluded-item reason codes, and the full run event
        stream for any curated context snapshot.
      </p>

      {/* Snapshot lookup form */}
      <form
        onSubmit={handleLookup}
        aria-label="Snapshot lookup form"
        style={{
          display: "flex",
          gap: 10,
          marginBottom: 28,
          alignItems: "flex-end",
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: 1, minWidth: 260 }}>
          <label
            htmlFor="snapshot-id-input"
            style={{ display: "block", fontWeight: 600, marginBottom: 6, fontSize: 13 }}
          >
            Snapshot ID
          </label>
          <input
            id="snapshot-id-input"
            type="text"
            value={snapshotIdInput}
            onChange={(e) => setSnapshotIdInput(e.target.value)}
            placeholder="snap-xxxxxxxx-xxxx-…"
            style={{
              width: "100%",
              padding: "8px 10px",
              borderRadius: 6,
              border: "1px solid #d1d5db",
              fontSize: 13,
              fontFamily: "monospace",
              boxSizing: "border-box",
            }}
          />
        </div>
        <button
          type="submit"
          disabled={loading || !snapshotIdInput.trim()}
          aria-label="Load explainability data"
          style={{
            padding: "8px 18px",
            background: loading || !snapshotIdInput.trim() ? "#e5e7eb" : "#6d28d9",
            color: loading || !snapshotIdInput.trim() ? "#9ca3af" : "#fff",
            border: "none",
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 600,
            cursor: loading || !snapshotIdInput.trim() ? "default" : "pointer",
          }}
        >
          {loading ? "Loading…" : "Load"}
        </button>
      </form>

      {error && (
        <div
          role="alert"
          style={{
            padding: "12px 16px",
            background: "#fef2f2",
            border: "1px solid #fca5a5",
            borderRadius: 8,
            color: "#dc2626",
            fontSize: 13,
            marginBottom: 20,
          }}
        >
          {error}
        </div>
      )}

      {/* Data display */}
      {data && (
        <div>
          {/* Header metadata */}
          <div
            aria-label="Snapshot metadata"
            style={{
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
              borderRadius: 8,
              padding: "14px 16px",
              marginBottom: 20,
              fontSize: 12,
              color: "#6b7280",
            }}
          >
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 24px" }}>
              <span>
                <strong style={{ color: "#374151" }}>Snapshot:</strong>{" "}
                <code style={{ fontSize: 11 }}>{data.snapshot_id}</code>
              </span>
              <span>
                <strong style={{ color: "#374151" }}>Run:</strong>{" "}
                <code style={{ fontSize: 11 }}>{data.run_id}</code>
              </span>
              <span>
                <strong style={{ color: "#374151" }}>Task:</strong>{" "}
                <code style={{ fontSize: 11 }}>{data.task_id}</code>
              </span>
              <span>
                <strong style={{ color: "#374151" }}>Project:</strong> {data.project_id}
              </span>
              <span>
                <strong style={{ color: "#374151" }}>Created:</strong>{" "}
                {new Date(data.created_at).toLocaleString()}
              </span>
            </div>
          </div>

          {/* Tabs */}
          <div
            role="tablist"
            style={{
              display: "flex",
              gap: 2,
              marginBottom: 20,
              borderBottom: "2px solid #e5e7eb",
            }}
          >
            {(
              [
                { key: "included", label: `Included (${data.selected_items.length})` },
                { key: "excluded", label: `Excluded (${data.dropped_items.length})` },
                { key: "events", label: `Run Events (${data.run_events.length})` },
              ] as { key: "included" | "excluded" | "events"; label: string }[]
            ).map(({ key, label }) => (
              <button
                key={key}
                role="tab"
                aria-selected={activeTab === key}
                onClick={() => setActiveTab(key)}
                style={{
                  padding: "8px 16px",
                  background: "none",
                  border: "none",
                  borderBottom: activeTab === key ? "2px solid #6d28d9" : "2px solid transparent",
                  marginBottom: -2,
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: activeTab === key ? 700 : 400,
                  color: activeTab === key ? "#6d28d9" : "#6b7280",
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Included items tab */}
          {activeTab === "included" && (
            <section aria-label="Included items rationale">
              {data.selected_items.length === 0 ? (
                <p style={{ color: "#9ca3af", fontSize: 13 }}>No included items.</p>
              ) : (
                data.selected_items.map((item) => (
                  <RationaleCard key={item.item_id} item={item} />
                ))
              )}
            </section>
          )}

          {/* Excluded items tab */}
          {activeTab === "excluded" && (
            <section aria-label="Excluded items">
              {data.dropped_items.length === 0 ? (
                <p style={{ color: "#9ca3af", fontSize: 13 }}>No excluded items recorded.</p>
              ) : (
                data.dropped_items.map((item) => (
                  <NonInclusionCard key={item.item_id} item={item} />
                ))
              )}
            </section>
          )}

          {/* Run events tab */}
          {activeTab === "events" && (
            <section aria-label="Run event stream">
              {data.run_events.length === 0 ? (
                <p style={{ color: "#9ca3af", fontSize: 13 }}>
                  No run events recorded for this snapshot yet.
                  Run events are generated when you curate or confirm a subtask.
                </p>
              ) : (
                <div
                  style={{
                    border: "1px solid #e5e7eb",
                    borderRadius: 8,
                    padding: "8px 16px",
                    background: "#fff",
                  }}
                >
                  {data.run_events.map((ev) => (
                    <RunEventRow key={ev.event_id} event={ev} />
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {/* Empty state */}
      {!data && !loading && !error && (
        <div
          style={{
            textAlign: "center",
            padding: "60px 24px",
            color: "#9ca3af",
            border: "1px dashed #d1d5db",
            borderRadius: 12,
          }}
        >
          <div style={{ fontSize: 40, marginBottom: 16 }}>🔍</div>
          <p style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 600, color: "#6b7280" }}>
            Enter a snapshot ID to inspect
          </p>
          <p style={{ margin: 0, fontSize: 13 }}>
            Copy a snapshot ID from the Task Planner after curating a subtask.
          </p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page export (wraps content in Suspense for useSearchParams)
// ---------------------------------------------------------------------------

export default function ExplainabilityPage() {
  return (
    <Suspense fallback={<div style={{ padding: "32px 24px", color: "#6b7280" }}>Loading…</div>}>
      <ExplainabilityContent />
    </Suspense>
  );
}
