/**
 * scripts/seed-corpus.ts
 *
 * Idempotent seed loader for Session 4 synthetic corpus.
 * Upserts 5 projects and 42 assets into Supabase.
 *
 * Usage:
 *   SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<key> npx tsx scripts/seed-corpus.ts
 *
 * Idempotency: Uses fixed UUIDs and ON CONFLICT DO NOTHING for projects,
 * ON CONFLICT (asset_id) DO UPDATE for assets so normalized_text stays fresh.
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// Supabase client
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    'Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required.'
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const SEED_DATA_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'seed-data');

// ---------------------------------------------------------------------------
// Project definitions
// ---------------------------------------------------------------------------

interface ProjectSeed {
  project_id: string;
  org_id: string;
  name: string;
  description: string;
  owner_team: string;
  acl_scope: string;
}

const PROJECTS: ProjectSeed[] = [
  {
    project_id: 'proj-finance-infra-q3',
    org_id: ORG_ID,
    name: 'Infrastructure Investment Q3 FY26',
    description: 'Capital budgeting and vendor selection for Q3 FY26 infrastructure investment.',
    owner_team: 'Finance',
    acl_scope: 'org:acme',
  },
  {
    project_id: 'proj-compliance-privacy',
    org_id: ORG_ID,
    name: 'Privacy & Compliance',
    description: 'GDPR, CCPA, and data governance compliance program.',
    owner_team: 'Legal',
    acl_scope: 'org:acme',
  },
  {
    project_id: 'proj-eng-incident-ops',
    org_id: ORG_ID,
    name: 'Platform Engineering & Incident Operations',
    description: 'Runbooks, on-call rotations, SLA commitments, and incident postmortems.',
    owner_team: 'Engineering',
    acl_scope: 'org:acme',
  },
  {
    project_id: 'proj-corpdev-targetco-dd',
    org_id: ORG_ID,
    name: 'CorpDev — TargetCo Due Diligence',
    description: 'M&A due diligence materials for TargetCo acquisition.',
    owner_team: 'Corporate Development',
    acl_scope: 'org:acme',
  },
  {
    project_id: 'proj-org-shared',
    org_id: ORG_ID,
    name: 'Org-Wide Shared Policies',
    description: 'Canonical org-wide glossary, policies, and process documents.',
    owner_team: 'Corporate',
    acl_scope: 'org:acme:shared',
  },
];

// ---------------------------------------------------------------------------
// Asset definitions
// ---------------------------------------------------------------------------

type SourceType = 'document' | 'image' | 'url_scrape' | 'folder' | 'git_repo' | 'object_store';

interface AssetSeed {
  asset_id: string; // deterministic UUID
  project_id: string;
  file_name: string; // relative to seed-data/<project_id>/
  source_type: SourceType;
  file_path_or_url: string;
}

const ASSETS: AssetSeed[] = [
  // --- proj-finance-infra-q3 (10 assets) ---
  {
    asset_id: '10000000-0000-0000-0000-000000000001',
    project_id: 'proj-finance-infra-q3',
    file_name: 'infrastructure-investment-business-case-q3-fy26.pdf',
    source_type: 'document',
    file_path_or_url: 'seed-data/proj-finance-infra-q3/infrastructure-investment-business-case-q3-fy26.pdf',
  },
  {
    asset_id: '10000000-0000-0000-0000-000000000002',
    project_id: 'proj-finance-infra-q3',
    file_name: 'cfo-q3-guidance.pdf',
    source_type: 'document',
    file_path_or_url: 'seed-data/proj-finance-infra-q3/cfo-q3-guidance.pdf',
  },
  {
    asset_id: '10000000-0000-0000-0000-000000000003',
    project_id: 'proj-finance-infra-q3',
    file_name: 'vendor-comparison-matrix.xlsx',
    source_type: 'document',
    file_path_or_url: 'seed-data/proj-finance-infra-q3/vendor-comparison-matrix.xlsx',
  },
  {
    asset_id: '10000000-0000-0000-0000-000000000004',
    project_id: 'proj-finance-infra-q3',
    file_name: 'it-infrastructure-rfp-2026.docx',
    source_type: 'document',
    file_path_or_url: 'seed-data/proj-finance-infra-q3/it-infrastructure-rfp-2026.docx',
  },
  {
    asset_id: '10000000-0000-0000-0000-000000000005',
    project_id: 'proj-finance-infra-q3',
    file_name: 'board-approval-memo-q2-fy26.md',
    source_type: 'document',
    file_path_or_url: 'seed-data/proj-finance-infra-q3/board-approval-memo-q2-fy26.md',
  },
  {
    asset_id: '10000000-0000-0000-0000-000000000006',
    project_id: 'proj-finance-infra-q3',
    file_name: 'infrastructure-depreciation-schedule.csv',
    source_type: 'document',
    file_path_or_url: 'seed-data/proj-finance-infra-q3/infrastructure-depreciation-schedule.csv',
  },
  {
    asset_id: '10000000-0000-0000-0000-000000000007',
    project_id: 'proj-finance-infra-q3',
    file_name: 'vendor-cloudA-proposal.pdf',
    source_type: 'document',
    file_path_or_url: 'seed-data/proj-finance-infra-q3/vendor-cloudA-proposal.pdf',
  },
  {
    asset_id: '10000000-0000-0000-0000-000000000008',
    project_id: 'proj-finance-infra-q3',
    file_name: 'vendor-cloudB-proposal.pdf',
    source_type: 'document',
    file_path_or_url: 'seed-data/proj-finance-infra-q3/vendor-cloudB-proposal.pdf',
  },
  {
    asset_id: '10000000-0000-0000-0000-000000000009',
    project_id: 'proj-finance-infra-q3',
    file_name: 'office-lease-renewal-2024.pdf',
    source_type: 'document',
    file_path_or_url: 'seed-data/proj-finance-infra-q3/office-lease-renewal-2024.pdf',
  },
  {
    asset_id: '10000000-0000-0000-0000-000000000010',
    project_id: 'proj-finance-infra-q3',
    file_name: 'travel-expense-policy.txt',
    source_type: 'document',
    file_path_or_url: 'seed-data/proj-finance-infra-q3/travel-expense-policy.txt',
  },

  // --- proj-compliance-privacy (9 assets) ---
  {
    asset_id: '20000000-0000-0000-0000-000000000001',
    project_id: 'proj-compliance-privacy',
    file_name: 'gdpr-compliance-checklist-v3.md',
    source_type: 'document',
    file_path_or_url: 'seed-data/proj-compliance-privacy/gdpr-compliance-checklist-v3.md',
  },
  {
    asset_id: '20000000-0000-0000-0000-000000000002',
    project_id: 'proj-compliance-privacy',
    file_name: 'ccpa-policy-2025.pdf',
    source_type: 'document',
    file_path_or_url: 'seed-data/proj-compliance-privacy/ccpa-policy-2025.pdf',
  },
  {
    asset_id: '20000000-0000-0000-0000-000000000003',
    project_id: 'proj-compliance-privacy',
    file_name: 'data-retention-schedule.xlsx',
    source_type: 'document',
    file_path_or_url: 'seed-data/proj-compliance-privacy/data-retention-schedule.xlsx',
  },
  {
    asset_id: '20000000-0000-0000-0000-000000000004',
    project_id: 'proj-compliance-privacy',
    file_name: 'dpa-template-v2.docx',
    source_type: 'document',
    file_path_or_url: 'seed-data/proj-compliance-privacy/dpa-template-v2.docx',
  },
  {
    asset_id: '20000000-0000-0000-0000-000000000005',
    project_id: 'proj-compliance-privacy',
    file_name: 'privacy-incident-response-playbook.md',
    source_type: 'document',
    file_path_or_url: 'seed-data/proj-compliance-privacy/privacy-incident-response-playbook.md',
  },
  {
    asset_id: '20000000-0000-0000-0000-000000000006',
    project_id: 'proj-compliance-privacy',
    file_name: 'vendor-data-handling-requirements.pdf',
    source_type: 'document',
    file_path_or_url: 'seed-data/proj-compliance-privacy/vendor-data-handling-requirements.pdf',
  },
  {
    asset_id: '20000000-0000-0000-0000-000000000007',
    project_id: 'proj-compliance-privacy',
    file_name: 'ico-guidance-legitimate-interests.pdf',
    source_type: 'url_scrape',
    file_path_or_url: 'https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/legitimate-interests/',
  },
  {
    asset_id: '20000000-0000-0000-0000-000000000008',
    project_id: 'proj-compliance-privacy',
    file_name: 'employee-handbook-2025.pdf',
    source_type: 'document',
    file_path_or_url: 'seed-data/proj-compliance-privacy/employee-handbook-2025.pdf',
  },
  {
    asset_id: '20000000-0000-0000-0000-000000000009',
    project_id: 'proj-compliance-privacy',
    file_name: 'office-supplies-procurement.csv',
    source_type: 'document',
    file_path_or_url: 'seed-data/proj-compliance-privacy/office-supplies-procurement.csv',
  },

  // --- proj-eng-incident-ops (11 assets) ---
  {
    asset_id: '30000000-0000-0000-0000-000000000001',
    project_id: 'proj-eng-incident-ops',
    file_name: 'api-gateway-runbook.md',
    source_type: 'document',
    file_path_or_url: 'seed-data/proj-eng-incident-ops/api-gateway-runbook.md',
  },
  {
    asset_id: '30000000-0000-0000-0000-000000000002',
    project_id: 'proj-eng-incident-ops',
    file_name: 'database-failover-runbook.md',
    source_type: 'document',
    file_path_or_url: 'seed-data/proj-eng-incident-ops/database-failover-runbook.md',
  },
  {
    asset_id: '30000000-0000-0000-0000-000000000003',
    project_id: 'proj-eng-incident-ops',
    file_name: 'incident-postmortem-2026-03-15.md',
    source_type: 'document',
    file_path_or_url: 'seed-data/proj-eng-incident-ops/incident-postmortem-2026-03-15.md',
  },
  {
    asset_id: '30000000-0000-0000-0000-000000000004',
    project_id: 'proj-eng-incident-ops',
    file_name: 'incident-postmortem-2025-11-22.md',
    source_type: 'document',
    file_path_or_url: 'seed-data/proj-eng-incident-ops/incident-postmortem-2025-11-22.md',
  },
  {
    asset_id: '30000000-0000-0000-0000-000000000005',
    project_id: 'proj-eng-incident-ops',
    file_name: 'service-dependency-map.png',
    source_type: 'image',
    file_path_or_url: 'seed-data/proj-eng-incident-ops/service-dependency-map.png',
  },
  {
    asset_id: '30000000-0000-0000-0000-000000000006',
    project_id: 'proj-eng-incident-ops',
    file_name: 'alert-thresholds-config.yml',
    source_type: 'document',
    file_path_or_url: 'seed-data/proj-eng-incident-ops/alert-thresholds-config.yml',
  },
  {
    asset_id: '30000000-0000-0000-0000-000000000007',
    project_id: 'proj-eng-incident-ops',
    file_name: 'on-call-rotation-q2-2026.csv',
    source_type: 'document',
    file_path_or_url: 'seed-data/proj-eng-incident-ops/on-call-rotation-q2-2026.csv',
  },
  {
    asset_id: '30000000-0000-0000-0000-000000000008',
    project_id: 'proj-eng-incident-ops',
    file_name: 'platform-sla-commitments.pdf',
    source_type: 'document',
    file_path_or_url: 'seed-data/proj-eng-incident-ops/platform-sla-commitments.pdf',
  },
  {
    asset_id: '30000000-0000-0000-0000-000000000009',
    project_id: 'proj-eng-incident-ops',
    file_name: 'marketing-campaign-brief.pdf',
    source_type: 'document',
    file_path_or_url: 'seed-data/proj-eng-incident-ops/marketing-campaign-brief.pdf',
  },
  {
    asset_id: '30000000-0000-0000-0000-000000000010',
    project_id: 'proj-eng-incident-ops',
    file_name: 'q1-sales-report.xlsx',
    source_type: 'document',
    file_path_or_url: 'seed-data/proj-eng-incident-ops/q1-sales-report.xlsx',
  },
  {
    asset_id: '30000000-0000-0000-0000-000000000011',
    project_id: 'proj-eng-incident-ops',
    file_name: 'platform-services-repo',
    source_type: 'git_repo',
    file_path_or_url: 'seed-data/proj-eng-incident-ops/platform-services-repo',
  },

  // --- proj-corpdev-targetco-dd (8 assets) ---
  {
    asset_id: '40000000-0000-0000-0000-000000000001',
    project_id: 'proj-corpdev-targetco-dd',
    file_name: 'targetco-financial-summary-fy25.pdf',
    source_type: 'document',
    file_path_or_url: 'seed-data/proj-corpdev-targetco-dd/targetco-financial-summary-fy25.pdf',
  },
  {
    asset_id: '40000000-0000-0000-0000-000000000002',
    project_id: 'proj-corpdev-targetco-dd',
    file_name: 'targetco-tech-stack-assessment.md',
    source_type: 'document',
    file_path_or_url: 'seed-data/proj-corpdev-targetco-dd/targetco-tech-stack-assessment.md',
  },
  {
    asset_id: '40000000-0000-0000-0000-000000000003',
    project_id: 'proj-corpdev-targetco-dd',
    file_name: 'targetco-customer-contract-template.docx',
    source_type: 'document',
    file_path_or_url: 'seed-data/proj-corpdev-targetco-dd/targetco-customer-contract-template.docx',
  },
  {
    asset_id: '40000000-0000-0000-0000-000000000004',
    project_id: 'proj-corpdev-targetco-dd',
    file_name: 'targetco-ip-registry.xlsx',
    source_type: 'document',
    file_path_or_url: 'seed-data/proj-corpdev-targetco-dd/targetco-ip-registry.xlsx',
  },
  {
    asset_id: '40000000-0000-0000-0000-000000000005',
    project_id: 'proj-corpdev-targetco-dd',
    file_name: 'targetco-key-risks-memo.md',
    source_type: 'document',
    file_path_or_url: 'seed-data/proj-corpdev-targetco-dd/targetco-key-risks-memo.md',
  },
  {
    asset_id: '40000000-0000-0000-0000-000000000006',
    project_id: 'proj-corpdev-targetco-dd',
    file_name: 'targetco-org-chart.png',
    source_type: 'image',
    file_path_or_url: 'seed-data/proj-corpdev-targetco-dd/targetco-org-chart.png',
  },
  {
    asset_id: '40000000-0000-0000-0000-000000000007',
    project_id: 'proj-corpdev-targetco-dd',
    file_name: 'comparable-transaction-analysis.xlsx',
    source_type: 'document',
    file_path_or_url: 'seed-data/proj-corpdev-targetco-dd/comparable-transaction-analysis.xlsx',
  },
  {
    asset_id: '40000000-0000-0000-0000-000000000008',
    project_id: 'proj-corpdev-targetco-dd',
    file_name: 'acme-internal-roadmap-2026.pdf',
    source_type: 'document',
    file_path_or_url: 'seed-data/proj-corpdev-targetco-dd/acme-internal-roadmap-2026.pdf',
  },

  // --- proj-org-shared (4 assets) ---
  {
    asset_id: '50000000-0000-0000-0000-000000000001',
    project_id: 'proj-org-shared',
    file_name: 'org-glossary.md',
    source_type: 'document',
    file_path_or_url: 'seed-data/proj-org-shared/org-glossary.md',
  },
  {
    asset_id: '50000000-0000-0000-0000-000000000002',
    project_id: 'proj-org-shared',
    file_name: 'org-data-classification-policy.pdf',
    source_type: 'document',
    file_path_or_url: 'seed-data/proj-org-shared/org-data-classification-policy.pdf',
  },
  {
    asset_id: '50000000-0000-0000-0000-000000000003',
    project_id: 'proj-org-shared',
    file_name: 'org-ai-usage-policy.md',
    source_type: 'document',
    file_path_or_url: 'seed-data/proj-org-shared/org-ai-usage-policy.md',
  },
  {
    asset_id: '50000000-0000-0000-0000-000000000004',
    project_id: 'proj-org-shared',
    file_name: 'org-vendor-approval-process.md',
    source_type: 'document',
    file_path_or_url: 'seed-data/proj-org-shared/org-vendor-approval-process.md',
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readNormalizedText(projectId: string, fileName: string, sourceType: SourceType): string {
  if (sourceType === 'url_scrape') {
    // URL scrape stubs: read from the seed file
    const filePath = path.join(SEED_DATA_DIR, projectId, fileName);
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf-8');
    }
    return `[url_scrape stub — content not loaded locally]`;
  }

  if (sourceType === 'git_repo') {
    // Git repo: read README if present
    const repoPath = path.join(SEED_DATA_DIR, projectId, fileName, 'README.md');
    if (fs.existsSync(repoPath)) {
      return fs.readFileSync(repoPath, 'utf-8');
    }
    return `[git_repo stub — ${fileName}]`;
  }

  const filePath = path.join(SEED_DATA_DIR, projectId, fileName);
  if (fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, 'utf-8');
  }

  console.warn(`  Warning: seed file not found: ${filePath}`);
  return `[normalized text not available — file missing: ${fileName}]`;
}

function stemFileName(fileName: string): string {
  // Remove extension to get the asset_id stem (matches the convention)
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot === -1) return fileName;
  return fileName.substring(0, lastDot);
}

// ---------------------------------------------------------------------------
// Seed projects
// ---------------------------------------------------------------------------

async function seedProjects(): Promise<void> {
  console.log('\n=== Seeding projects ===');

  for (const project of PROJECTS) {
    const { error } = await supabase
      .from('projects')
      .upsert(project, { onConflict: 'project_id', ignoreDuplicates: true });

    if (error) {
      console.error(`  Error upserting project ${project.project_id}:`, error.message);
    } else {
      console.log(`  ✓ ${project.project_id}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Seed assets
// ---------------------------------------------------------------------------

async function seedAssets(): Promise<void> {
  console.log('\n=== Seeding assets ===');

  for (const asset of ASSETS) {
    const normalizedText = readNormalizedText(
      asset.project_id,
      asset.file_name,
      asset.source_type
    );

    const record = {
      asset_id: asset.asset_id,
      org_id: ORG_ID,
      project_id: asset.project_id,
      source_type: asset.source_type,
      file_path_or_url: asset.file_path_or_url,
      normalized_text: normalizedText,
      acl_scope: asset.project_id === 'proj-org-shared' ? 'org:acme:shared' : 'org:acme',
      ingest_status: 'indexed' as const,
    };

    const { error } = await supabase.from('assets').upsert(record, {
      onConflict: 'asset_id',
    });

    if (error) {
      console.error(`  Error upserting asset ${asset.asset_id} (${asset.file_name}):`, error.message);
    } else {
      console.log(`  ✓ ${asset.project_id} / ${stemFileName(asset.file_name)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Count verification
// ---------------------------------------------------------------------------

async function verifyCounts(): Promise<void> {
  console.log('\n=== Verifying counts ===');

  const expected: Record<string, number> = {
    'proj-finance-infra-q3': 10,
    'proj-compliance-privacy': 9,
    'proj-eng-incident-ops': 11,
    'proj-corpdev-targetco-dd': 8,
    'proj-org-shared': 4,
  };

  let allPassed = true;

  for (const [projectId, expectedCount] of Object.entries(expected)) {
    const { count, error } = await supabase
      .from('assets')
      .select('asset_id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .eq('ingest_status', 'indexed');

    if (error) {
      console.error(`  Error counting assets for ${projectId}:`, error.message);
      allPassed = false;
    } else if (count !== expectedCount) {
      console.error(`  FAIL ${projectId}: expected ${expectedCount}, got ${count}`);
      allPassed = false;
    } else {
      console.log(`  ✓ ${projectId}: ${count} assets`);
    }
  }

  if (allPassed) {
    console.log('\n✅ All counts verified. Seed corpus loaded successfully.');
  } else {
    console.error('\n❌ Count verification failed. Check errors above.');
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('Org Memory — Seed Corpus Loader');
  console.log(`Supabase URL: ${SUPABASE_URL}`);
  console.log(`Seed data dir: ${SEED_DATA_DIR}`);

  await seedProjects();
  await seedAssets();
  await verifyCounts();
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
