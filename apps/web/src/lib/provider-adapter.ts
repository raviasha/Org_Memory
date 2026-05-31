/**
 * lib/provider-adapter.ts — Session 15
 *
 * Unified provider adapter abstraction.
 *
 * Exposes a single `executeSubtask` function that accepts a curated bundle
 * and executes it against the chosen LLM provider (Claude or OpenAI).
 *
 * Dual-API-key constraint (from plan.md Session 15):
 * ──────────────────────────────────────────────────
 * Even when OpenAI is selected as the execution provider, a Claude API key
 * is ALWAYS required for memory store operations (ingest, canonical asset
 * memory writes, store attach/detach). Only the final subtask execution step
 * uses the OpenAI adapter. This constraint is enforced in:
 *   1. validateProviderKeys() — throws before any network call
 *   2. The execute API route — returns 400 with a clear message
 *   3. The UI — displays the dual-key warning during provider selection
 *
 * Modes
 * ─────
 * REAL mode   — calls the Anthropic or OpenAI API when the corresponding key
 *               is present in the provider config.
 * STUB mode   — returns a deterministic mock response when keys are absent
 *               (local dev / CI / prototype).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Provider = "claude" | "openai";

export interface ProviderConfig {
  /** LLM provider for the execution step. */
  provider: Provider;
  /**
   * Claude API key — REQUIRED for memory store operations on every provider
   * path. When OpenAI is the execution provider this key is still needed for
   * ingest, canonical asset memory writes, and store attach/detach.
   */
  claude_api_key?: string;
  /**
   * OpenAI API key — required only when provider === "openai".
   */
  openai_api_key?: string;
}

export interface ExecutionContext {
  subtask_id: string;
  task_id: string;
  project_id: string;
  intent_label: string;
  description: string;
  snapshot_id: string;
  selected_items: SelectedItem[];
  token_budget: TokenBudget;
}

export interface SelectedItem {
  item_id: string;
  type: string;
  title: string;
  source_ref?: string;
  inclusion_reason: string;
  token_estimate: number;
}

export interface TokenBudget {
  limit: number;
  used: number;
  remaining: number;
}

export interface ExecutionResult {
  subtask_id: string;
  task_id: string;
  snapshot_id: string;
  provider: Provider;
  /** Whether this result came from the stub adapter (no real API call). */
  stub_mode: boolean;
  answer: string;
  evidence_ids: string[];
  token_usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  executed_at: string;
  /**
   * Model identifier returned by the provider.
   * e.g. "claude-opus-4-5" or "gpt-4o"
   */
  model: string;
  /**
   * Reminder shown in the response when provider === "openai" so operators
   * know memory store operations ran through Claude regardless.
   */
  memory_provider_note?: string;
}

export interface ProviderValidationResult {
  valid: boolean;
  provider: Provider;
  /** True when no API keys were provided; stub adapter will be used. */
  stub_mode: boolean;
  errors: string[];
  /**
   * Present when provider === "openai" and a Claude key is present.
   * Confirms to the caller that memory operations will run via Claude.
   */
  memory_provider?: "claude";
}

// ---------------------------------------------------------------------------
// Key validation (enforces dual-key constraint)
// ---------------------------------------------------------------------------

/**
 * Validates the provider configuration and enforces the dual-key constraint.
 *
 * Rules:
 * - provider === "claude":  claude_api_key required (if not stub mode).
 * - provider === "openai":  BOTH claude_api_key AND openai_api_key required
 *                           (if not stub mode). Memory store ops use Claude.
 *
 * If neither key is provided the function treats this as stub mode and does
 * not error — useful for local dev and CI runs without real API keys.
 */
export function validateProviderKeys(config: ProviderConfig): ProviderValidationResult {
  const errors: string[] = [];
  const hasClaudeKey = !!config.claude_api_key?.trim();
  const hasOpenAIKey = !!config.openai_api_key?.trim();

  // Stub mode: neither key present — allow through for dev/CI
  if (!hasClaudeKey && !hasOpenAIKey) {
    return {
      valid: true,
      provider: config.provider,
      stub_mode: true,
      errors: [],
      memory_provider: config.provider === "openai" ? "claude" : undefined,
    };
  }

  if (config.provider === "claude") {
    if (!hasClaudeKey) {
      errors.push("claude_api_key is required when provider is claude.");
    }
  }

  if (config.provider === "openai") {
    if (!hasClaudeKey) {
      errors.push(
        "claude_api_key is required for memory store operations even when using " +
          "OpenAI as the execution provider. Memory store operations (ingest, canonical " +
          "asset memory writes, store attach/detach) always use Claude.",
      );
    }
    if (!hasOpenAIKey) {
      errors.push("openai_api_key is required when provider is openai.");
    }
  }

  return {
    valid: errors.length === 0,
    provider: config.provider,
    stub_mode: false,
    errors,
    memory_provider: config.provider === "openai" ? "claude" : undefined,
  };
}

// ---------------------------------------------------------------------------
// Stub adapter
// ---------------------------------------------------------------------------

function stubExecute(ctx: ExecutionContext, provider: Provider): ExecutionResult {
  return {
    subtask_id: ctx.subtask_id,
    task_id: ctx.task_id,
    snapshot_id: ctx.snapshot_id,
    provider,
    stub_mode: true,
    answer:
      `[Stub response — ${provider} adapter] Based on the curated context for ` +
      `"${ctx.description}", the following analysis applies to the ${ctx.selected_items.length} ` +
      `selected evidence items: ${ctx.selected_items.map((i) => i.title).join(", ")}. ` +
      `Connect a real API key to run live inference.`,
    evidence_ids: ctx.selected_items.map((i) => i.item_id),
    token_usage: {
      prompt_tokens: ctx.token_budget.used,
      completion_tokens: 256,
      total_tokens: ctx.token_budget.used + 256,
    },
    executed_at: new Date().toISOString(),
    model: provider === "claude" ? "claude-opus-4-5-stub" : "gpt-4o-stub",
    memory_provider_note:
      provider === "openai"
        ? "Memory store operations ran via Claude (dual-key requirement)."
        : undefined,
  };
}

// ---------------------------------------------------------------------------
// Claude adapter
// ---------------------------------------------------------------------------

async function claudeExecute(
  ctx: ExecutionContext,
  apiKey: string,
): Promise<ExecutionResult> {
  const systemPrompt =
    "You are an enterprise knowledge assistant. Use the provided curated context " +
    "to answer the subtask. Cite specific evidence items by title where possible. " +
    "Be concise and structured.";

  const userMessage =
    `Subtask: ${ctx.description}\n\n` +
    `Curated context (${ctx.selected_items.length} items):\n` +
    ctx.selected_items
      .map((i, idx) => `${idx + 1}. [${i.type}] ${i.title}\n   Reason: ${i.inclusion_reason}`)
      .join("\n");

  const requestBody = {
    model: "claude-opus-4-5",
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  };

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => "");
    throw new Error(`Anthropic API error ${response.status}: ${errBody}`);
  }

  const data = (await response.json()) as {
    id: string;
    model: string;
    content: { type: string; text?: string }[];
    usage: { input_tokens: number; output_tokens: number };
  };

  const answerText =
    data.content
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("") || "(no text response)";

  return {
    subtask_id: ctx.subtask_id,
    task_id: ctx.task_id,
    snapshot_id: ctx.snapshot_id,
    provider: "claude",
    stub_mode: false,
    answer: answerText,
    evidence_ids: ctx.selected_items.map((i) => i.item_id),
    token_usage: {
      prompt_tokens: data.usage.input_tokens,
      completion_tokens: data.usage.output_tokens,
      total_tokens: data.usage.input_tokens + data.usage.output_tokens,
    },
    executed_at: new Date().toISOString(),
    model: data.model,
  };
}

// ---------------------------------------------------------------------------
// OpenAI adapter
// ---------------------------------------------------------------------------

async function openaiExecute(
  ctx: ExecutionContext,
  openaiKey: string,
): Promise<ExecutionResult> {
  const systemPrompt =
    "You are an enterprise knowledge assistant. Use the provided curated context " +
    "to answer the subtask. Cite specific evidence items by title where possible. " +
    "Be concise and structured.";

  const userMessage =
    `Subtask: ${ctx.description}\n\n` +
    `Curated context (${ctx.selected_items.length} items):\n` +
    ctx.selected_items
      .map((i, idx) => `${idx + 1}. [${i.type}] ${i.title}\n   Reason: ${i.inclusion_reason}`)
      .join("\n");

  const requestBody = {
    model: "gpt-4o",
    max_tokens: 1024,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
  };

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => "");
    throw new Error(`OpenAI API error ${response.status}: ${errBody}`);
  }

  const data = (await response.json()) as {
    id: string;
    model: string;
    choices: { message: { content: string } }[];
    usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  };

  const answerText = data.choices[0]?.message?.content ?? "(no response)";

  return {
    subtask_id: ctx.subtask_id,
    task_id: ctx.task_id,
    snapshot_id: ctx.snapshot_id,
    provider: "openai",
    stub_mode: false,
    answer: answerText,
    evidence_ids: ctx.selected_items.map((i) => i.item_id),
    token_usage: {
      prompt_tokens: data.usage.prompt_tokens,
      completion_tokens: data.usage.completion_tokens,
      total_tokens: data.usage.total_tokens,
    },
    executed_at: new Date().toISOString(),
    model: data.model,
    memory_provider_note:
      "Memory store operations ran via Claude (dual-key requirement).",
  };
}

// ---------------------------------------------------------------------------
// Public entrypoint
// ---------------------------------------------------------------------------

/**
 * Execute a subtask using the configured provider.
 *
 * Validates the provider config before any network call. In stub mode
 * (no API keys) returns a deterministic mock result.
 *
 * @throws if validation fails (dual-key constraint not satisfied)
 * @throws if the real API call fails
 */
export async function executeSubtask(
  ctx: ExecutionContext,
  config: ProviderConfig,
): Promise<ExecutionResult> {
  const validation = validateProviderKeys(config);
  if (!validation.valid) {
    throw new Error(validation.errors.join(" "));
  }

  if (validation.stub_mode) {
    return stubExecute(ctx, config.provider);
  }

  if (config.provider === "openai") {
    // Memory operations (handled elsewhere) use the Claude key.
    // Execution uses the OpenAI key.
    return openaiExecute(ctx, config.openai_api_key!);
  }

  // Default: Claude execution
  return claudeExecute(ctx, config.claude_api_key!);
}
