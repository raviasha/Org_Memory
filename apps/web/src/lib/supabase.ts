/**
 * Supabase client helpers — Session 1c
 *
 * Server-side (service-role) and browser-side (anon + user JWT) clients.
 * API routes always use createServerClient() which bypasses RLS.
 * Browser components use createBrowserClient() which is scoped to the
 * authenticated user's JWT via Supabase Auth.
 */
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) throw new Error("Missing env: NEXT_PUBLIC_SUPABASE_URL");
if (!supabaseAnonKey)
  throw new Error("Missing env: NEXT_PUBLIC_SUPABASE_ANON_KEY");

/**
 * Browser-facing client.
 * Uses the anon key; RLS enforced via the user's JWT from Supabase Auth.
 */
export function createBrowserClient() {
  return createClient(supabaseUrl!, supabaseAnonKey!);
}

/**
 * Server-side client for use in Next.js Route Handlers and Server Components.
 * Uses the service-role key — RLS is bypassed; ACL enforcement is the
 * application's responsibility.
 */
export function createServerClient() {
  if (!supabaseServiceKey)
    throw new Error("Missing env: SUPABASE_SERVICE_ROLE_KEY");
  return createClient(supabaseUrl!, supabaseServiceKey, {
    auth: { persistSession: false },
  });
}

/**
 * Verify a user-supplied Bearer token by asking Supabase Auth for the user.
 * Returns the user object on success, null on failure.
 */
export async function getUserFromToken(bearerToken: string) {
  const client = createClient(supabaseUrl!, supabaseAnonKey!);
  const { data, error } = await client.auth.getUser(bearerToken);
  if (error || !data.user) return null;
  return data.user;
}
