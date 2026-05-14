# TargetCo Technical Due Diligence Assessment
**Classification:** Restricted — Deal Team Only  
**Author:** Acme Corp Engineering Due Diligence Team  
**Date:** April 2026  
**Status:** DRAFT — pending final review

---

## Executive Summary

TargetCo's platform is built on a modern cloud-native stack with strong engineering practices. Technical debt is manageable and concentrated in the legacy data pipeline layer. Security findings require remediation but none are deal-breakers. Migration risk is low for the core product but medium for the legacy analytics layer.

**Technical Risk Rating: MEDIUM** (with noted remediations)

---

## Technology Stack

### Core Platform
- **Backend:** Node.js (TypeScript), Fastify framework
- **Frontend:** React 18, Next.js 14
- **Database:** PostgreSQL 15 (managed, AWS RDS Multi-AZ)
- **Cache:** Redis 7 (ElastiCache)
- **Search:** OpenSearch 2.x
- **Infrastructure:** AWS ECS (Fargate), Terraform-managed
- **CI/CD:** GitHub Actions, ArgoCD
- **Observability:** Datadog (APM, logs, metrics)

### Legacy Analytics Layer (Technical Debt)
- **ETL:** Python 3.8 (EOL support concern), Airflow 2.5
- **Warehouse:** Redshift (10TB, unoptimized query patterns)
- **Reporting:** Tableau + custom Flask APIs
- **Issue:** Analytics pipeline uses direct DB queries against production without read-replica isolation. Identified as performance risk.

---

## Engineering Team Assessment

- Total engineers: 28 (20 product, 5 platform/DevOps, 3 data)
- Engineering leadership: CTO (10 years experience) + VP Engineering (7 years)
- Key person dependency: CTO owns core architecture (HIGH risk; see key risks memo)
- Code review culture: strong (PR reviews required, 2-approval policy)
- Test coverage: 78% unit, 42% integration (adequate)
- Deployment frequency: 8–12 deploys/week (healthy)

---

## Technical Debt Assessment

| Area | Debt Level | Remediation Effort | Priority |
|------|-----------|-------------------|---------|
| Analytics pipeline (Python 3.8) | High | 3 months, 2 engineers | High |
| API versioning gaps (v2 not fully stable) | Medium | 2 months, 2 engineers | Medium |
| Database query optimization (N+1 patterns) | Medium | 1 month, 1 engineer | Medium |
| Frontend bundle size (28MB unoptimized) | Low | 2 weeks, 1 engineer | Low |
| Secrets management (partial KMS migration) | Medium | 6 weeks, 1 engineer | High (security) |

**Total remediation estimate:** 6–9 months, ~$800K fully-loaded cost if addressed post-close.

---

## Security Findings

| Finding | Severity | Details | Remediation |
|---------|----------|---------|-------------|
| Secrets in environment variables | Medium | 14 hardcoded API keys in ECS task definitions; should use AWS Secrets Manager | 4-week fix |
| Missing WAF on staging | Low | Production has WAF; staging does not. Staging hosts integration tests with real data samples. | 2-week fix |
| Dependency vulnerabilities | Medium | 8 high-severity npm CVEs (CVSS >7.0) in production dependencies | 1-week fix |
| IAM over-permissioning | Medium | Several IAM roles have `*` resource policies. Principle of least privilege not enforced. | 6-week fix |

No critical (CVSS 9+) security issues identified. All findings are remediable within 3 months post-close.

---

## Migration Risk Assessment

| Component | Migration Risk | Rationale |
|-----------|---------------|-----------|
| Core product API | Low | Modern stack, well-documented, Terraform-managed |
| Frontend | Low | Standard React/Next.js, straightforward rebrand |
| Database | Low | PostgreSQL, compatible with Acme infrastructure |
| Analytics/Airflow | Medium | Legacy Python, custom connectors; requires refactor |
| Customer integrations | Medium | 18 customer API integrations; notification required |
| Vendor contracts | Low | Month-to-month SaaS contracts, transferable |

---

## Recommendations

1. Include $800K technical debt remediation budget in deal financial model.
2. Key-person retention package for CTO is critical (see key risks memo).
3. Require Python 3.8 upgrade and secrets management remediation as closing conditions or Day 1 priorities.
4. Plan 6-month analytics pipeline migration track post-close.
