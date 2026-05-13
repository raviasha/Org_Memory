/**
 * GET /api/v1/health — Session 1c
 *
 * Auth-gated health endpoint.  Requires a valid `Authorization: Bearer <token>`
 * header.  Used by the Session 1c Playwright API test to confirm that
 * unauthenticated callers receive a 401 response.
 *
 * Token validation strategy (v1 prototype):
 * - If no Bearer token is present → 401.
 * - If a token is present → attempt to verify via Supabase Auth.  When
 *   Supabase is not reachable (e.g. local dev without a running instance),
 *   the endpoint returns 200 so the E2E flow stays unblocked.  Full JWT
 *   enforcement will be tightened once the Supabase local stack is wired.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return NextResponse.json(
      {
        error: "Unauthorized",
        message:
          "A Bearer token is required. Pass `Authorization: Bearer <token>`.",
      },
      { status: 401 },
    );
  }

  // Token present; validate against Supabase Auth when the env is configured.
  // Falls back to a passing response when Supabase env vars are absent so
  // the prototype remains runnable before the local Supabase stack is started.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (supabaseUrl && supabaseAnonKey) {
    try {
      const { createClient } = await import("@supabase/supabase-js");
      const client = createClient(supabaseUrl, supabaseAnonKey);
      const token = authHeader.slice("Bearer ".length);
      const { error } = await client.auth.getUser(token);
      if (error) {
        return NextResponse.json(
          { error: "Unauthorized", message: "Invalid or expired token." },
          { status: 401 },
        );
      }
    } catch {
      // Supabase unreachable; allow through in development.
    }
  }

  return NextResponse.json({
    status: "ok",
    service: "org-memory-api",
    timestamp: new Date().toISOString(),
  });
}
