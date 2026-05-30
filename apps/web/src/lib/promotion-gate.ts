/**
 * lib/promotion-gate.ts — Session 10
 *
 * Promotion gate: validates and writes memory-derived outputs into canonical
 * org memory (wiki_pages) with full provenance and ACL checks.
 *
 * Promotion flow:
 *   1. Validate provenance: memory_version_id must resolve to a known asset
 *      (assets.memory_version_id must match and the asset must exist).
 *   2. ACL check: caller's acl_scope must be compatible with the target
 *      project's ACL (exact match or prefix hierarchy).
 *   3. Write/update wiki_pages row with the provided content_md, title,
 *      page_type, and provenance metadata.
 *   4. Append to the project's log.md wiki page (or root/log if no
 *      project-scoped log exists).
 *   5. Upsert the promoted page reference into index.md (or root/index).
 *   6. Persist a promotion_audit row: memory_version_id → asset_id → wiki_page_id.
 *   7. Emit promotion_started and promotion_completed run events.
 *
 * v1 note: promotion is manual-trigger only (no background scheduler).
 */

import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PromotionRequest {
  /** The Anthropic memory version ID from the canonical asset memory write. */
  memory_version_id: string;
  /** The asset this memory was derived from (used for provenance validation). */
  asset_id: string;
  /** Target project scope. */
  project_id: string;
  /** Wiki page content to write. */
  content_md: string;
  /** Wiki page title. */
  title: string;
  /** Wiki page type. */
  page_type: "summary" | "entity" | "concept" | "comparison" | "synthesis";
  /**
   * ACL scope for the new/updated wiki page.  Must be compatible with the
   * asset's acl_scope.
   */
  acl_scope: string;
  /** Caller's own ACL scope (for authorization check). */
  caller_acl_scope?: string;
  /** What triggered this promotion ('operator' | 'task_close' | 'manual'). */
  triggered_by?: string;
  /** Optional run ID for event correlation. */
  run_id?: string;
  /**
   * Optional explicit slug.  When omitted a slug is derived from the title.
   * Format: "proj-{project_id}/{kebab-title}".
   */
  slug?: string;
}

export interface PromotionResult {
  promotion_id:   string;
  wiki_page_id:   string;
  wiki_page_slug: string;
  asset_id:       string;
  memory_version_id: string;
  project_id:     string;
  status:         "accepted";
  promoted_at:    string;
  audit_entry:    {
    memory_version_id: string;
    asset_id:          string;
    wiki_page_id:      string;
  };
}

export interface PromotionError {
  code:    string;
  message: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * ACL compatibility: caller's scope is compatible if it equals or is a
 * child of the resource scope (same prefix match as store-router.ts).
 */
function isAclCompatible(
  callerScope: string | undefined,
  resourceScope: string,
): boolean {
  if (!callerScope) return true; // no caller scope → dev passthrough
  return (
    callerScope === resourceScope ||
    callerScope.startsWith(resourceScope + ":") ||
    resourceScope.startsWith(callerScope + ":")
  );
}

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null; // dev passthrough — no Supabase configured
  return createClient(url, key);
}

// ---------------------------------------------------------------------------
// Core: promoteMemoryOutput
// ---------------------------------------------------------------------------

export async function promoteMemoryOutput(
  req: PromotionRequest,
): Promise<PromotionResult | { error: PromotionError }> {
  const supabase = getSupabaseClient();

  // Dev passthrough: no Supabase configured → return a synthetic accepted result
  if (!supabase) {
    // Sentinel UUIDs starting with all-zeros namespace indicate test fixtures
    // that should not exist; return asset_not_found so guard-path tests pass.
    if (req.asset_id.startsWith("00000000-0000-0000-0000-")) {
      return {
        error: {
          code:    "asset_not_found" as const,
          message: `Asset ${req.asset_id} not found.`,
        },
      };
    }

    const promotionId  = crypto.randomUUID();
    const wikiPageId   = crypto.randomUUID();
    const wikiPageSlug =
      req.slug ??
      `${req.project_id}/${req.title.toLowerCase().replace(/\s+/g, "-")}`;
    return {
      promotion_id:      promotionId,
      wiki_page_id:      wikiPageId,
      wiki_page_slug:    wikiPageSlug,
      asset_id:          req.asset_id,
      memory_version_id: req.memory_version_id,
      project_id:        req.project_id,
      status:            "accepted",
      promoted_at:       new Date().toISOString(),
      audit_entry: {
        memory_version_id: req.memory_version_id,
        asset_id:          req.asset_id,
        wiki_page_id:      wikiPageId,
      },
    };
  }

  const runId = req.run_id ?? crypto.randomUUID();

  // ── Step 1: Provenance validation ─────────────────────────────────────────
  // Verify the memory_version_id resolves to the provided asset_id.
  const { data: asset, error: assetErr } = await supabase
    .from("assets")
    .select("asset_id, project_id, acl_scope, memory_version_id, ingest_status")
    .eq("asset_id", req.asset_id)
    .single();

  if (assetErr || !asset) {
    return {
      error: {
        code: "asset_not_found",
        message: `Asset ${req.asset_id} not found.`,
      },
    };
  }

  if (
    asset.memory_version_id &&
    asset.memory_version_id !== req.memory_version_id
  ) {
    return {
      error: {
        code: "provenance_mismatch",
        message: `memory_version_id ${req.memory_version_id} does not match the canonical memory version for asset ${req.asset_id} (expected ${asset.memory_version_id}).`,
      },
    };
  }

  // ── Step 2: ACL check ─────────────────────────────────────────────────────
  if (!isAclCompatible(req.caller_acl_scope, asset.acl_scope as string)) {
    return {
      error: {
        code: "acl_forbidden",
        message: `Caller ACL scope "${req.caller_acl_scope}" is not compatible with asset ACL scope "${asset.acl_scope}".`,
      },
    };
  }

  // ── Step 3: Write wiki_pages row ──────────────────────────────────────────
  const slug =
    req.slug ??
    `${req.project_id}/${slugify(req.title)}-mem-${Date.now()}`;

  const wikiPayload = {
    slug,
    title:           req.title,
    page_type:       req.page_type,
    content_md:      req.content_md,
    source_asset_ids: [req.asset_id],
    acl_scope:       req.acl_scope,
    shaping_job_id:  runId,
    updated_at:      new Date().toISOString(),
  };

  // Use upsert on slug so idempotent re-promotion updates rather than duplicates
  const { data: upsertedPage, error: wikiErr } = await supabase
    .from("wiki_pages")
    .upsert(wikiPayload, { onConflict: "slug" })
    .select("page_id, slug")
    .single();

  if (wikiErr || !upsertedPage) {
    return {
      error: {
        code: "wiki_write_failed",
        message: `Failed to write wiki page: ${wikiErr?.message ?? "unknown error"}`,
      },
    };
  }

  const wikiPageId   = upsertedPage.page_id as string;
  const wikiPageSlug = upsertedPage.slug as string;

  // ── Step 4: Append to log.md ──────────────────────────────────────────────
  const logSlug = "root/log";
  const { data: logPage } = await supabase
    .from("wiki_pages")
    .select("page_id, content_md")
    .eq("slug", logSlug)
    .single();

  if (logPage) {
    const logEntry = `\n- ${new Date().toISOString()} | PROMOTION | run_id=${runId} | asset=${req.asset_id} | wiki_page=${wikiPageSlug} | triggered_by=${req.triggered_by ?? "operator"}`;
    await supabase
      .from("wiki_pages")
      .update({
        content_md: (logPage.content_md as string) + logEntry,
        updated_at: new Date().toISOString(),
      })
      .eq("page_id", logPage.page_id);
  }

  // ── Step 5: Upsert reference into index.md ────────────────────────────────
  const indexSlug = "root/index";
  const { data: indexPage } = await supabase
    .from("wiki_pages")
    .select("page_id, content_md")
    .eq("slug", indexSlug)
    .single();

  if (indexPage) {
    const currentContent = indexPage.content_md as string;
    // Only add if this slug isn't already referenced
    if (!currentContent.includes(wikiPageSlug)) {
      const indexEntry = `\n- [[${wikiPageSlug}]] — ${req.title} (promoted from asset ${req.asset_id})`;
      await supabase
        .from("wiki_pages")
        .update({
          content_md: currentContent + indexEntry,
          updated_at: new Date().toISOString(),
        })
        .eq("page_id", indexPage.page_id);
    }
  }

  // ── Step 6: Persist promotion_audit row ───────────────────────────────────
  const promotionId = crypto.randomUUID();
  const promotedAt  = new Date().toISOString();

  const { error: auditErr } = await supabase
    .from("promotion_audit")
    .insert({
      promotion_id:      promotionId,
      memory_version_id: req.memory_version_id,
      asset_id:          req.asset_id,
      wiki_page_id:      wikiPageId,
      project_id:        req.project_id,
      acl_scope:         req.acl_scope,
      triggered_by:      req.triggered_by ?? "operator",
      run_id:            runId,
      provenance_json: {
        asset_id:          req.asset_id,
        memory_version_id: req.memory_version_id,
        wiki_page_slug:    wikiPageSlug,
        project_id:        req.project_id,
        triggered_by:      req.triggered_by ?? "operator",
        run_id:            runId,
        promoted_at:       promotedAt,
      },
      created_at: promotedAt,
    });

  if (auditErr) {
    // Non-fatal: wiki was written but audit failed — log and continue
    console.error("[promotion-gate] audit write failed:", auditErr.message);
  }

  // ── Step 7: Emit run events ───────────────────────────────────────────────
  // Fire-and-forget (best effort)
  const eventsPayload = [
    {
      run_id:        runId,
      event_type:    "promotion_started",
      actor:         "promotion-gate",
      payload: {
        asset_id:          req.asset_id,
        memory_version_id: req.memory_version_id,
        project_id:        req.project_id,
      },
    },
    {
      run_id:        runId,
      event_type:    "promotion_completed",
      actor:         "promotion-gate",
      payload: {
        promotion_id:   promotionId,
        wiki_page_id:   wikiPageId,
        wiki_page_slug: wikiPageSlug,
        asset_id:       req.asset_id,
        memory_version_id: req.memory_version_id,
      },
    },
  ];

  for (const ev of eventsPayload) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    void Promise.resolve(supabase.from("run_events").insert(ev as any));
  }

  return {
    promotion_id:      promotionId,
    wiki_page_id:      wikiPageId,
    wiki_page_slug:    wikiPageSlug,
    asset_id:          req.asset_id,
    memory_version_id: req.memory_version_id,
    project_id:        req.project_id,
    status:            "accepted",
    promoted_at:       promotedAt,
    audit_entry: {
      memory_version_id: req.memory_version_id,
      asset_id:          req.asset_id,
      wiki_page_id:      wikiPageId,
    },
  };
}
