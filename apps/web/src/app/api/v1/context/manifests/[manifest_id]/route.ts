/**
 * GET /api/v1/context/manifests/[manifest_id] — Session 12
 *
 * Retrieve a persisted curation manifest by ID.
 *
 * Response 200: full CurationManifest + context_pack_json
 * Response 404: manifest not found
 * Response 401: missing auth
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

async function verifyAuth(req: NextRequest): Promise<boolean> {
  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return false;
  const token = authHeader.slice(7).trim();
  if (!token) return false;

  const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnon) return true;

  try {
    const client = createClient(supabaseUrl, supabaseAnon);
    const { error } = await client.auth.getUser(token);
    return !error;
  } catch {
    return true;
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: { manifest_id: string } },
): Promise<NextResponse> {
  const authed = await verifyAuth(req);
  if (!authed) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { manifest_id: manifestId } = params;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (supabaseUrl && serviceKey) {
    try {
      const supabase = createClient(supabaseUrl, serviceKey);
      const { data, error } = await supabase
        .from("curation_manifests")
        .select("*")
        .eq("manifest_id", manifestId)
        .maybeSingle();

      if (error) {
        console.error("manifest lookup error:", error);
        return NextResponse.json(
          { error: "Internal Server Error" },
          { status: 500 },
        );
      }

      if (!data) {
        return NextResponse.json(
          { error: "Not Found", manifest_id: manifestId },
          { status: 404 },
        );
      }

      return NextResponse.json(data);
    } catch (err) {
      console.error("manifest GET error:", err);
      // Fall through to 404 fallback
    }
  }

  // When Supabase is not configured (dev / CI), return 404.
  return NextResponse.json(
    { error: "Not Found", manifest_id: manifestId },
    { status: 404 },
  );
}
