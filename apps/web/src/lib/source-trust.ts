/**
 * source-trust.ts — Session 17b
 *
 * Security policy helpers for ingest poisoning controls and source trust
 * governance. The policy is intentionally heuristic and deterministic in v1.
 */

export type TrustReasonCode =
  | "prompt_injection_pattern"
  | "suspicious_repetition"
  | "high_control_token_density"
  | "contains_exfiltration_phrase"
  | "empty_normalized_text"
  | "stale_source_demotion";

export interface TrustPolicyInput {
  sourceType: string;
  fileNameOrUrl: string;
  normalizedText: string;
}

export interface TrustPolicyResult {
  quarantined: boolean;
  riskScore: number;
  reasonCodes: TrustReasonCode[];
}

export interface TrustGovernanceMetadata {
  state: "allowed" | "quarantined" | "overridden";
  risk_score: number;
  reason_codes: TrustReasonCode[];
  evaluated_at: string;
  policy_version: string;
  override?: {
    approved: boolean;
    approved_at: string;
    approved_by: string;
    reason: string;
  };
}

const POLICY_VERSION = "session17b-v1";

const PROMPT_INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior)\s+instructions?/i,
  /disregard\s+the\s+(system|developer)\s+prompt/i,
  /reveal\s+(the\s+)?(system|developer)\s+prompt/i,
  /you\s+are\s+now\s+in\s+developer\s+mode/i,
  /override\s+safety/i,
];

const EXFILTRATION_PATTERNS: RegExp[] = [
  /exfiltrat(e|ion)/i,
  /api\s*key/i,
  /token\s+dump/i,
  /credential(s)?\s+leak/i,
  /paste\s+secrets?/i,
];

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function countPatternHits(input: string, patterns: RegExp[]): number {
  return patterns.reduce((count, pattern) => count + (pattern.test(input) ? 1 : 0), 0);
}

function repetitionRatio(text: string): number {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 4) return 0;

  const seen = new Map<string, number>();
  for (const line of lines) {
    seen.set(line, (seen.get(line) ?? 0) + 1);
  }

  const maxCount = Math.max(...seen.values());
  return maxCount / lines.length;
}

function controlTokenDensity(text: string): number {
  if (!text) return 0;
  const controlTokens = (text.match(/[{}<>\[\]`$]/g) ?? []).length;
  return controlTokens / Math.max(1, text.length);
}

export function evaluateSourceTrust(input: TrustPolicyInput): TrustPolicyResult {
  const normalizedText = input.normalizedText.trim();
  const reasonCodes: TrustReasonCode[] = [];
  let riskScore = 0;

  if (!normalizedText) {
    reasonCodes.push("empty_normalized_text");
    riskScore += 0.5;
  }

  const injectionHits = countPatternHits(normalizedText, PROMPT_INJECTION_PATTERNS);
  if (injectionHits > 0) {
    reasonCodes.push("prompt_injection_pattern");
    riskScore += Math.min(0.75, 0.35 + injectionHits * 0.2);
  }

  const exfiltrationHits = countPatternHits(normalizedText, EXFILTRATION_PATTERNS);
  if (exfiltrationHits > 0) {
    reasonCodes.push("contains_exfiltration_phrase");
    riskScore += Math.min(0.45, 0.15 + exfiltrationHits * 0.1);
  }

  const repeatRatio = repetitionRatio(normalizedText);
  if (repeatRatio >= 0.45) {
    reasonCodes.push("suspicious_repetition");
    riskScore += Math.min(0.35, repeatRatio * 0.5);
  }

  const ctrlDensity = controlTokenDensity(normalizedText);
  if (ctrlDensity >= 0.08) {
    reasonCodes.push("high_control_token_density");
    riskScore += Math.min(0.25, ctrlDensity);
  }

  riskScore = clamp01(riskScore);
  const quarantined = riskScore >= 0.6;

  return {
    quarantined,
    riskScore,
    reasonCodes,
  };
}

export function buildTrustGovernanceMetadata(
  result: TrustPolicyResult,
  evaluatedAt: string,
): TrustGovernanceMetadata {
  return {
    state: result.quarantined ? "quarantined" : "allowed",
    risk_score: result.riskScore,
    reason_codes: result.reasonCodes,
    evaluated_at: evaluatedAt,
    policy_version: POLICY_VERSION,
  };
}

export function isAssetQuarantined(lineageMetadata: unknown, ingestStatus: string | null | undefined): boolean {
  if (ingestStatus && ingestStatus !== "indexed") return true;

  if (!lineageMetadata || typeof lineageMetadata !== "object") return false;

  const trustGov = (lineageMetadata as { trust_governance?: TrustGovernanceMetadata }).trust_governance;
  if (!trustGov) return false;

  if (trustGov.state !== "quarantined") return false;
  if (trustGov.override?.approved) return false;
  return true;
}

export function staleDemotionFromAgeDays(ageDays: number): number {
  const startDays = 90;
  const endDays = 365;
  const maxPenalty = 0.2;

  if (ageDays <= startDays) return 0;
  const span = endDays - startDays;
  const ratio = clamp01((ageDays - startDays) / span);
  return parseFloat((ratio * maxPenalty).toFixed(4));
}

export function staleDemotionFromTimestamp(updatedAt: string): number {
  const ageMs = Date.now() - new Date(updatedAt).getTime();
  const ageDays = ageMs / 86_400_000;
  return staleDemotionFromAgeDays(ageDays);
}
