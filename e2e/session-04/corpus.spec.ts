/**
 * e2e/session-04/corpus.spec.ts
 *
 * Session 4 — Seed corpus and synthetic data packs
 * @session-04
 *
 * File-system based tests that verify:
 * 1. seed-data/ directory structure and file counts per project
 * 2. eval/cases/ JSON files exist with required fields
 * 3. scripts/seed-corpus.ts loader script exists
 * 4. platform-services-repo stub exists
 */

import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const WORKSPACE_ROOT = path.resolve(__dirname, '../..');
const SEED_DATA_DIR = path.join(WORKSPACE_ROOT, 'seed-data');
const EVAL_CASES_DIR = path.join(WORKSPACE_ROOT, 'eval', 'cases');
const SCRIPTS_DIR = path.join(WORKSPACE_ROOT, 'scripts');

// ---------------------------------------------------------------------------
// Corpus spec
// ---------------------------------------------------------------------------

const CORPUS_SPEC: Record<string, string[]> = {
  'proj-finance-infra-q3': [
    'infrastructure-investment-business-case-q3-fy26.pdf',
    'cfo-q3-guidance.pdf',
    'vendor-comparison-matrix.xlsx',
    'it-infrastructure-rfp-2026.docx',
    'board-approval-memo-q2-fy26.md',
    'infrastructure-depreciation-schedule.csv',
    'vendor-cloudA-proposal.pdf',
    'vendor-cloudB-proposal.pdf',
    'office-lease-renewal-2024.pdf',
    'travel-expense-policy.txt',
  ],
  'proj-compliance-privacy': [
    'gdpr-compliance-checklist-v3.md',
    'ccpa-policy-2025.pdf',
    'data-retention-schedule.xlsx',
    'dpa-template-v2.docx',
    'privacy-incident-response-playbook.md',
    'vendor-data-handling-requirements.pdf',
    'ico-guidance-legitimate-interests.pdf',
    'employee-handbook-2025.pdf',
    'office-supplies-procurement.csv',
  ],
  'proj-eng-incident-ops': [
    'api-gateway-runbook.md',
    'database-failover-runbook.md',
    'incident-postmortem-2026-03-15.md',
    'incident-postmortem-2025-11-22.md',
    'service-dependency-map.png',
    'alert-thresholds-config.yml',
    'on-call-rotation-q2-2026.csv',
    'platform-sla-commitments.pdf',
    'marketing-campaign-brief.pdf',
    'q1-sales-report.xlsx',
    // platform-services-repo is a directory, checked separately
  ],
  'proj-corpdev-targetco-dd': [
    'targetco-financial-summary-fy25.pdf',
    'targetco-tech-stack-assessment.md',
    'targetco-customer-contract-template.docx',
    'targetco-ip-registry.xlsx',
    'targetco-key-risks-memo.md',
    'targetco-org-chart.png',
    'comparable-transaction-analysis.xlsx',
    'acme-internal-roadmap-2026.pdf',
  ],
  'proj-org-shared': [
    'org-glossary.md',
    'org-data-classification-policy.pdf',
    'org-ai-usage-policy.md',
    'org-vendor-approval-process.md',
  ],
};

const EXPECTED_ASSET_COUNTS: Record<string, number> = {
  'proj-finance-infra-q3': 10,
  'proj-compliance-privacy': 9,
  'proj-eng-incident-ops': 11, // 10 files + 1 git_repo directory
  'proj-corpdev-targetco-dd': 8,
  'proj-org-shared': 4,
};

// ---------------------------------------------------------------------------
// Eval case required fields
// ---------------------------------------------------------------------------

const REQUIRED_EVAL_FIELDS = [
  'task_id',
  'project_id',
  'task_text',
  'required_asset_ids',
  'relevant_asset_ids',
  'distractor_asset_ids',
  'task_class',
  'specificity_requirement',
];

const EVAL_CASE_FILES = [
  'task-001-npv-recommendation.json',
  'task-002-vendor-selection.json',
  'task-003-dpa-drafting.json',
  'task-004-retention-lookup.json',
  'task-005-active-incident.json',
  'task-006-on-call-sla.json',
  'task-007-key-risks-summary.json',
  'task-008-valuation.json',
  'task-009-vendor-compliance.json',
  'task-010-alert-drift.json',
];

// ---------------------------------------------------------------------------
// Tests: seed-data structure
// ---------------------------------------------------------------------------

test.describe('seed-data directory structure @session-04', () => {
  test('seed-data root directory exists', () => {
    expect(fs.existsSync(SEED_DATA_DIR), `seed-data dir missing: ${SEED_DATA_DIR}`).toBe(true);
  });

  for (const [projectId, files] of Object.entries(CORPUS_SPEC)) {
    test(`${projectId} — all files present`, () => {
      const projectDir = path.join(SEED_DATA_DIR, projectId);
      expect(fs.existsSync(projectDir), `project dir missing: ${projectDir}`).toBe(true);

      for (const fileName of files) {
        const filePath = path.join(projectDir, fileName);
        expect(fs.existsSync(filePath), `missing file: ${projectId}/${fileName}`).toBe(true);
      }
    });

    test(`${projectId} — asset count matches spec (${EXPECTED_ASSET_COUNTS[projectId]})`, () => {
      const projectDir = path.join(SEED_DATA_DIR, projectId);
      if (!fs.existsSync(projectDir)) {
        throw new Error(`project dir missing: ${projectDir}`);
      }

      const entries = fs.readdirSync(projectDir);
      const count = entries.length;
      expect(count).toBe(EXPECTED_ASSET_COUNTS[projectId]);
    });
  }

  test('proj-eng-incident-ops — platform-services-repo git stub exists', () => {
    const repoDir = path.join(SEED_DATA_DIR, 'proj-eng-incident-ops', 'platform-services-repo');
    expect(fs.existsSync(repoDir), 'platform-services-repo directory missing').toBe(true);
    expect(fs.statSync(repoDir).isDirectory(), 'platform-services-repo should be a directory').toBe(true);

    const readme = path.join(repoDir, 'README.md');
    expect(fs.existsSync(readme), 'platform-services-repo/README.md missing').toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests: eval/cases
// ---------------------------------------------------------------------------

test.describe('eval/cases JSON files @session-04', () => {
  test('eval/cases directory exists', () => {
    expect(fs.existsSync(EVAL_CASES_DIR), `eval/cases dir missing: ${EVAL_CASES_DIR}`).toBe(true);
  });

  test('exactly 10 eval case files exist', () => {
    if (!fs.existsSync(EVAL_CASES_DIR)) return;
    const jsonFiles = fs.readdirSync(EVAL_CASES_DIR).filter((f) => f.endsWith('.json'));
    expect(jsonFiles.length).toBe(10);
  });

  for (const caseFile of EVAL_CASE_FILES) {
    test(`${caseFile} — exists and has required fields`, () => {
      const filePath = path.join(EVAL_CASES_DIR, caseFile);
      expect(fs.existsSync(filePath), `eval case file missing: ${caseFile}`).toBe(true);

      const raw = fs.readFileSync(filePath, 'utf-8');
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error(`${caseFile} is not valid JSON`);
      }

      for (const field of REQUIRED_EVAL_FIELDS) {
        expect(
          Object.prototype.hasOwnProperty.call(parsed, field),
          `${caseFile} missing field: ${field}`
        ).toBe(true);
      }

      // task_id should match filename stem
      const stem = caseFile.replace('.json', '');
      expect(parsed.task_id).toBe(stem);

      // required_asset_ids must be non-empty array
      expect(Array.isArray(parsed.required_asset_ids), 'required_asset_ids must be array').toBe(true);
      expect(
        (parsed.required_asset_ids as unknown[]).length > 0,
        'required_asset_ids must be non-empty'
      ).toBe(true);

      // specificity_requirement must be boolean
      expect(typeof parsed.specificity_requirement).toBe('boolean');
    });
  }
});

// ---------------------------------------------------------------------------
// Tests: scripts/seed-corpus.ts
// ---------------------------------------------------------------------------

test.describe('seed-corpus.ts script @session-04', () => {
  test('scripts/seed-corpus.ts exists', () => {
    const scriptPath = path.join(SCRIPTS_DIR, 'seed-corpus.ts');
    expect(fs.existsSync(scriptPath), `seed-corpus.ts missing: ${scriptPath}`).toBe(true);
  });

  test('seed-corpus.ts references all 5 project IDs', () => {
    const scriptPath = path.join(SCRIPTS_DIR, 'seed-corpus.ts');
    if (!fs.existsSync(scriptPath)) return;

    const content = fs.readFileSync(scriptPath, 'utf-8');
    const projectIds = [
      'proj-finance-infra-q3',
      'proj-compliance-privacy',
      'proj-eng-incident-ops',
      'proj-corpdev-targetco-dd',
      'proj-org-shared',
    ];

    for (const id of projectIds) {
      expect(content.includes(id), `seed-corpus.ts missing project: ${id}`).toBe(true);
    }
  });

  test('seed-corpus.ts references SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars', () => {
    const scriptPath = path.join(SCRIPTS_DIR, 'seed-corpus.ts');
    if (!fs.existsSync(scriptPath)) return;

    const content = fs.readFileSync(scriptPath, 'utf-8');
    expect(content.includes('SUPABASE_URL')).toBe(true);
    expect(content.includes('SUPABASE_SERVICE_ROLE_KEY')).toBe(true);
  });
});
