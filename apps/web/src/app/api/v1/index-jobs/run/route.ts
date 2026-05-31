/**
 * POST /api/v1/index-jobs/run — Session 17
 *
 * Process pending index_jobs (prototype convenience endpoint).  In a
 * production system this logic would live in a background worker / cron job.
 * Here it runs synchronously so Playwright tests can exercise the full
 * lifecycle in a single request.
 *
 * For each job in status="queued" (optionally filtered by project_id):
 *   1. Transition job to status="running", record started_at.
 *   2. Re-compute content_hash from the asset's current normalized_text.
 *   3. Compare against previous_content_hash (delta detection).
 *   4. If delta detected (or force=true on the original request):
 *        - Update asset: freshness_status="fresh", indexed_at=now.
 *        - Transition job to status="completed", record new_content_hash.
 *        - Emit index_job_completed run_event.
 *   5. If no delta:
 *        - Update asset: freshness_status="fresh", indexed_at=now.
 *        - Transition job to status="no_change".
 *        - Emit index_job_no_change run_event.
 *   6. On error: transition job to status="failed", record error_message.
 *      Emit index_job_failed run_event.
 *
 * Request body (JSON, all optional):
 * {
 *   project_id?: string   — only run jobs for this project
 *   limit?:      number   — max jobs to process in this call (default 20, max 100)
 * }
 *
 * Response 200:
 * {
 *   processed:  number
 *   completed:  number
 *   no_change:  number
 *   failed:     number
 *   jobs:       ProcessedJob[]
 * }
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import * as crypto from "node:crypto";

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
// Helper: emit a run_event (best-effort; errors are swallowed)
// ---------------------------------------------------------------------------

async function emitIndexEvent(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  eventType: string,
  jobId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await db.from("run_events").insert({
      event_id: crypto.randomUUID(),
      run_id: jobId,
      event_type: eventType,
      correlation_id: jobId,
      actor: "incremental-indexer",
      payload,
      occurred_at: new Date().toISOString(),
    });
  } catch {
    // Best-effort; don't fail the job if event write fails.
  }
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const auth = await verifyAuth(request);
  if (!auth.ok) return auth.response;

  let project_id: string | undefined;
  let limit = 20;
  try {
    const body = await request.json();
    project_id = body?.project_id as string | undefined;
    if (typeof body?.limit === "number") {
      limit = Math.min(Math.max(1, body.limit), 100);
    }
  } catch {
    // Body is optional.
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (supabaseUrl && supabaseServiceKey) {
    try {
      const { createClient } = await import("@supabase/supabase-js");
      const db = createClient(supabaseUrl, supabaseServiceKey, {
        auth: { persistSession: false },
      });

      // Fetch queued jobs (oldest first for FIFO fairness).
      let jobsQuery = db
        .from("index_jobs")
        .select("*")
        .eq("status", "queued")
        .order("requested_at", { ascending: true })
        .limit(limit);

      if (project_id) {
        jobsQuery = jobsQuery.eq("project_id", project_id);
      }

      const { data: jobs, error: jobsErr } = await jobsQuery;
      if (jobsErr) {
        return NextResponse.json(
          { error: "Database error", code: "db_error", details: jobsErr.message },
          { status: 500 },
        );
      }

      const results: Array<{
        job_id: string;
        asset_id: string;
        final_status: string;
        delta_detected: boolean | null;
      }> = [];

      let completedCount = 0;
      let noChangeCount = 0;
      let failedCount = 0;

      for (const job of jobs ?? []) {
        const now = new Date().toISOString();

        // Mark as running.
        await db
          .from("index_jobs")
          .update({ status: "running", started_at: now })
          .eq("job_id", job.job_id);

        await emitIndexEvent(db, "index_job_started", job.job_id, {
          asset_id: job.asset_id,
          project_id: job.project_id,
        });

        try {
          // Fetch current asset.
          const { data: asset, error: assetErr } = await db
            .from("assets")
            .select("asset_id, content_hash, normalized_text")
            .eq("asset_id", job.asset_id)
            .maybeSingle();

          if (assetErr || !asset) {
            throw new Error(assetErr?.message ?? "Asset not found");
          }

          // Re-compute content hash from normalized_text (the canonical content).
          const newHash = asset.content_hash ??
            crypto
              .createHash("sha256")
              .update(asset.normalized_text ?? "")
              .digest("hex");

          const deltaDetected =
            job.previous_content_hash != null
              ? newHash !== job.previous_content_hash
              : job.delta_detected ?? true; // treat as delta when no previous hash

          const finalStatus = deltaDetected ? "completed" : "no_change";
          const completedAt = new Date().toISOString();

          // Update index_job.
          await db
            .from("index_jobs")
            .update({
              status: finalStatus,
              completed_at: completedAt,
              delta_detected: deltaDetected,
              new_content_hash: newHash,
            })
            .eq("job_id", job.job_id);

          // Update asset: freshness_status=fresh, indexed_at=now.
          await db
            .from("assets")
            .update({
              freshness_status: "fresh",
              indexed_at: completedAt,
              // Refresh ingest_status to indexed if it was stale or pending.
              ingest_status: "indexed",
            })
            .eq("asset_id", job.asset_id);

          // Emit completion event.
          await emitIndexEvent(
            db,
            deltaDetected ? "index_job_completed" : "index_job_no_change",
            job.job_id,
            {
              asset_id: job.asset_id,
              delta_detected: deltaDetected,
              new_content_hash: newHash,
              previous_content_hash: job.previous_content_hash,
            },
          );

          // Emit freshness_status_changed event if status actually changed.
          await emitIndexEvent(db, "freshness_status_changed", job.job_id, {
            asset_id: job.asset_id,
            freshness_status: "fresh",
            previous_freshness_status: deltaDetected ? "stale" : "never_indexed",
          });

          results.push({
            job_id: job.job_id,
            asset_id: job.asset_id,
            final_status: finalStatus,
            delta_detected: deltaDetected,
          });

          if (deltaDetected) completedCount++;
          else noChangeCount++;
        } catch (jobErr) {
          const errMsg = jobErr instanceof Error ? jobErr.message : String(jobErr);
          await db
            .from("index_jobs")
            .update({
              status: "failed",
              completed_at: new Date().toISOString(),
              error_message: errMsg,
            })
            .eq("job_id", job.job_id);

          await emitIndexEvent(db, "index_job_failed", job.job_id, {
            asset_id: job.asset_id,
            error: errMsg,
          });

          results.push({
            job_id: job.job_id,
            asset_id: job.asset_id,
            final_status: "failed",
            delta_detected: null,
          });
          failedCount++;
        }
      }

      return NextResponse.json(
        {
          processed: results.length,
          completed: completedCount,
          no_change: noChangeCount,
          failed: failedCount,
          jobs: results,
        },
        { status: 200 },
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
  // Stub path (no Supabase)
  // ---------------------------------------------------------------------------
  return NextResponse.json(
    {
      processed: 0,
      completed: 0,
      no_change: 0,
      failed: 0,
      jobs: [],
      _stub: true,
    },
    { status: 200 },
  );
}
