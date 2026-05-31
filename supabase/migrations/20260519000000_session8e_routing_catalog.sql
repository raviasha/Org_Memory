-- ---------------------------------------------------------------------------
-- Session 8e — Memory-store routing catalog and scoring layer
--
-- 1. routing_requests table: persists every POST /v1/stores/route call.
-- 2. Seeds memory_store_catalog: one row per corpus project (5 total).
-- 3. Seeds store_catalog wiki pages: one page per memory store with full
--    routing metadata (identity, hierarchy, ACL, content signals, freshness,
--    quality, operational stats, routing priors) per the plan spec.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- routing_requests: persists routing results for auditability and replay
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS routing_requests (
  routing_id             text        PRIMARY KEY,
  org_id                 uuid        NOT NULL,
  project_id             text        NOT NULL,
  task_text              text        NOT NULL,
  task_intent            text        NOT NULL DEFAULT '',
  task_entities          text[]      NOT NULL DEFAULT '{}',
  acl_scope              text        NOT NULL DEFAULT 'org:acme',
  max_stores             int         NOT NULL DEFAULT 3,
  memory_file_budget     int         NOT NULL DEFAULT 20,
  ranked_stores          jsonb       NOT NULL DEFAULT '[]',
  total_candidates       int         NOT NULL DEFAULT 0,
  acl_filtered_count     int         NOT NULL DEFAULT 0,
  budget_status          text        NOT NULL DEFAULT 'ok'
                           CHECK (budget_status IN ('ok', 'exceeded')),
  escalation_message     text,
  routing_events         jsonb       NOT NULL DEFAULT '[]',
  created_at             timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE routing_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated full access" ON routing_requests
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS routing_requests_project_id_idx
  ON routing_requests (project_id);
CREATE INDEX IF NOT EXISTS routing_requests_org_id_idx
  ON routing_requests (org_id);
CREATE INDEX IF NOT EXISTS routing_requests_created_at_idx
  ON routing_requests (created_at DESC);

COMMENT ON TABLE routing_requests IS
  'Persists every store-routing request and result for auditability and replay.
   Created by POST /api/v1/stores/route (Session 8e).';

-- ---------------------------------------------------------------------------
-- Seed memory_store_catalog: one row per corpus project
-- Uses deterministic UUIDs so the seed is idempotent.
-- ---------------------------------------------------------------------------

INSERT INTO memory_store_catalog (
  memory_store_id,
  org_id,
  project_id,
  name,
  description,
  owner_team,
  status,
  node_type,
  depth,
  path_slug,
  acl_scope,
  allowed_roles,
  data_classification,
  compliance_tags,
  top_topics,
  top_entities,
  supported_task_intents,
  source_systems,
  staleness_score,
  coverage_score,
  contradiction_risk_score,
  memory_count,
  total_bytes,
  recent_write_rate_7d,
  recent_read_rate_7d,
  historical_helpfulness_by_intent,
  historical_selection_rate,
  historical_override_rate,
  default_attach_mode,
  attach_priority
) VALUES

-- ① Finance — Infra Q3 FY26
(
  '00000000-0000-0000-0001-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'proj-finance-infra-q3',
  'Finance — Infra Q3 FY26 Memory Store',
  'Asset memories for Q3 FY26 infrastructure investment: NPV model, vendor proposals, CFO guidance, board approvals, and depreciation schedule.',
  'Finance',
  'active',
  'project',
  1,
  'org/finance/proj-finance-infra-q3',
  'org:acme',
  ARRAY['finance', 'infrastructure'],
  'confidential',
  ARRAY['sox', 'capex-policy'],
  ARRAY['infrastructure', 'vendor', 'npv', 'capex', 'budget', 'q3', 'fy26', 'discount-rate'],
  ARRAY['CloudA', 'CloudB', 'CloudC', 'CFO'],
  ARRAY['financial_analysis', 'vendor_evaluation', 'policy_review'],
  ARRAY['document_upload'],
  0.10,
  0.90,
  0.05,
  8,
  120000,
  2.5,
  4.0,
  '{"financial_analysis": 0.92, "vendor_evaluation": 0.85, "policy_review": 0.30, "risk_assessment": 0.40, "compliance_check": 0.20, "operations_review": 0.10, "technical_assessment": 0.35, "context_synthesis": 0.25}'::jsonb,
  0.75,
  0.10,
  'read_write',
  10
),

-- ② Legal/Compliance — Data Privacy
(
  '00000000-0000-0000-0001-000000000002',
  '00000000-0000-0000-0000-000000000001',
  'proj-compliance-privacy',
  'Legal/Compliance — Data Privacy Memory Store',
  'Asset memories for GDPR, CCPA, DPA templates, data-retention schedules, incident response playbook, and vendor data-handling requirements.',
  'Legal',
  'active',
  'project',
  1,
  'org/legal/proj-compliance-privacy',
  'org:acme',
  ARRAY['legal', 'compliance', 'privacy'],
  'confidential',
  ARRAY['gdpr', 'ccpa', 'dpa'],
  ARRAY['gdpr', 'ccpa', 'dpa', 'data-retention', 'privacy', 'incident-response', 'vendor-requirements'],
  ARRAY['ICO', 'GDPR', 'CCPA'],
  ARRAY['compliance_check', 'policy_review', 'vendor_evaluation'],
  ARRAY['document_upload', 'url_scrape'],
  0.15,
  0.85,
  0.10,
  7,
  95000,
  1.5,
  3.5,
  '{"compliance_check": 0.95, "policy_review": 0.80, "vendor_evaluation": 0.60, "risk_assessment": 0.55, "financial_analysis": 0.15, "operations_review": 0.20, "technical_assessment": 0.25, "context_synthesis": 0.40}'::jsonb,
  0.70,
  0.08,
  'read_only',
  8
),

-- ③ Engineering — Incident Ops
(
  '00000000-0000-0000-0001-000000000003',
  '00000000-0000-0000-0000-000000000001',
  'proj-eng-incident-ops',
  'Engineering — Incident Ops Memory Store',
  'Asset memories for runbooks, on-call rotations, SLA commitments, alert-threshold config, and incident postmortems.',
  'Engineering',
  'active',
  'project',
  1,
  'org/engineering/proj-eng-incident-ops',
  'org:acme',
  ARRAY['engineering', 'operations', 'incidents'],
  'internal',
  ARRAY['soc2'],
  ARRAY['runbook', 'incident', 'on-call', 'sla', 'alert', 'postmortem', 'platform', 'gateway'],
  ARRAY['API Gateway', 'Platform Services'],
  ARRAY['operations_review', 'technical_assessment', 'policy_review'],
  ARRAY['document_upload', 'git_repo'],
  0.20,
  0.80,
  0.15,
  9,
  140000,
  3.0,
  5.0,
  '{"operations_review": 0.93, "technical_assessment": 0.75, "policy_review": 0.40, "risk_assessment": 0.50, "compliance_check": 0.30, "financial_analysis": 0.10, "vendor_evaluation": 0.15, "context_synthesis": 0.30}'::jsonb,
  0.72,
  0.12,
  'read_write',
  9
),

-- ④ CorpDev — TargetCo Due Diligence
(
  '00000000-0000-0000-0001-000000000004',
  '00000000-0000-0000-0000-000000000001',
  'proj-corpdev-targetco-dd',
  'CorpDev — TargetCo Due Diligence Memory Store',
  'Asset memories for TargetCo M&A due diligence: financials, tech-stack assessment, key-risks memo, IP registry, comparable transaction analysis.',
  'Corporate Development',
  'active',
  'project',
  1,
  'org/corpdev/proj-corpdev-targetco-dd',
  'org:acme',
  ARRAY['corporate-development', 'due-diligence', 'm&a'],
  'restricted',
  ARRAY['m&a-nda'],
  ARRAY['targetco', 'acquisition', 'due-diligence', 'valuation', 'risk', 'ip', 'comparable'],
  ARRAY['TargetCo'],
  ARRAY['risk_assessment', 'financial_analysis', 'technical_assessment'],
  ARRAY['document_upload'],
  0.25,
  0.75,
  0.20,
  6,
  85000,
  1.0,
  2.5,
  '{"risk_assessment": 0.90, "financial_analysis": 0.88, "technical_assessment": 0.70, "vendor_evaluation": 0.30, "compliance_check": 0.40, "policy_review": 0.25, "operations_review": 0.15, "context_synthesis": 0.35}'::jsonb,
  0.65,
  0.15,
  'read_only',
  7
),

-- ⑤ Org Shared Policies
(
  '00000000-0000-0000-0001-000000000005',
  '00000000-0000-0000-0000-000000000001',
  'proj-org-shared',
  'Org Shared Policies Memory Store',
  'Asset memories for org-wide shared policies: glossary, data-classification policy, AI usage policy, and vendor approval process.',
  'Platform',
  'active',
  'project',
  0,
  'org/shared/proj-org-shared',
  'org:acme',
  ARRAY['policies', 'org-wide', 'governance'],
  'internal',
  ARRAY['iso27001'],
  ARRAY['policy', 'vendor-approval', 'data-classification', 'ai-usage', 'glossary', 'governance'],
  ARRAY['Acme'],
  ARRAY['policy_review', 'compliance_check', 'vendor_evaluation', 'context_synthesis'],
  ARRAY['document_upload'],
  0.05,
  0.95,
  0.02,
  4,
  45000,
  0.5,
  6.0,
  '{"policy_review": 0.88, "compliance_check": 0.72, "vendor_evaluation": 0.80, "context_synthesis": 0.90, "risk_assessment": 0.45, "financial_analysis": 0.20, "operations_review": 0.35, "technical_assessment": 0.30}'::jsonb,
  0.80,
  0.05,
  'read_only',
  6
)

ON CONFLICT (memory_store_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Seed store_catalog wiki pages (one per memory store)
-- These are the routing-metadata wiki pages Claude reads first to decide
-- which stores to attach, following the Karpathy-style wiki approach.
-- ---------------------------------------------------------------------------

INSERT INTO wiki_pages (slug, title, page_type, content_md, source_asset_ids, acl_scope)
VALUES

-- ① Finance store catalog page
(
  'stores/catalog/proj-finance-infra-q3',
  'Store Catalog — Finance Infra Q3',
  'store_catalog',
  $md$# Store Catalog — Finance Infra Q3 FY26

**memory_store_id:** `00000000-0000-0000-0001-000000000001`
**project_id:** `proj-finance-infra-q3`
**path_slug:** `org/finance/proj-finance-infra-q3`
**status:** active
**node_type:** project | **depth:** 1
**ACL scope:** `org:acme`
**data_classification:** confidential
**compliance_tags:** sox, capex-policy
**owner_team:** Finance

## Content Signals

**top_topics:** infrastructure, vendor, npv, capex, budget, q3, fy26, discount-rate
**top_entities:** CloudA, CloudB, CloudC, CFO
**supported_task_intents:** financial_analysis, vendor_evaluation, policy_review

## Freshness & Quality

| metric | value |
|---|---|
| staleness_score | 0.10 (low — mostly fresh) |
| coverage_score | 0.90 (high) |
| contradiction_risk_score | 0.05 (very low) |
| memory_count | 8 |
| total_bytes | 120 000 |
| recent_write_rate_7d | 2.5 writes/day |
| recent_read_rate_7d | 4.0 reads/day |

## Routing Priors (historical helpfulness by intent)

| intent | helpfulness |
|---|---|
| financial_analysis | 0.92 |
| vendor_evaluation | 0.85 |
| policy_review | 0.30 |
| risk_assessment | 0.40 |

**historical_selection_rate:** 0.75
**historical_override_rate:** 0.10
**default_attach_mode:** read_write
**attach_priority:** 10 (highest across corpus projects)

## Usage Notes

- Attach as primary read-write store for all financial-analysis and vendor-evaluation tasks anchored to proj-finance-infra-q3.
- Contains NPV model, CFO guidance, and vendor proposals — load when task mentions cost, IRR, discount rate, or vendor comparison.
- Cross-project tasks that need vendor compliance data should attach Compliance store as secondary read-only.
$md$,
  '{}',
  'org:acme'
),

-- ② Compliance store catalog page
(
  'stores/catalog/proj-compliance-privacy',
  'Store Catalog — Compliance Data Privacy',
  'store_catalog',
  $md$# Store Catalog — Legal/Compliance Data Privacy

**memory_store_id:** `00000000-0000-0000-0001-000000000002`
**project_id:** `proj-compliance-privacy`
**path_slug:** `org/legal/proj-compliance-privacy`
**status:** active
**node_type:** project | **depth:** 1
**ACL scope:** `org:acme`
**data_classification:** confidential
**compliance_tags:** gdpr, ccpa, dpa
**owner_team:** Legal

## Content Signals

**top_topics:** gdpr, ccpa, dpa, data-retention, privacy, incident-response, vendor-requirements
**top_entities:** ICO, GDPR, CCPA
**supported_task_intents:** compliance_check, policy_review, vendor_evaluation

## Freshness & Quality

| metric | value |
|---|---|
| staleness_score | 0.15 |
| coverage_score | 0.85 |
| contradiction_risk_score | 0.10 |
| memory_count | 7 |
| total_bytes | 95 000 |
| recent_write_rate_7d | 1.5 writes/day |
| recent_read_rate_7d | 3.5 reads/day |

## Routing Priors

| intent | helpfulness |
|---|---|
| compliance_check | 0.95 |
| policy_review | 0.80 |
| vendor_evaluation | 0.60 |
| risk_assessment | 0.55 |

**historical_selection_rate:** 0.70
**historical_override_rate:** 0.08
**default_attach_mode:** read_only
**attach_priority:** 8

## Usage Notes

- Attach read-only for any compliance_check, DPA drafting, data-retention, or privacy-incident tasks.
- Cross-project vendor tasks (e.g. task-009) require this store alongside Finance as the second secondary read-only store.
- Do not attach as read-write unless the task explicitly involves authoring compliance artefacts.
$md$,
  '{}',
  'org:acme'
),

-- ③ Engineering Incident Ops store catalog page
(
  'stores/catalog/proj-eng-incident-ops',
  'Store Catalog — Engineering Incident Ops',
  'store_catalog',
  $md$# Store Catalog — Engineering Incident Ops

**memory_store_id:** `00000000-0000-0000-0001-000000000003`
**project_id:** `proj-eng-incident-ops`
**path_slug:** `org/engineering/proj-eng-incident-ops`
**status:** active
**node_type:** project | **depth:** 1
**ACL scope:** `org:acme`
**data_classification:** internal
**compliance_tags:** soc2
**owner_team:** Engineering

## Content Signals

**top_topics:** runbook, incident, on-call, sla, alert, postmortem, platform, gateway
**top_entities:** API Gateway, Platform Services
**supported_task_intents:** operations_review, technical_assessment, policy_review

## Freshness & Quality

| metric | value |
|---|---|
| staleness_score | 0.20 |
| coverage_score | 0.80 |
| contradiction_risk_score | 0.15 |
| memory_count | 9 |
| total_bytes | 140 000 |
| recent_write_rate_7d | 3.0 writes/day |
| recent_read_rate_7d | 5.0 reads/day |

## Routing Priors

| intent | helpfulness |
|---|---|
| operations_review | 0.93 |
| technical_assessment | 0.75 |
| policy_review | 0.40 |
| risk_assessment | 0.50 |

**historical_selection_rate:** 0.72
**historical_override_rate:** 0.12
**default_attach_mode:** read_write
**attach_priority:** 9

## Usage Notes

- Primary store for all incident-ops, on-call, runbook, and SLA tasks.
- Contains both document memories and git-repo asset memories from platform-services-repo.
- Attach as read-write for active-incident tasks; read-only for retrospective analysis.
$md$,
  '{}',
  'org:acme'
),

-- ④ CorpDev store catalog page
(
  'stores/catalog/proj-corpdev-targetco-dd',
  'Store Catalog — CorpDev TargetCo Due Diligence',
  'store_catalog',
  $md$# Store Catalog — CorpDev TargetCo Due Diligence

**memory_store_id:** `00000000-0000-0000-0001-000000000004`
**project_id:** `proj-corpdev-targetco-dd`
**path_slug:** `org/corpdev/proj-corpdev-targetco-dd`
**status:** active
**node_type:** project | **depth:** 1
**ACL scope:** `org:acme`
**data_classification:** restricted
**compliance_tags:** m&a-nda
**owner_team:** Corporate Development

## Content Signals

**top_topics:** targetco, acquisition, due-diligence, valuation, risk, ip, comparable
**top_entities:** TargetCo
**supported_task_intents:** risk_assessment, financial_analysis, technical_assessment

## Freshness & Quality

| metric | value |
|---|---|
| staleness_score | 0.25 |
| coverage_score | 0.75 |
| contradiction_risk_score | 0.20 |
| memory_count | 6 |
| total_bytes | 85 000 |
| recent_write_rate_7d | 1.0 write/day |
| recent_read_rate_7d | 2.5 reads/day |

## Routing Priors

| intent | helpfulness |
|---|---|
| risk_assessment | 0.90 |
| financial_analysis | 0.88 |
| technical_assessment | 0.70 |
| vendor_evaluation | 0.30 |

**historical_selection_rate:** 0.65
**historical_override_rate:** 0.15
**default_attach_mode:** read_only
**attach_priority:** 7

## Usage Notes

- Attach read-only for M&A, due-diligence, valuation, or TargetCo risk tasks.
- data_classification is restricted — verify caller ACL before attach.
- Do not attach for general organisational tasks unrelated to TargetCo.
$md$,
  '{}',
  'org:acme'
),

-- ⑤ Org Shared store catalog page
(
  'stores/catalog/proj-org-shared',
  'Store Catalog — Org Shared Policies',
  'store_catalog',
  $md$# Store Catalog — Org Shared Policies

**memory_store_id:** `00000000-0000-0000-0001-000000000005`
**project_id:** `proj-org-shared`
**path_slug:** `org/shared/proj-org-shared`
**status:** active
**node_type:** project | **depth:** 0 (org-level)
**ACL scope:** `org:acme`
**data_classification:** internal
**compliance_tags:** iso27001
**owner_team:** Platform

## Content Signals

**top_topics:** policy, vendor-approval, data-classification, ai-usage, glossary, governance
**top_entities:** Acme
**supported_task_intents:** policy_review, compliance_check, vendor_evaluation, context_synthesis

## Freshness & Quality

| metric | value |
|---|---|
| staleness_score | 0.05 (very low — kept current) |
| coverage_score | 0.95 (highest) |
| contradiction_risk_score | 0.02 (negligible) |
| memory_count | 4 |
| total_bytes | 45 000 |
| recent_write_rate_7d | 0.5 writes/day |
| recent_read_rate_7d | 6.0 reads/day (most-read store) |

## Routing Priors

| intent | helpfulness |
|---|---|
| context_synthesis | 0.90 |
| policy_review | 0.88 |
| vendor_evaluation | 0.80 |
| compliance_check | 0.72 |

**historical_selection_rate:** 0.80 (highest across all stores)
**historical_override_rate:** 0.05
**default_attach_mode:** read_only
**attach_priority:** 6

## Usage Notes

- Append as secondary read-only store to almost any task that touches policy, glossary, or vendor-approval questions.
- Highest read rate — Claude visits this store most frequently across all intents.
- Very small (4 memories, 45 kB) — low token-budget impact.
$md$,
  '{}',
  'org:acme'
)

ON CONFLICT (slug) DO NOTHING;
