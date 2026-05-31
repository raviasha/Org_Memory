/**
 * POST /api/v1/provider/validate — Session 15
 *
 * Validates provider configuration and enforces the dual-API-key constraint.
 *
 * When provider === "openai", both a Claude key and an OpenAI key are required.
 * Claude is always needed for memory store operations; OpenAI is used only for
 * the execution step.
 *
 * Request body:
 * {
 *   provider:        "claude" | "openai"
 *   claude_api_key?: string   // always required (unless stub mode)
 *   openai_api_key?: string   // required when provider === "openai"
 * }
 *
 * Response 200 (valid):
 * {
 *   valid:             true
 *   provider:          "claude" | "openai"
 *   stub_mode:         boolean
 *   memory_provider:   "claude" | undefined
 *   dual_key_required: boolean
 *   message:           string
 * }
 *
 * Response 400 (invalid config):
 * {
 *   valid:   false
 *   errors:  string[]
 * }
 *
 * Response 401: missing auth
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { validateProviderKeys, Provider } from "../../../../../lib/provider-adapter";

async function verifyAuth(req: NextRequest): Promise<boolean> {
  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return false;
  const token = authHeader.slice(7).trim();
  if (!token) return false;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) return true;

  try {
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const { error } = await supabase.auth.getUser(token);
    return !error;
  } catch {
    return true;
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const authed = await verifyAuth(req);
  if (!authed) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const provider = (body.provider as string) ?? "claude";
  if (provider !== "claude" && provider !== "openai") {
    return NextResponse.json(
      { valid: false, errors: ['provider must be "claude" or "openai".'] },
      { status: 400 },
    );
  }

  const config = {
    provider: provider as Provider,
    claude_api_key:
      typeof body.claude_api_key === "string" ? body.claude_api_key : undefined,
    openai_api_key:
      typeof body.openai_api_key === "string" ? body.openai_api_key : undefined,
  };

  const result = validateProviderKeys(config);

  if (!result.valid) {
    return NextResponse.json(
      { valid: false, errors: result.errors },
      { status: 400 },
    );
  }

  const message = result.stub_mode
    ? "No API keys provided — stub mode will be used for execution."
    : provider === "openai"
    ? "Configuration valid. OpenAI will be used for execution; Claude will be used for memory store operations."
    : "Configuration valid. Claude will be used for both execution and memory store operations.";

  return NextResponse.json({
    valid: true,
    provider,
    stub_mode: result.stub_mode,
    memory_provider: result.memory_provider ?? "claude",
    dual_key_required: provider === "openai",
    message,
  });
}
