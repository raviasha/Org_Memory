/**
 * GET /api/v1/assets/[asset_id]/representations — Session 5b
 *
 * Returns all representations for a canonical asset record:
 *   - raw_location:          original file path or URL
 *   - normalized_text:       text derivative used for retrieval and wiki shaping
 *   - extraction_metadata:   type-specific extraction data
 *       Documents: { source_format, mime_type, character_count }
 *       Images:    { ocr_text, caption, ocr_confidence, mime_type }
 *   - provenance_hash:       SHA-256 content hash (content_hash column)
 *   - binary_ref:            signed URL for binary original, or null
 *   - acl_scope:             ACL scope of the asset
 *   - ingested_at:           ingestion timestamp
 *   - last_modified_at:      last modification timestamp
 *
 * Signed URL generation
 * ---------------------
 * When `optional_binary_ref` is set and Supabase Storage is configured, the
 * endpoint generates a 1-hour signed URL from the "assets" bucket and returns
 * it as `binary_ref`.  When Storage is unavailable the storage path is
 * returned as-is so the caller knows the object exists.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

async function verifyAuth(
  request: NextRequest,
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Unauthorized", code: "missing_bearer_token" },
        { status: 401 },
      ),
    };
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (supabaseUrl && supabaseAnonKey) {
    try {
      const { createClient } = await import("@supabase/supabase-js");
      const client = createClient(supabaseUrl, supabaseAnonKey);
      const token = authHeader.slice("Bearer ".length);
      const { error } = await client.auth.getUser(token);
      if (error) {
        return {
          ok: false,
          response: NextResponse.json(
            { error: "Unauthorized", code: "invalid_token" },
            { status: 401 },
          ),
        };
      }
    } catch {
      // Supabase unreachable — allow through in development.
    }
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

interface RouteContext {
  params: Promise<{ asset_id: string }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await verifyAuth(request);
  if (!auth.ok) return auth.response;

  const { asset_id } = await context.params;

  if (!asset_id) {
    return NextResponse.json(
      { error: "Missing asset_id", code: "missing_param" },
      { status: 400 },
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (supabaseUrl && supabaseServiceKey) {
    try {
      const { createClient } = await import("@supabase/supabase-js");
      const db = createClient(supabaseUrl, supabaseServiceKey, {
        auth: { persistSession: false },
      });

      const { data: asset, error: assetErr } = await db
        .from("assets")
        .select(
          "asset_id, file_path_or_url, normalized_text, extraction_metadata, " +
            "content_hash, optional_binary_ref, acl_scope, ingested_at, last_modified_at",
        )
        .eq("asset_id", asset_id)
        .maybeSingle();

      if (assetErr) throw assetErr;
      if (!asset) {
        return NextResponse.json(
          { error: "Asset not found", code: "not_found" },
          { status: 404 },
        );
      }

      // Generate signed URL for binary original if available.
      let binary_ref: string | null = asset.optional_binary_ref;
      if (binary_ref) {
        try {
          const { data: signed, error: signErr } = await db.storage
            .from("assets")
            .createSignedUrl(binary_ref, 3600); // 1 hour

          if (!signErr && signed?.signedUrl) {
            binary_ref = signed.signedUrl;
          }
          // On error keep the raw storage path so caller knows object exists.
        } catch {
          // Storage unavailable — return storage path as-is.
        }
      }

      return NextResponse.json({
        asset_id: asset.asset_id,
        raw_location: asset.file_path_or_url,
        normalized_text: asset.normalized_text ?? null,
        extraction_metadata: asset.extraction_metadata ?? null,
        provenance_hash: asset.content_hash ?? null,
        binary_ref,
        acl_scope: asset.acl_scope,
        ingested_at: asset.ingested_at,
        last_modified_at: asset.last_modified_at,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { error: "Database error", code: "db_error", details: msg },
        { status: 500 },
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Fallback (no Supabase) — 404 since we have no in-memory store
  // ---------------------------------------------------------------------------
  return NextResponse.json(
    { error: "Asset not found", code: "not_found" },
    { status: 404 },
  );
}
