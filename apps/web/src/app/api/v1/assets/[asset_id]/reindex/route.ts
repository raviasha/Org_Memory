/**
 * POST /api/v1/assets/[asset_id]/reindex — Session 17
 *
 * Queues an asset for incremental re-indexing.  If the asset's current
 * content_hash differs from the hash stored in the most recent completed
 * index_job for that asset (delta detection), the asset's freshness_status
 * is set to "stale" until the job completes.
 *
 * The endpoint creates an index_job row in status="queued".  The caller can
 * poll GET /api/v1/index-jobs?asset_id={asset_id} to check progress, or call
 * POST /api/v1/index-jobs/run to process the queue immediately (prototype
 * convenience; production would use a background worker).
 *
 * Request body (JSON, all optional):
 * {
 *   force?: boolean   — skip delta check and always re-index (default false)
 * }
 *
 * Response 202:
 * {
 *   job_id:          string  — UUID of the created index_job row
 *   asset_id:        string
 *   project_id:      string
 *   status:          "queued"
 *   delta_detected:  boolean | null   — null when force=false and no previous job
 *   requested_at:    string
 * }
 *
 * Response 400  missing or invalid asset_id / already_queued
 * Response 401  missing_bearer_token / invalid_token
 * Response 404  asset_not_found
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import * as crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Stub-mode in-memory state: tracks queued jobs per asset_id so the
// already_queued guard works without a real database.
// Entries auto-expire to avoid long-lived state across test cases.
// ---------------------------------------------------------------------------
const STUB_QUEUED_TTL_MS = 30_000;
const STUB_QUEUED_JOBS = new Map<string, { jobId: string; queuedAt: number }>();

function cleanupStubQueuedJobs(nowMs: number): void {
  for (const [assetId, meta] of STUB_QUEUED_JOBS.entries()) {
    if (nowMs - meta.queuedAt > STUB_QUEUED_TTL_MS) {
      STUB_QUEUED_JOBS.delete(assetId);
    }
  }
}

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
      // Supabase unreachable in dev — allow through.
    }
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ asset_id: string }> },
) {
  const auth = await verifyAuth(request);
  if (!auth.ok) return auth.response;

  const { asset_id } = await params;

  let force = false;
  try {
    const body = await request.json();
    force = body?.force === true;
  } catch {
    // Body is optional; ignore parse errors.
  }

  const now = new Date().toISOString();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (supabaseUrl && supabaseServiceKey) {
    try {
      const { createClient } = await import("@supabase/supabase-js");
      const db = createClient(supabaseUrl, supabaseServiceKey, {
        auth: { persistSession: false },
      });

      // Fetch asset record.
      const { data: asset, error: assetErr } = await db
        .from("assets")
        .select("asset_id, project_id, org_id, content_hash, ingest_status, acl_scope")
        .eq("asset_id", asset_id)
        .maybeSingle();

      if (assetErr) {
        return NextResponse.json(
          { error: "Database error", code: "db_error", details: assetErr.message },
          { status: 500 },
        );
      }

      if (!asset) {
        return NextResponse.json(
          { error: "Asset not found", code: "asset_not_found" },
          { status: 404 },
        );
      }

      if (asset.ingest_status === "deleted") {
        return NextResponse.json(
          { error: "Cannot reindex a deleted asset", code: "asset_deleted" },
          { status: 400 },
        );
      }

      // Check for an already-queued job for this asset.
      const { data: existingJob } = await db
        .from("index_jobs")
        .select("job_id, status")
        .eq("asset_id", asset_id)
        .in("status", ["queued", "running"])
        .maybeSingle();

      if (existingJob) {
        return NextResponse.json(
          {
            error: "An index job is already queued or running for this asset",
            code: "already_queued",
            job_id: existingJob.job_id,
          },
          { status: 400 },
        );
      }

      // Delta detection: compare current content_hash against the most recent
      // completed job's new_content_hash (if any).
      let delta_detected: boolean | null = null;
      let previous_content_hash: string | null = null;

      if (!force) {
        const { data: lastJob } = await db
          .from("index_jobs")
          .select("new_content_hash")
          .eq("asset_id", asset_id)
          .in("status", ["completed", "no_change"])
          .order("completed_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (lastJob?.new_content_hash) {
          previous_content_hash = lastJob.new_content_hash;
          delta_detected = asset.content_hash !== lastJob.new_content_hash;
        }
      } else {
        // force=true — treat as delta
        delta_detected = true;
        previous_content_hash = asset.content_hash;
      }

      // If delta_detected is explicitly false, mark as no_change immediately.
      if (delta_detected === false) {
        const noChangeJobId = crypto.randomUUID();
        await db.from("index_jobs").insert({
          job_id: noChangeJobId,
          asset_id,
          project_id: asset.project_id,
          org_id: asset.org_id,
          requested_at: now,
          started_at: now,
          completed_at: now,
          status: "no_change",
          delta_detected: false,
          previous_content_hash,
          new_content_hash: asset.content_hash,
        });

        // Emit run event (best-effort)
        try {
          await db.from("run_events").insert({
            event_id: crypto.randomUUID(),
            run_id: noChangeJobId,
            event_type: "index_job_no_change",
            correlation_id: noChangeJobId,
            actor: "incremental-indexer",
            payload: { asset_id, job_id: noChangeJobId, reason: "content_hash_unchanged" },
            occurred_at: now,
          });
        } catch { /* best-effort */ }

        return NextResponse.json(
          {
            job_id: noChangeJobId,
            asset_id,
            project_id: asset.project_id,
            status: "no_change",
            delta_detected: false,
            requested_at: now,
            message: "Content hash unchanged; no re-index needed.",
          },
          { status: 202 },
        );
      }

      // Create a queued index_job.
      const job_id = crypto.randomUUID();
      const { error: insertErr } = await db.from("index_jobs").insert({
        job_id,
        asset_id,
        project_id: asset.project_id,
        org_id: asset.org_id,
        requested_at: now,
        status: "queued",
        delta_detected,
        previous_content_hash,
      });

      if (insertErr) {
        return NextResponse.json(
          { error: "Failed to queue index job", code: "db_error", details: insertErr.message },
          { status: 500 },
        );
      }

      // Mark asset as stale if delta was detected.
      if (delta_detected) {
        await db
          .from("assets")
          .update({ freshness_status: "stale" })
          .eq("asset_id", asset_id);
      }

      // Emit run event (best-effort)
      try {
        await db.from("run_events").insert({
          event_id: crypto.randomUUID(),
          run_id: job_id,
          event_type: "index_job_queued",
          correlation_id: job_id,
          actor: "incremental-indexer",
          payload: { asset_id, job_id, delta_detected, previous_content_hash },
          occurred_at: now,
        });
      } catch { /* best-effort */ }

      return NextResponse.json(
        {
          job_id,
          asset_id,
          project_id: asset.project_id,
          status: "queued",
          delta_detected,
          requested_at: now,
        },
        { status: 202 },
      );
    } catch (err) {
      return NextResponse.json(
        {
          error: "Internal error",
          code: "internal_error",
          details: err instanceof Error ? err.message : String(err),
        },
        { status: 500 },
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Stub path (no Supabase configured)
  // ---------------------------------------------------------------------------
  const nowMs = Date.now();
  cleanupStubQueuedJobs(nowMs);

  const existingStubJob = STUB_QUEUED_JOBS.get(asset_id);
  if (existingStubJob) {
    return NextResponse.json(
      {
        error: "An index job is already queued or running for this asset",
        code: "already_queued",
        job_id: existingStubJob.jobId,
      },
      { status: 400 },
    );
  }
  const job_id = crypto.randomUUID();
  STUB_QUEUED_JOBS.set(asset_id, { jobId: job_id, queuedAt: nowMs });
  return NextResponse.json(
    {
      job_id,
      asset_id,
      project_id: "stub-project",
      status: "queued",
      delta_detected: force ? true : null,
      requested_at: now,
      _stub: true,
    },
    { status: 202 },
  );
}
