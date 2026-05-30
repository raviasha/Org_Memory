/**
 * lib/specific-file-picker.test.ts — Session 11
 *
 * Unit tests for the Level 2 specific-file picker.
 *
 * These tests run against the in-memory static corpus (Supabase not required).
 * They validate:
 *   - Specificity rules fire correctly for known task types.
 *   - NPV task includes the business-case file as a forced inclusion (exit criteria).
 *   - Vendor task forces vendor-comparison-matrix and RFP doc.
 *   - Incident task forces the api-gateway-runbook.
 *   - Unrelated tasks do not fire financial/ops rules.
 *   - Response structure is correct.
 *   - Limit is respected.
 *   - Output is deterministic for identical inputs.
 */

import { describe, it, expect } from "vitest";
import {
  pickSpecificFiles,
  SPECIFICITY_RULES,
} from "./specific-file-picker";
import { detectIntents } from "./retrieval-ranker";

// ---------------------------------------------------------------------------
// Fixture task texts
// ---------------------------------------------------------------------------

const NPV_TASK =
  "Calculate the NPV of the Q3 infrastructure investment at the CFO-specified discount rate and recommend whether to proceed. The proposal shows an IRR of 14.2%.";

const VENDOR_TASK =
  "Which vendor should we select based on cost, capabilities, and SLA alignment with our RFP requirements?";

const INCIDENT_TASK =
  "The API gateway is returning 502 errors in production. What are the immediate steps?";

const UNRELATED_TASK =
  "Plan the company holiday party for Q4 including catering and venue suggestions.";

// ---------------------------------------------------------------------------
// Specificity rules — unit tests
// ---------------------------------------------------------------------------

describe("SPECIFICITY_RULES", () => {
  it("fires npv-business-case rule for NPV task", () => {
    const intents = detectIntents(NPV_TASK);
    const lower = NPV_TASK.toLowerCase();
    const rule = SPECIFICITY_RULES.find((r) => r.id === "npv-business-case")!;
    expect(rule).toBeDefined();
    expect(rule.condition(lower, intents)).toBe(true);
  });

  it("targets correct file patterns for npv-business-case rule", () => {
    const rule = SPECIFICITY_RULES.find((r) => r.id === "npv-business-case")!;
    expect(rule.target_file_patterns).toContain(
      "infrastructure-investment-business-case",
    );
    expect(rule.target_file_patterns).toContain("cfo-q3-guidance");
  });

  it("fires vendor-selection-rfp rule for vendor task", () => {
    const intents = detectIntents(VENDOR_TASK);
    const lower = VENDOR_TASK.toLowerCase();
    const rule = SPECIFICITY_RULES.find((r) => r.id === "vendor-selection-rfp")!;
    expect(rule).toBeDefined();
    expect(rule.condition(lower, intents)).toBe(true);
  });

  it("fires api-gateway-incident rule for 502 incident task", () => {
    const intents = detectIntents(INCIDENT_TASK);
    const lower = INCIDENT_TASK.toLowerCase();
    const rule = SPECIFICITY_RULES.find((r) => r.id === "api-gateway-incident")!;
    expect(rule).toBeDefined();
    expect(rule.condition(lower, intents)).toBe(true);
  });

  it("does not fire financial or ops rules for unrelated holiday party task", () => {
    const intents = detectIntents(UNRELATED_TASK);
    const lower = UNRELATED_TASK.toLowerCase();
    const firedRules = SPECIFICITY_RULES.filter((r) =>
      r.condition(lower, intents),
    );
    const shouldNotFire = [
      "npv-business-case",
      "vendor-selection-rfp",
      "api-gateway-incident",
      "on-call-sla",
      "alert-drift",
    ];
    for (const ruleId of shouldNotFire) {
      const fired = firedRules.some((r) => r.id === ruleId);
      expect(fired, `Rule "${ruleId}" should not fire for holiday party task`).toBe(
        false,
      );
    }
  });

  it("all rules have non-empty target_file_patterns", () => {
    for (const rule of SPECIFICITY_RULES) {
      expect(
        rule.target_file_patterns.length,
        `Rule "${rule.id}" must have at least one target_file_pattern`,
      ).toBeGreaterThan(0);
    }
  });

  it("all rules have non-empty reason strings", () => {
    for (const rule of SPECIFICITY_RULES) {
      expect(
        rule.reason.length,
        `Rule "${rule.id}" must have a non-empty reason`,
      ).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// pickSpecificFiles — NPV task (primary exit criteria)
// ---------------------------------------------------------------------------

describe("pickSpecificFiles — NPV task (exit criteria)", () => {
  it("returns specificity_enforced=true for NPV task in finance project", async () => {
    const result = await pickSpecificFiles(NPV_TASK, {
      project_id: "proj-finance-infra-q3",
    });
    expect(result.specificity_enforced).toBe(true);
  });

  it("forced_inclusions contains the business-case file", async () => {
    const result = await pickSpecificFiles(NPV_TASK, {
      project_id: "proj-finance-infra-q3",
    });
    const businessCase = result.forced_inclusions.find((f) =>
      f.file_path_or_url?.includes("infrastructure-investment-business-case"),
    );
    expect(businessCase).toBeDefined();
    expect(businessCase!.forced).toBe(true);
    expect(businessCase!.forced_by_rule).toBe("npv-business-case");
    expect(businessCase!.retrieval_level).toBe("level_2");
  });

  it("forced_inclusions contains the CFO guidance file", async () => {
    const result = await pickSpecificFiles(NPV_TASK, {
      project_id: "proj-finance-infra-q3",
    });
    const cfoGuidance = result.forced_inclusions.find((f) =>
      f.file_path_or_url?.includes("cfo-q3-guidance"),
    );
    expect(cfoGuidance).toBeDefined();
    expect(cfoGuidance!.forced).toBe(true);
  });

  it("all forced inclusions appear at the start of the selected array", async () => {
    const result = await pickSpecificFiles(NPV_TASK, {
      project_id: "proj-finance-infra-q3",
    });
    const forcedCount = result.forced_inclusions.length;
    for (let i = 0; i < forcedCount; i++) {
      expect(result.selected[i].forced).toBe(true);
    }
  });

  it("forced inclusions are a subset of selected", async () => {
    const result = await pickSpecificFiles(NPV_TASK, {
      project_id: "proj-finance-infra-q3",
    });
    const selectedIds = new Set(result.selected.map((s) => s.evidence_id));
    for (const forced of result.forced_inclusions) {
      expect(selectedIds.has(forced.evidence_id)).toBe(true);
    }
  });

  it("detects financial_analysis as primary intent", async () => {
    const result = await pickSpecificFiles(NPV_TASK, {
      project_id: "proj-finance-infra-q3",
    });
    expect(result.intent_classes).toContain("financial_analysis");
  });

  it("all items in selected are level_2", async () => {
    const result = await pickSpecificFiles(NPV_TASK, {
      project_id: "proj-finance-infra-q3",
    });
    for (const item of result.selected) {
      expect(item.retrieval_level).toBe("level_2");
    }
  });
});

// ---------------------------------------------------------------------------
// pickSpecificFiles — vendor selection
// ---------------------------------------------------------------------------

describe("pickSpecificFiles — vendor selection", () => {
  it("forces vendor-comparison-matrix into selected", async () => {
    const result = await pickSpecificFiles(VENDOR_TASK, {
      project_id: "proj-finance-infra-q3",
    });
    const hasMatrix = result.forced_inclusions.some((f) =>
      f.file_path_or_url?.includes("vendor-comparison-matrix"),
    );
    expect(hasMatrix).toBe(true);
  });

  it("forces it-infrastructure-rfp into selected", async () => {
    const result = await pickSpecificFiles(VENDOR_TASK, {
      project_id: "proj-finance-infra-q3",
    });
    const hasRfp = result.forced_inclusions.some((f) =>
      f.file_path_or_url?.includes("it-infrastructure-rfp"),
    );
    expect(hasRfp).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// pickSpecificFiles — incident task
// ---------------------------------------------------------------------------

describe("pickSpecificFiles — API gateway incident", () => {
  it("forces api-gateway-runbook for 502 incident task", async () => {
    const result = await pickSpecificFiles(INCIDENT_TASK, {
      project_id: "proj-eng-incident-ops",
    });
    const hasRunbook = result.forced_inclusions.some((f) =>
      f.file_path_or_url?.includes("api-gateway-runbook"),
    );
    expect(hasRunbook).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// pickSpecificFiles — response structure
// ---------------------------------------------------------------------------

describe("pickSpecificFiles — response structure", () => {
  it("returns all required top-level fields", async () => {
    const result = await pickSpecificFiles(NPV_TASK, {
      project_id: "proj-finance-infra-q3",
    });
    expect(typeof result.task_text).toBe("string");
    expect(Array.isArray(result.intent_classes)).toBe(true);
    expect(typeof result.specificity_enforced).toBe("boolean");
    expect(Array.isArray(result.forced_inclusions)).toBe(true);
    expect(Array.isArray(result.missing_required_patterns)).toBe(true);
    expect(Array.isArray(result.selected)).toBe(true);
    expect(Array.isArray(result.dropped)).toBe(true);
    expect(typeof result.total_candidates).toBe("number");
  });

  it("each selected item has all required fields", async () => {
    const result = await pickSpecificFiles(NPV_TASK, {
      project_id: "proj-finance-infra-q3",
    });
    for (const item of result.selected) {
      expect(typeof item.evidence_id).toBe("string");
      expect(item.evidence_id.length).toBeGreaterThan(0);
      expect(item.retrieval_level).toBe("level_2");
      expect(typeof item.forced).toBe("boolean");
      expect(typeof item.score).toBe("number");
      expect(item.score).toBeGreaterThanOrEqual(0);
      expect(item.score).toBeLessThanOrEqual(1);
      expect(typeof item.rationale).toBe("string");
      expect(item.rationale.length).toBeGreaterThan(0);
    }
  });

  it("forced items have score=1.0", async () => {
    const result = await pickSpecificFiles(NPV_TASK, {
      project_id: "proj-finance-infra-q3",
    });
    for (const item of result.forced_inclusions) {
      expect(item.score).toBe(1.0);
    }
  });

  it("total: forced + non-forced-selected + dropped equals total_candidates", async () => {
    const result = await pickSpecificFiles(NPV_TASK, {
      project_id: "proj-finance-infra-q3",
    });
    const nonForcedSelected = result.selected.filter((s) => !s.forced).length;
    const total =
      result.forced_inclusions.length + nonForcedSelected + result.dropped.length;
    expect(total).toBe(result.total_candidates);
  });

  it("limit is respected", async () => {
    const result = await pickSpecificFiles(NPV_TASK, {
      project_id: "proj-finance-infra-q3",
      limit: 3,
    });
    expect(result.selected.length).toBeLessThanOrEqual(3);
  });

  it("limit=1 returns at most 1 item in selected", async () => {
    const result = await pickSpecificFiles(NPV_TASK, {
      project_id: "proj-finance-infra-q3",
      limit: 1,
    });
    expect(result.selected.length).toBeLessThanOrEqual(1);
  });

  it("project_id is echoed in the result", async () => {
    const result = await pickSpecificFiles(NPV_TASK, {
      project_id: "proj-finance-infra-q3",
    });
    expect(result.project_id).toBe("proj-finance-infra-q3");
  });

  it("task_text is echoed in the result", async () => {
    const result = await pickSpecificFiles(NPV_TASK, {
      project_id: "proj-finance-infra-q3",
    });
    expect(result.task_text).toBe(NPV_TASK);
  });
});

// ---------------------------------------------------------------------------
// pickSpecificFiles — determinism
// ---------------------------------------------------------------------------

describe("pickSpecificFiles — determinism", () => {
  it("two identical requests return identical selected evidence_id order", async () => {
    const opts = { project_id: "proj-finance-infra-q3" };
    const r1 = await pickSpecificFiles(NPV_TASK, opts);
    const r2 = await pickSpecificFiles(NPV_TASK, opts);
    expect(r1.selected.map((i) => i.evidence_id)).toEqual(
      r2.selected.map((i) => i.evidence_id),
    );
  });

  it("specificity_enforced is consistent across calls", async () => {
    const opts = { project_id: "proj-finance-infra-q3" };
    const r1 = await pickSpecificFiles(NPV_TASK, opts);
    const r2 = await pickSpecificFiles(NPV_TASK, opts);
    expect(r1.specificity_enforced).toBe(r2.specificity_enforced);
  });
});

// ---------------------------------------------------------------------------
// pickSpecificFiles — candidate_evidence_ids pre-filter
// ---------------------------------------------------------------------------

describe("pickSpecificFiles — candidate_evidence_ids filter", () => {
  it("only returns items within the provided candidate set", async () => {
    // a1001 = infrastructure-investment-business-case, a1002 = cfo-q3-guidance
    const result = await pickSpecificFiles(NPV_TASK, {
      project_id: "proj-finance-infra-q3",
      candidate_evidence_ids: ["a1001", "a1002"],
    });
    for (const item of result.selected) {
      expect(["a1001", "a1002"]).toContain(item.evidence_id);
    }
    expect(result.total_candidates).toBeLessThanOrEqual(2);
  });

  it("returns empty selected when no candidates match the filter", async () => {
    const result = await pickSpecificFiles(NPV_TASK, {
      project_id: "proj-finance-infra-q3",
      candidate_evidence_ids: ["nonexistent-id-xyz"],
    });
    expect(result.selected).toHaveLength(0);
    expect(result.total_candidates).toBe(0);
  });
});
