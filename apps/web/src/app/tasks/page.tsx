"use client";

/**
 * /tasks — Session 8c
 *
 * Task and Subtask Planner screen (external curation API surface MVP).
 *
 * Prototype mode: task decomposition is rule-based (no LLM).
 * Future sessions will wire Managed Agents (Session 8d) and full corpus
 * routing (Session 9+) to this entry point.
 */

import { useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StoreRouting {
  candidate_store_ids: string[];
  rationale: string;
  max_stores: number;
}

interface SubtaskRow {
  subtask_id: string;
  task_id: string;
  intent_label: string;
  description: string;
  expected_evidence: string[];
  store_routing: StoreRouting;
  status: string;
}

interface CuratedItem {
  item_id: string;
  type: string;
  title: string;
  inclusion_reason: string;
  token_estimate: number;
}

interface DroppedItem {
  item_id: string;
  type: string;
  title: string;
  exclusion_reason: string;
}

interface TokenBudget {
  limit: number;
  used: number;
  remaining: number;
}

interface BundleResult {
  subtask_id: string;
  task_id: string;
  snapshot_id: string;
  selected_items: CuratedItem[];
  dropped_items: DroppedItem[];
  selected_asset_ids: string[];
  token_budget: TokenBudget;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROJECTS = [
  { id: "proj-finance-infra-q3", label: "Finance Infra Q3" },
  { id: "proj-compliance-privacy", label: "Compliance & Privacy" },
  { id: "proj-eng-incident-ops", label: "Eng Incident Ops" },
  { id: "proj-corpdev-targetco-dd", label: "CorpDev TargetCo DD" },
  { id: "proj-org-shared", label: "Org Shared" },
];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PrototypeBanner() {
  return (
    <div
      role="status"
      aria-label="Prototype mode banner"
      style={{
        background: "#fff7ed",
        border: "1.5px solid #f97316",
        borderRadius: 8,
        padding: "12px 16px",
        marginBottom: 24,
        display: "flex",
        alignItems: "center",
        gap: 10,
        color: "#92400e",
        fontSize: 14,
      }}
    >
      <span style={{ fontSize: 18 }}>⚠️</span>
      <div>
        <strong>Prototype mode</strong> — Task decomposition is rule-based (no LLM).
        Evidence curation uses static corpus routing. Connect Managed Agents
        (Session 8d) for production-grade retrieval.
      </div>
    </div>
  );
}

function SubtaskCard({
  subtask,
  onCurate,
  bundle,
  curating,
}: {
  subtask: SubtaskRow;
  onCurate: (id: string) => void;
  bundle: BundleResult | null;
  curating: boolean;
}) {
  return (
    <div
      aria-label={`Subtask: ${subtask.intent_label}`}
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 8,
        padding: 16,
        marginBottom: 12,
        background: "#fff",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span
              style={{
                background: "#ede9fe",
                color: "#5b21b6",
                padding: "2px 8px",
                borderRadius: 12,
                fontSize: 11,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.03em",
              }}
            >
              {subtask.intent_label}
            </span>
            <span
              style={{
                background: subtask.status === "curated" ? "#d1fae5" : "#f3f4f6",
                color: subtask.status === "curated" ? "#065f46" : "#6b7280",
                padding: "2px 8px",
                borderRadius: 12,
                fontSize: 11,
              }}
            >
              {bundle ? "curated" : subtask.status}
            </span>
          </div>

          <p style={{ margin: "0 0 8px", fontSize: 14, color: "#374151" }}>
            {subtask.description}
          </p>

          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
            <strong>Expected evidence:</strong>{" "}
            {subtask.expected_evidence.slice(0, 3).join(", ")}
            {subtask.expected_evidence.length > 3
              ? ` +${subtask.expected_evidence.length - 3} more`
              : ""}
          </div>

          {subtask.store_routing?.candidate_store_ids?.length > 0 && (
            <div style={{ fontSize: 12, color: "#6b7280" }}>
              <strong>Candidate stores:</strong>{" "}
              {subtask.store_routing.candidate_store_ids.join(", ")}
            </div>
          )}
        </div>

        <button
          onClick={() => onCurate(subtask.subtask_id)}
          disabled={curating || !!bundle}
          aria-label={`Curate subtask ${subtask.intent_label}`}
          style={{
            marginLeft: 16,
            flexShrink: 0,
            padding: "8px 14px",
            background: bundle ? "#d1fae5" : "#6d28d9",
            color: bundle ? "#065f46" : "#fff",
            border: "none",
            borderRadius: 6,
            cursor: bundle || curating ? "default" : "pointer",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {bundle ? "Curated ✓" : curating ? "Curating…" : "Curate"}
        </button>
      </div>

      {/* Bundle preview */}
      {bundle && (
        <div
          aria-label="Curated bundle preview"
          style={{
            marginTop: 14,
            padding: 12,
            background: "#f8fafc",
            borderRadius: 6,
            border: "1px solid #e2e8f0",
            fontSize: 13,
          }}
        >
          <div style={{ display: "flex", gap: 16, marginBottom: 10, flexWrap: "wrap" }}>
            <span>
              <strong>Snapshot:</strong>{" "}
              <code style={{ fontSize: 11, background: "#e2e8f0", padding: "1px 4px", borderRadius: 3 }}>
                {bundle.snapshot_id}
              </code>
            </span>
            <span>
              <strong>Tokens:</strong> {bundle.token_budget.used} / {bundle.token_budget.limit}
            </span>
          </div>

          <div style={{ marginBottom: 8 }}>
            <strong>Selected items ({bundle.selected_items.length}):</strong>
            <ul style={{ margin: "4px 0 0 0", paddingLeft: 20 }}>
              {bundle.selected_items.map((item) => (
                <li key={item.item_id} style={{ marginBottom: 2 }}>
                  <code style={{ fontSize: 11 }}>[{item.type}]</code> {item.title}
                  <span style={{ color: "#6b7280" }}> — {item.token_estimate} tokens</span>
                </li>
              ))}
            </ul>
          </div>

          {bundle.dropped_items.length > 0 && (
            <div>
              <strong>Dropped items ({bundle.dropped_items.length}):</strong>
              <ul style={{ margin: "4px 0 0 0", paddingLeft: 20, color: "#9ca3af" }}>
                {bundle.dropped_items.map((item) => (
                  <li key={item.item_id} style={{ marginBottom: 2, fontSize: 12 }}>
                    {item.title} — {item.exclusion_reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function TaskPlannerPage() {
  const [taskText, setTaskText] = useState("");
  const [projectId, setProjectId] = useState(PROJECTS[0].id);
  const [submitting, setSubmitting] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [subtasks, setSubtasks] = useState<SubtaskRow[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  // per-subtask curating state
  const [curatingId, setCuratingId] = useState<string | null>(null);
  const [bundles, setBundles] = useState<Record<string, BundleResult>>({});

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!taskText.trim()) {
      setFormError("Task description is required.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/tasks/curate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer prototype-dev-token",
        },
        body: JSON.stringify({ task_text: taskText.trim(), project_id: projectId }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setTaskId(data.task_id);
      setSubtasks(data.subtasks ?? []);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to curate task.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCurate(subtaskId: string) {
    setCuratingId(subtaskId);
    try {
      const res = await fetch(`/api/v1/subtasks/${subtaskId}/curate`, {
        method: "POST",
        headers: { Authorization: "Bearer prototype-dev-token" },
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const data: BundleResult = await res.json();
      setBundles((prev) => ({ ...prev, [subtaskId]: data }));
    } catch {
      // Surface curate errors inline
    } finally {
      setCuratingId(null);
    }
  }

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "32px 24px" }}>
      <h1 style={{ margin: "0 0 8px", fontSize: 24, fontWeight: 700 }}>Task Planner</h1>
      <p style={{ margin: "0 0 24px", color: "#6b7280", fontSize: 14 }}>
        Describe a task to decompose it into subtasks with evidence curation targets.
      </p>

      <PrototypeBanner />

      {/* Task submission form */}
      <form
        onSubmit={handleSubmit}
        aria-label="Task curation form"
        style={{
          background: "#f9fafb",
          border: "1px solid #e5e7eb",
          borderRadius: 10,
          padding: 20,
          marginBottom: 32,
        }}
      >
        <div style={{ marginBottom: 16 }}>
          <label htmlFor="task-text" style={{ display: "block", fontWeight: 600, marginBottom: 6, fontSize: 14 }}>
            Task description
          </label>
          <textarea
            id="task-text"
            value={taskText}
            onChange={(e) => setTaskText(e.target.value)}
            placeholder="e.g. What are the key risks in the TargetCo acquisition and are we compliant with GDPR?"
            rows={4}
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 6,
              border: "1px solid #d1d5db",
              fontSize: 14,
              fontFamily: "inherit",
              resize: "vertical",
              boxSizing: "border-box",
            }}
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label htmlFor="project-select" style={{ display: "block", fontWeight: 600, marginBottom: 6, fontSize: 14 }}>
            Project
          </label>
          <select
            id="project-select"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            style={{
              padding: "8px 12px",
              borderRadius: 6,
              border: "1px solid #d1d5db",
              fontSize: 14,
              fontFamily: "inherit",
            }}
          >
            {PROJECTS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        {formError && (
          <p role="alert" style={{ color: "#dc2626", fontSize: 13, margin: "0 0 12px" }}>
            {formError}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          style={{
            padding: "10px 20px",
            background: "#6d28d9",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            fontSize: 14,
            fontWeight: 600,
            cursor: submitting ? "wait" : "pointer",
          }}
        >
          {submitting ? "Decomposing…" : "Decompose Task"}
        </button>
      </form>

      {/* Subtask results */}
      {taskId && (
        <section aria-label="Subtask results">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
              Subtasks for{" "}
              <code style={{ fontSize: 13, background: "#f3f4f6", padding: "1px 6px", borderRadius: 4 }}>
                {taskId}
              </code>
            </h2>
            <span style={{ fontSize: 13, color: "#6b7280" }}>
              {subtasks.length} subtask{subtasks.length !== 1 ? "s" : ""}
            </span>
          </div>

          {subtasks.map((st) => (
            <SubtaskCard
              key={st.subtask_id}
              subtask={st}
              onCurate={handleCurate}
              bundle={bundles[st.subtask_id] ?? null}
              curating={curatingId === st.subtask_id}
            />
          ))}
        </section>
      )}
    </div>
  );
}
