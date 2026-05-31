"use client";

/**
 * /tasks — Session 8c + Session 13 + Session 14 + Session 15
 *
 * Task and Subtask Planner screen.
 * Session 8c: task decomposition and subtask curation.
 * Session 13: context review and override UX — inspect, add, remove, and
 *             confirm context items before execution.
 * Session 14: rationale overlay enhancements — retrieval level badges, score
 *             display, and "Explain" deep-links to the explainability screen.
 * Session 15: provider selection UI with dual-key constraint warning and
 *             Run button that executes the confirmed subtask.
 */

import { useState } from "react";
import Link from "next/link";

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
  source_ref?: string;
  inclusion_reason: string;
  token_estimate: number;
}

/** A custom item the user is adding during context review. */
interface PendingAddItem {
  tempId: string;
  title: string;
  content: string;
}

/** Override state tracked per subtask. */
interface OverrideState {
  removedItemIds: Set<string>;
  pendingAdditions: PendingAddItem[];
  overrideReason: string;
}

/** Provider config maintained in session state. */
interface ProviderConfig {
  provider: "claude" | "openai";
  claude_api_key: string;
  openai_api_key: string;
}

/** Result returned by POST /execute. */
interface ExecutionResult {
  subtask_id: string;
  task_id: string;
  snapshot_id: string;
  provider: "claude" | "openai";
  stub_mode: boolean;
  answer: string;
  evidence_ids: string[];
  token_usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  executed_at: string;
  model: string;
  memory_provider_note?: string;
}

/** Confirmed pack returned by POST /confirm. */
interface ConfirmedResult {
  subtask_id: string;
  task_id: string;
  original_snapshot_id: string;
  confirmed_snapshot_id: string;
  final_selected_items: CuratedItem[];
  removed_items: { item_id: string; title: string; removal_reason: string }[];
  added_items: CuratedItem[];
  token_budget: TokenBudget;
  override_summary: {
    removed_count: number;
    added_count: number;
    override_reason: string;
    overridden_at: string;
  };
  confirmed_at: string;
}

interface DroppedItem {
  item_id: string;
  type: string;
  title: string;
  exclusion_reason: string;
}

interface RationaleEntry {
  item_id: string;
  rationale: string;
  retrieval_level: "level_0" | "level_1" | "level_2";
  score: number;
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
  rationale_trace: RationaleEntry[];
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

const TOKENS_PER_MANUAL_ITEM = 480;

// ---------------------------------------------------------------------------
// Retrieval level helpers
// ---------------------------------------------------------------------------

function retrievalLevelLabel(level: string | null | undefined): string {
  switch (level) {
    case "level_0": return "L0";
    case "level_1": return "L1";
    case "level_2": return "L2";
    default: return "";
  }
}

function retrievalLevelStyle(level: string | null | undefined): React.CSSProperties {
  switch (level) {
    case "level_0": return { background: "#dbeafe", color: "#1d4ed8" };
    case "level_1": return { background: "#d1fae5", color: "#065f46" };
    case "level_2": return { background: "#ede9fe", color: "#5b21b6" };
    default: return { background: "#f3f4f6", color: "#6b7280" };
  }
}

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
  override,
  confirmed,
  confirming,
  onToggleRemove,
  onAddItem,
  onRemovePending,
  onOverrideReasonChange,
  onConfirm,
  onExecute,
  executing,
  executionResult,
  executionError,
  providerLabel,
}: {
  subtask: SubtaskRow;
  onCurate: (id: string) => void;
  bundle: BundleResult | null;
  curating: boolean;
  override: OverrideState;
  confirmed: ConfirmedResult | null;
  confirming: boolean;
  onToggleRemove: (itemId: string) => void;
  onAddItem: (item: Omit<PendingAddItem, "tempId">) => void;
  onRemovePending: (tempId: string) => void;
  onOverrideReasonChange: (reason: string) => void;
  onConfirm: () => void;
  onExecute: () => void;
  executing: boolean;
  executionResult: ExecutionResult | null;
  executionError: string | null;
  providerLabel: "claude" | "openai";
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
                background: confirmed
                  ? "#dcfce7"
                  : bundle
                  ? "#d1fae5"
                  : "#f3f4f6",
                color: confirmed
                  ? "#15803d"
                  : bundle
                  ? "#065f46"
                  : "#6b7280",
                padding: "2px 8px",
                borderRadius: 12,
                fontSize: 11,
              }}
            >
              {confirmed ? "confirmed" : bundle ? "curated" : subtask.status}
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

      {/* Bundle metadata row — always visible once curated */}
      {bundle && (
        <div style={{ marginTop: 12, fontSize: 12, color: "#6b7280", display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
          <span>
            <strong>Snapshot:</strong>{" "}
            <code
              aria-label="Snapshot ID"
              style={{ fontSize: 11, background: "#f3f4f6", padding: "1px 4px", borderRadius: 3 }}
            >
              {bundle.snapshot_id}
            </code>
          </span>
          <span>
            {bundle.selected_items.length} items selected · {bundle.token_budget.used} tokens
          </span>
          <Link
            href={`/explainability?snapshot_id=${encodeURIComponent(bundle.snapshot_id)}`}
            aria-label={`Explain snapshot ${bundle.snapshot_id}`}
            style={{
              fontSize: 11,
              color: "#6d28d9",
              textDecoration: "underline",
              cursor: "pointer",
            }}
          >
            Explain ↗
          </Link>
        </div>
      )}

      {/* Context review panel */}
      {bundle && (
        <ContextReviewPanel
          bundle={bundle}
          rationaleTrace={bundle.rationale_trace ?? []}
          override={override}
          confirmed={confirmed}
          confirming={confirming}
          onToggleRemove={onToggleRemove}
          onAddItem={onAddItem}
          onRemovePending={onRemovePending}
          onOverrideReasonChange={onOverrideReasonChange}
          onConfirm={onConfirm}
        />
      )}

      {/* Run button (Session 15) — visible after the context pack is confirmed */}
      {confirmed && !executionResult && (
        <div style={{ marginTop: 12 }}>
          {executionError && (
            <p
              role="alert"
              aria-label={`Execution error for subtask ${subtask.intent_label}`}
              style={{ color: "#dc2626", fontSize: 13, marginBottom: 8 }}
            >
              {executionError}
            </p>
          )}
          <button
            onClick={onExecute}
            disabled={executing}
            aria-label={`Run subtask ${subtask.intent_label} via ${providerLabel}`}
            style={{
              padding: "10px 20px",
              background: executing ? "#a3a3a3" : "#0f766e",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              cursor: executing ? "wait" : "pointer",
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            {executing
              ? `Running via ${providerLabel}…`
              : `Run via ${providerLabel === "claude" ? "Claude" : "OpenAI"}`}
          </button>
        </div>
      )}

      {/* Execution result panel (Session 15) */}
      {executionResult && (
        <div
          aria-label={`Execution result for subtask ${subtask.intent_label}`}
          style={{
            marginTop: 14,
            padding: "14px 16px",
            background: "#f0fdfa",
            border: "1.5px solid #0d9488",
            borderRadius: 8,
            fontSize: 13,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 18 }}>✅</span>
            <strong style={{ color: "#134e4a" }}>
              Executed via {executionResult.provider === "claude" ? "Claude" : "OpenAI"}
            </strong>
            {executionResult.stub_mode && (
              <span
                style={{
                  background: "#fef3c7",
                  color: "#92400e",
                  padding: "1px 7px",
                  borderRadius: 10,
                  fontSize: 11,
                  fontWeight: 600,
                }}
              >
                stub mode
              </span>
            )}
            <span style={{ marginLeft: "auto", fontSize: 11, color: "#6b7280" }}>
              {executionResult.model}
            </span>
          </div>
          <div
            style={{
              background: "#fff",
              border: "1px solid #ccfbf1",
              borderRadius: 6,
              padding: "10px 12px",
              marginBottom: 8,
              whiteSpace: "pre-wrap",
              color: "#134e4a",
              fontSize: 13,
              lineHeight: 1.6,
            }}
          >
            {executionResult.answer}
          </div>
          <div style={{ display: "flex", gap: 16, fontSize: 11, color: "#6b7280", flexWrap: "wrap" }}>
            <span>
              Tokens: {executionResult.token_usage.total_tokens} total (
              {executionResult.token_usage.prompt_tokens} prompt +{" "}
              {executionResult.token_usage.completion_tokens} completion)
            </span>
            <span>{executionResult.evidence_ids.length} evidence items used</span>
            {executionResult.memory_provider_note && (
              <span style={{ color: "#b45309" }}>{executionResult.memory_provider_note}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ContextReviewPanel (Session 13 + Session 14)
// ---------------------------------------------------------------------------

function ContextReviewPanel({
  bundle,
  rationaleTrace,
  override,
  confirmed,
  confirming,
  onToggleRemove,
  onAddItem,
  onRemovePending,
  onOverrideReasonChange,
  onConfirm,
}: {
  bundle: BundleResult;
  rationaleTrace: RationaleEntry[];
  override: OverrideState;
  confirmed: ConfirmedResult | null;
  confirming: boolean;
  onToggleRemove: (itemId: string) => void;
  onAddItem: (item: Omit<PendingAddItem, "tempId">) => void;
  onRemovePending: (tempId: string) => void;
  onOverrideReasonChange: (reason: string) => void;
  onConfirm: () => void;
}) {
  const [addTitle, setAddTitle] = useState("");
  const [addContent, setAddContent] = useState("");
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  const toggleExpand = (id: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  function handleAdd() {
    if (!addTitle.trim()) return;
    onAddItem({ title: addTitle.trim(), content: addContent.trim() });
    setAddTitle("");
    setAddContent("");
  }

  // Compute live token budget considering pending removals and additions
  const liveUsed =
    bundle.selected_items
      .filter((i) => !override.removedItemIds.has(i.item_id))
      .reduce((sum, i) => sum + i.token_estimate, 0) +
    override.pendingAdditions.length * TOKENS_PER_MANUAL_ITEM;
  const liveRemaining = bundle.token_budget.limit - liveUsed;
  const budgetPct = Math.min(100, Math.round((liveUsed / bundle.token_budget.limit) * 100));

  if (confirmed) {
    return (
      <div
        aria-label="Confirmed context pack"
        style={{
          marginTop: 16,
          padding: 14,
          background: "#f0fdf4",
          border: "1.5px solid #16a34a",
          borderRadius: 8,
          fontSize: 13,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 18 }}>✅</span>
          <strong style={{ color: "#15803d" }}>Context Pack Confirmed</strong>
          <Link
            href={`/explainability?snapshot_id=${encodeURIComponent(confirmed.confirmed_snapshot_id)}`}
            aria-label="View explainability for confirmed pack"
            style={{
              marginLeft: "auto",
              fontSize: 12,
              color: "#6d28d9",
              textDecoration: "underline",
            }}
          >
            Explain ↗
          </Link>
        </div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 10 }}>
          <span>
            <strong>Original snapshot:</strong>{" "}
            <code
              aria-label="Original snapshot ID"
              style={{ fontSize: 11, background: "#dcfce7", padding: "1px 5px", borderRadius: 3 }}
            >
              {confirmed.original_snapshot_id}
            </code>
          </span>
          <span>
            <strong>Confirmed snapshot:</strong>{" "}
            <code
              aria-label="Confirmed snapshot ID"
              style={{ fontSize: 11, background: "#dcfce7", padding: "1px 5px", borderRadius: 3 }}
            >
              {confirmed.confirmed_snapshot_id}
            </code>
          </span>
        </div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 12, color: "#6b7280", fontSize: 12 }}>
          <span>
            <strong>{confirmed.final_selected_items.length}</strong> items in final pack
          </span>
          {confirmed.override_summary.removed_count > 0 && (
            <span style={{ color: "#b91c1c" }}>
              −{confirmed.override_summary.removed_count} removed
            </span>
          )}
          {confirmed.override_summary.added_count > 0 && (
            <span style={{ color: "#15803d" }}>
              +{confirmed.override_summary.added_count} added
            </span>
          )}
          <span>
            {confirmed.token_budget.used} / {confirmed.token_budget.limit} tokens
          </span>
        </div>
        <div>
          <strong>Final context items:</strong>
          <ul style={{ margin: "6px 0 0 0", paddingLeft: 20 }}>
            {confirmed.final_selected_items.map((item) => (
              <li
                key={item.item_id}
                aria-label={`Final item: ${item.title}`}
                style={{ marginBottom: 3, color: "#374151" }}
              >
                <code style={{ fontSize: 10, background: "#e5e7eb", padding: "1px 4px", borderRadius: 2 }}>
                  {item.type}
                </code>{" "}
                {item.title}
              </li>
            ))}
          </ul>
        </div>
        {confirmed.removed_items.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <strong style={{ color: "#b91c1c" }}>Removed items:</strong>
            <ul style={{ margin: "4px 0 0 0", paddingLeft: 20, color: "#9ca3af", fontSize: 12 }}>
              {confirmed.removed_items.map((r) => (
                <li key={r.item_id} style={{ marginBottom: 2 }}>
                  {r.title}
                  {r.removal_reason && (
                    <span style={{ color: "#d1d5db" }}> — {r.removal_reason}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      aria-label="Context review panel"
      style={{
        marginTop: 16,
        padding: 14,
        background: "#f8fafc",
        border: "1px solid #e2e8f0",
        borderRadius: 8,
        fontSize: 13,
      }}
    >
      {/* Token budget bar */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <span style={{ fontWeight: 600 }}>Context Budget</span>
          <span style={{ color: liveRemaining < 0 ? "#dc2626" : "#6b7280" }}>
            {liveUsed} / {bundle.token_budget.limit} tokens
            {liveRemaining < 0 && " — over budget!"}
          </span>
        </div>
        <div
          style={{
            height: 6,
            background: "#e5e7eb",
            borderRadius: 3,
            overflow: "hidden",
          }}
        >
          <div
            aria-label="Token budget bar"
            role="progressbar"
            aria-valuenow={liveUsed}
            aria-valuemin={0}
            aria-valuemax={bundle.token_budget.limit}
            style={{
              height: "100%",
              width: `${budgetPct}%`,
              background: budgetPct > 90 ? "#dc2626" : budgetPct > 70 ? "#f59e0b" : "#6d28d9",
              borderRadius: 3,
              transition: "width 0.2s",
            }}
          />
        </div>
      </div>

      {/* Selected items — editable */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>
          Selected items ({bundle.selected_items.filter((i) => !override.removedItemIds.has(i.item_id)).length} active)
        </div>
        {bundle.selected_items.map((item) => {
          const isRemoved = override.removedItemIds.has(item.item_id);
          const isExpanded = expandedItems.has(item.item_id);
          return (
            <div
              key={item.item_id}
              aria-label={`Context item: ${item.title}`}
              style={{
                display: "flex",
                flexDirection: "column",
                marginBottom: 6,
                padding: "8px 10px",
                background: isRemoved ? "#fef2f2" : "#fff",
                border: `1px solid ${isRemoved ? "#fca5a5" : "#e5e7eb"}`,
                borderRadius: 6,
                opacity: isRemoved ? 0.65 : 1,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <code
                  style={{
                    fontSize: 10,
                    background: isRemoved ? "#fee2e2" : "#ede9fe",
                    color: isRemoved ? "#b91c1c" : "#5b21b6",
                    padding: "1px 5px",
                    borderRadius: 3,
                    flexShrink: 0,
                  }}
                >
                  {item.type}
                </code>
                <span
                  style={{
                    flex: 1,
                    textDecoration: isRemoved ? "line-through" : "none",
                    color: isRemoved ? "#9ca3af" : "#374151",
                  }}
                >
                  {item.title}
                </span>
                <span style={{ color: "#9ca3af", fontSize: 11, flexShrink: 0 }}>
                  {item.token_estimate}t
                </span>
                <button
                  onClick={() => toggleExpand(item.item_id)}
                  aria-label={`${isExpanded ? "Collapse" : "Expand"} details for ${item.title}`}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "#9ca3af",
                    fontSize: 11,
                    padding: "0 4px",
                  }}
                >
                  {isExpanded ? "▲" : "▼"}
                </button>
                <button
                  onClick={() => onToggleRemove(item.item_id)}
                  aria-label={isRemoved ? `Restore ${item.title}` : `Remove ${item.title}`}
                  style={{
                    padding: "3px 8px",
                    borderRadius: 4,
                    border: `1px solid ${isRemoved ? "#16a34a" : "#dc2626"}`,
                    background: "none",
                    color: isRemoved ? "#16a34a" : "#dc2626",
                    cursor: "pointer",
                    fontSize: 11,
                    fontWeight: 600,
                    flexShrink: 0,
                  }}
                >
                  {isRemoved ? "Restore" : "Remove"}
                </button>
              </div>
              {isExpanded && (
                <div
                  aria-label={`Details for ${item.title}`}
                  style={{
                    marginTop: 8,
                    padding: "8px 10px",
                    background: "#f8fafc",
                    borderRadius: 4,
                    fontSize: 12,
                    color: "#6b7280",
                    borderLeft: "3px solid #e2e8f0",
                  }}
                >
                  <p style={{ margin: "0 0 4px" }}>
                    <strong>Inclusion reason:</strong> {item.inclusion_reason}
                  </p>
                  {(() => {
                    const trace = rationaleTrace.find((r) => r.item_id === item.item_id);
                    return trace ? (
                      <div style={{ display: "flex", gap: 12, marginTop: 4, flexWrap: "wrap", alignItems: "center" }}>
                        <span
                          style={{
                            fontSize: 10,
                            padding: "1px 7px",
                            borderRadius: 10,
                            fontWeight: 600,
                            ...retrievalLevelStyle(trace.retrieval_level),
                          }}
                        >
                          {retrievalLevelLabel(trace.retrieval_level)} · {trace.retrieval_level?.replace("_", " ")}
                        </span>
                        <span style={{ fontSize: 11 }}>
                          Score: <strong>{trace.score.toFixed(2)}</strong>
                        </span>
                      </div>
                    ) : null;
                  })()}
                  {item.source_ref && (
                    <p style={{ margin: "4px 0 0" }}>
                      <strong>Source:</strong>{" "}
                      <code style={{ fontSize: 10 }}>{item.source_ref}</code>
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Pending additions */}
      {override.pendingAdditions.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 6, color: "#15803d" }}>
            Added items ({override.pendingAdditions.length})
          </div>
          {override.pendingAdditions.map((item) => (
            <div
              key={item.tempId}
              aria-label={`Added item: ${item.title}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 6,
                padding: "8px 10px",
                background: "#f0fdf4",
                border: "1px solid #86efac",
                borderRadius: 6,
              }}
            >
              <code
                style={{
                  fontSize: 10,
                  background: "#dcfce7",
                  color: "#15803d",
                  padding: "1px 5px",
                  borderRadius: 3,
                  flexShrink: 0,
                }}
              >
                manual
              </code>
              <span style={{ flex: 1, color: "#374151" }}>{item.title}</span>
              {item.content && (
                <span style={{ color: "#9ca3af", fontSize: 11, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {item.content}
                </span>
              )}
              <span style={{ color: "#9ca3af", fontSize: 11, flexShrink: 0 }}>
                {TOKENS_PER_MANUAL_ITEM}t
              </span>
              <button
                onClick={() => onRemovePending(item.tempId)}
                aria-label={`Remove added item ${item.title}`}
                style={{
                  padding: "3px 8px",
                  borderRadius: 4,
                  border: "1px solid #dc2626",
                  background: "none",
                  color: "#dc2626",
                  cursor: "pointer",
                  fontSize: 11,
                  fontWeight: 600,
                  flexShrink: 0,
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add custom item form */}
      <div
        aria-label="Add custom context item"
        style={{
          padding: "10px 12px",
          background: "#fff",
          border: "1px dashed #c7d2fe",
          borderRadius: 6,
          marginBottom: 12,
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 8, color: "#4338ca", fontSize: 12 }}>
          + Add Custom Context Item
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            aria-label="Custom item title"
            type="text"
            value={addTitle}
            onChange={(e) => setAddTitle(e.target.value)}
            placeholder="Item title"
            style={{
              flex: 2,
              minWidth: 120,
              padding: "6px 8px",
              borderRadius: 4,
              border: "1px solid #d1d5db",
              fontSize: 12,
              fontFamily: "inherit",
            }}
          />
          <input
            aria-label="Custom item content"
            type="text"
            value={addContent}
            onChange={(e) => setAddContent(e.target.value)}
            placeholder="Content or reference (optional)"
            style={{
              flex: 3,
              minWidth: 160,
              padding: "6px 8px",
              borderRadius: 4,
              border: "1px solid #d1d5db",
              fontSize: 12,
              fontFamily: "inherit",
            }}
          />
          <button
            onClick={handleAdd}
            disabled={!addTitle.trim()}
            aria-label="Add item to context"
            style={{
              padding: "6px 14px",
              background: addTitle.trim() ? "#4338ca" : "#e5e7eb",
              color: addTitle.trim() ? "#fff" : "#9ca3af",
              border: "none",
              borderRadius: 4,
              cursor: addTitle.trim() ? "pointer" : "default",
              fontSize: 12,
              fontWeight: 600,
              flexShrink: 0,
            }}
          >
            Add
          </button>
        </div>
      </div>

      {/* Override reason */}
      <div style={{ marginBottom: 12 }}>
        <input
          aria-label="Override reason"
          type="text"
          value={override.overrideReason}
          onChange={(e) => onOverrideReasonChange(e.target.value)}
          placeholder="Optional: reason for changes (recorded in audit trail)"
          style={{
            width: "100%",
            padding: "6px 10px",
            borderRadius: 4,
            border: "1px solid #d1d5db",
            fontSize: 12,
            fontFamily: "inherit",
            boxSizing: "border-box",
            color: "#374151",
          }}
        />
      </div>

      {/* Confirm button */}
      <button
        onClick={onConfirm}
        disabled={confirming}
        aria-label="Confirm context pack"
        style={{
          width: "100%",
          padding: "10px 16px",
          background: confirming ? "#c4b5fd" : "#6d28d9",
          color: "#fff",
          border: "none",
          borderRadius: 6,
          cursor: confirming ? "wait" : "pointer",
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: "0.01em",
        }}
      >
        {confirming ? "Confirming…" : "Confirm Context Pack"}
      </button>

      {/* Dropped items (read-only) */}
      {bundle.dropped_items.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary
            style={{ cursor: "pointer", color: "#9ca3af", fontSize: 12, userSelect: "none" }}
          >
            {bundle.dropped_items.length} automatically dropped item
            {bundle.dropped_items.length !== 1 ? "s" : ""} (not selectable in v1)
          </summary>
          <ul style={{ margin: "6px 0 0 0", paddingLeft: 20, color: "#9ca3af", fontSize: 11 }}>
            {bundle.dropped_items.map((item) => (
              <li key={item.item_id} style={{ marginBottom: 2 }}>
                {item.title} — {item.exclusion_reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

function emptyOverride(): OverrideState {
  return {
    removedItemIds: new Set(),
    pendingAdditions: [],
    overrideReason: "",
  };
}

// ---------------------------------------------------------------------------
// ProviderPanel (Session 15)
// ---------------------------------------------------------------------------

function ProviderPanel({
  config,
  onChange,
}: {
  config: ProviderConfig;
  onChange: (c: ProviderConfig) => void;
}) {
  const isOpenAI = config.provider === "openai";

  return (
    <div
      aria-label="Provider selection panel"
      style={{
        background: "#f8fafc",
        border: "1.5px solid #cbd5e1",
        borderRadius: 8,
        padding: "16px 20px",
        marginBottom: 24,
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Execution Provider</div>

      {/* Provider radio buttons */}
      <div style={{ display: "flex", gap: 16, marginBottom: 12 }}>
        {(["claude", "openai"] as const).map((p) => (
          <label
            key={p}
            aria-label={`Select provider ${p}`}
            style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 14 }}
          >
            <input
              type="radio"
              name="provider"
              value={p}
              checked={config.provider === p}
              onChange={() => onChange({ ...config, provider: p })}
            />
            {p === "claude" ? "Claude" : "OpenAI"}
          </label>
        ))}
      </div>

      {/* Dual-key warning — shown when OpenAI is selected */}
      {isOpenAI && (
        <div
          role="alert"
          aria-label="Dual-key requirement notice"
          style={{
            background: "#fefce8",
            border: "1.5px solid #ca8a04",
            borderRadius: 6,
            padding: "10px 14px",
            marginBottom: 12,
            fontSize: 13,
            color: "#854d0e",
          }}
        >
          <strong>Dual-key requirement:</strong> Even when OpenAI is the execution
          provider, a Claude API key is still required for memory store operations
          (ingest, canonical asset memory writes, store attach/detach). Both keys
          must be provided for live inference.
        </div>
      )}

      {/* Claude API key */}
      <div style={{ marginBottom: 10 }}>
        <label
          htmlFor="claude-api-key"
          style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4, color: "#374151" }}
        >
          Claude API key{isOpenAI ? " (required for memory ops)" : ""}
        </label>
        <input
          id="claude-api-key"
          aria-label="Claude API key input"
          type="password"
          value={config.claude_api_key}
          onChange={(e) => onChange({ ...config, claude_api_key: e.target.value })}
          placeholder={"sk-ant-… (leave blank for stub mode)"}
          style={{
            width: "100%",
            padding: "7px 10px",
            borderRadius: 4,
            border: "1px solid #d1d5db",
            fontSize: 13,
            fontFamily: "monospace",
            boxSizing: "border-box",
            color: "#374151",
          }}
        />
      </div>

      {/* OpenAI API key — only shown when provider is openai */}
      {isOpenAI && (
        <div style={{ marginBottom: 4 }}>
          <label
            htmlFor="openai-api-key"
            style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4, color: "#374151" }}
          >
            OpenAI API key (execution)
          </label>
          <input
            id="openai-api-key"
            aria-label="OpenAI API key input"
            type="password"
            value={config.openai_api_key}
            onChange={(e) => onChange({ ...config, openai_api_key: e.target.value })}
            placeholder="sk-… (leave blank for stub mode)"
            style={{
              width: "100%",
              padding: "7px 10px",
              borderRadius: 4,
              border: "1px solid #d1d5db",
              fontSize: 13,
              fontFamily: "monospace",
              boxSizing: "border-box",
              color: "#374151",
            }}
          />
        </div>
      )}

      <p style={{ margin: "8px 0 0", fontSize: 11, color: "#6b7280" }}>
        Leave keys blank to run in stub mode (prototype demo — no real API call).
      </p>
    </div>
  );
}

export default function TaskPlannerPage() {
  const [taskText, setTaskText] = useState("");
  const [projectId, setProjectId] = useState(PROJECTS[0].id);
  const [submitting, setSubmitting] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [subtasks, setSubtasks] = useState<SubtaskRow[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  // Provider config (Session 15)
  const [providerConfig, setProviderConfig] = useState<ProviderConfig>({
    provider: "claude",
    claude_api_key: "",
    openai_api_key: "",
  });

  // Per-subtask: curating / bundle / override / confirmed / confirming / executing / executed
  const [curatingId, setCuratingId] = useState<string | null>(null);
  const [bundles, setBundles] = useState<Record<string, BundleResult>>({});
  const [overrides, setOverrides] = useState<Record<string, OverrideState>>({});
  const [confirmedBundles, setConfirmedBundles] = useState<Record<string, ConfirmedResult>>({});
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [executingId, setExecutingId] = useState<string | null>(null);
  const [executionResults, setExecutionResults] = useState<Record<string, ExecutionResult>>({});
  const [executionErrors, setExecutionErrors] = useState<Record<string, string>>({});

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

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
        throw new Error((j as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setTaskId(data.task_id);
      setSubtasks(data.subtasks ?? []);
      // Reset per-subtask state
      setBundles({});
      setOverrides({});
      setConfirmedBundles({});
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
        throw new Error((j as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const data: BundleResult = await res.json();
      setBundles((prev) => ({ ...prev, [subtaskId]: data }));
      // Initialise override state for this subtask
      setOverrides((prev) => ({
        ...prev,
        [subtaskId]: prev[subtaskId] ?? emptyOverride(),
      }));
    } catch {
      // Inline error handling omitted for brevity
    } finally {
      setCuratingId(null);
    }
  }

  function getOverride(subtaskId: string): OverrideState {
    return overrides[subtaskId] ?? emptyOverride();
  }

  function handleToggleRemove(subtaskId: string, itemId: string) {
    setOverrides((prev) => {
      const current = prev[subtaskId] ?? emptyOverride();
      const next = new Set(current.removedItemIds);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return { ...prev, [subtaskId]: { ...current, removedItemIds: next } };
    });
  }

  function handleAddItem(subtaskId: string, item: Omit<PendingAddItem, "tempId">) {
    setOverrides((prev) => {
      const current = prev[subtaskId] ?? emptyOverride();
      const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      return {
        ...prev,
        [subtaskId]: {
          ...current,
          pendingAdditions: [...current.pendingAdditions, { tempId, ...item }],
        },
      };
    });
  }

  function handleRemovePending(subtaskId: string, tempId: string) {
    setOverrides((prev) => {
      const current = prev[subtaskId] ?? emptyOverride();
      return {
        ...prev,
        [subtaskId]: {
          ...current,
          pendingAdditions: current.pendingAdditions.filter((i) => i.tempId !== tempId),
        },
      };
    });
  }

  function handleOverrideReasonChange(subtaskId: string, reason: string) {
    setOverrides((prev) => {
      const current = prev[subtaskId] ?? emptyOverride();
      return { ...prev, [subtaskId]: { ...current, overrideReason: reason } };
    });
  }

  async function handleConfirm(subtaskId: string) {
    const ov = getOverride(subtaskId);
    setConfirmingId(subtaskId);
    try {
      const res = await fetch(`/api/v1/subtasks/${subtaskId}/confirm`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer prototype-dev-token",
        },
        body: JSON.stringify({
          removed_item_ids: Array.from(ov.removedItemIds),
          added_items: ov.pendingAdditions.map((a) => ({
            title: a.title,
            content: a.content,
            item_type: "manual",
          })),
          override_reason: ov.overrideReason,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const data: ConfirmedResult = await res.json();
      setConfirmedBundles((prev) => ({ ...prev, [subtaskId]: data }));
    } catch {
      // Inline error handling omitted for brevity
    } finally {
      setConfirmingId(null);
    }
  }

  async function handleExecute(subtaskId: string) {
    setExecutingId(subtaskId);
    setExecutionErrors((prev) => {
      const next = { ...prev };
      delete next[subtaskId];
      return next;
    });
    try {
      const confirmed = confirmedBundles[subtaskId];
      const body: Record<string, unknown> = {
        provider: providerConfig.provider,
      };
      if (providerConfig.claude_api_key.trim()) {
        body.claude_api_key = providerConfig.claude_api_key.trim();
      }
      if (providerConfig.openai_api_key.trim()) {
        body.openai_api_key = providerConfig.openai_api_key.trim();
      }
      if (confirmed?.confirmed_snapshot_id) {
        body.snapshot_id = confirmed.confirmed_snapshot_id;
      }
      const res = await fetch(`/api/v1/subtasks/${subtaskId}/execute`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer prototype-dev-token",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        const msg =
          (j as { error?: string; errors?: string[] }).error ??
          ((j as { errors?: string[] }).errors ?? []).join(" ") ??
          `HTTP ${res.status}`;
        setExecutionErrors((prev) => ({ ...prev, [subtaskId]: msg }));
        return;
      }
      const data: ExecutionResult = await res.json();
      setExecutionResults((prev) => ({ ...prev, [subtaskId]: data }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Execution failed";
      setExecutionErrors((prev) => ({ ...prev, [subtaskId]: msg }));
    } finally {
      setExecutingId(null);
    }
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "32px 24px" }}>
      <h1 style={{ margin: "0 0 8px", fontSize: 24, fontWeight: 700 }}>Task Planner</h1>
      <p style={{ margin: "0 0 24px", color: "#6b7280", fontSize: 14 }}>
        Describe a task to decompose it into subtasks with evidence curation targets.
        After curating each subtask, review and edit the context items before confirming.
      </p>

      <PrototypeBanner />

      {/* Provider selection panel (Session 15) */}
      <ProviderPanel config={providerConfig} onChange={setProviderConfig} />

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
          <label
            htmlFor="task-text"
            style={{ display: "block", fontWeight: 600, marginBottom: 6, fontSize: 14 }}
          >
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
          <label
            htmlFor="project-select"
            style={{ display: "block", fontWeight: 600, marginBottom: 6, fontSize: 14 }}
          >
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
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 16,
            }}
          >
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
              Subtasks for{" "}
              <code
                style={{
                  fontSize: 13,
                  background: "#f3f4f6",
                  padding: "1px 6px",
                  borderRadius: 4,
                }}
              >
                {taskId}
              </code>
            </h2>
            <span style={{ fontSize: 13, color: "#6b7280" }}>
              {subtasks.length} subtask{subtasks.length !== 1 ? "s" : ""}
            </span>
          </div>

          {subtasks.map((st) => {
            const ov = getOverride(st.subtask_id);
            return (
              <SubtaskCard
                key={st.subtask_id}
                subtask={st}
                onCurate={handleCurate}
                bundle={bundles[st.subtask_id] ?? null}
                curating={curatingId === st.subtask_id}
                override={ov}
                confirmed={confirmedBundles[st.subtask_id] ?? null}
                confirming={confirmingId === st.subtask_id}
                onToggleRemove={(itemId) => handleToggleRemove(st.subtask_id, itemId)}
                onAddItem={(item) => handleAddItem(st.subtask_id, item)}
                onRemovePending={(tempId) => handleRemovePending(st.subtask_id, tempId)}
                onOverrideReasonChange={(reason) =>
                  handleOverrideReasonChange(st.subtask_id, reason)
                }
                onConfirm={() => handleConfirm(st.subtask_id)}
                onExecute={() => handleExecute(st.subtask_id)}
                executing={executingId === st.subtask_id}
                executionResult={executionResults[st.subtask_id] ?? null}
                executionError={executionErrors[st.subtask_id] ?? null}
                providerLabel={providerConfig.provider}
              />
            );
          })}
        </section>
      )}
    </div>
  );
}
