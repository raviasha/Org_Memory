# Incident Postmortem: Database Connection Pool Exhaustion — 22 November 2025

**Incident ID:** INC-2025-1122  
**Severity:** P2  
**Service affected:** Primary API services (DB-dependent endpoints)  
**Duration:** 09:14 UTC – 10:42 UTC (88 minutes)  
**Detection:** Customer support tickets (no automated alert fired for 18 minutes)  
**Incident Commander:** Senior Backend Engineer  
**Status:** Closed — corrective actions completed  
**Classification:** Internal  

---

## Summary

On 22 November 2025, Acme's primary API services experienced widespread degradation due to database connection pool exhaustion. The incident was triggered by a long-running background job that opened database connections without proper pooling, consuming all available connections from the shared pool. API endpoints depending on the database began returning 500 errors. The automated alert failed to fire for 18 minutes because the connection pool exhaustion metric was not included in the alert thresholds configuration at the time.

## Timeline (UTC)

| Time  | Event |
|-------|-------|
| 09:00 | Background data export job started (weekly job, triggered by scheduler) |
| 09:14 | Customer support receives first reports of 500 errors on /api/projects endpoint |
| 09:32 | Engineering notified by Customer Success (no automated alert yet) |
| 09:38 | On-call engineer begins investigation |
| 09:44 | DB connection pool exhaustion identified in Datadog (metric: db.pool.connections_waiting > 0) |
| 09:51 | Root cause confirmed: data export job consuming all DB connections |
| 09:54 | Data export job manually killed |
| 10:05 | Connection pool begins recovering; 500 error rate declining |
| 10:42 | All services recovered, error rate <0.5% |

## Root Cause Analysis

The weekly data export job was refactored in October 2025 to export larger datasets. The refactored version opened one DB connection per batch instead of reusing a single pooled connection. With batch sizes of 500 rows and a 10,000-row export, the job opened 20 simultaneous DB connections, exhausting the pool size of 20 (configured for the production database).

**Contributing factors:**
1. DB connection pool limit (20) was not enforced in the background job framework.
2. The connection pool exhaustion metric (`db.pool.connections_waiting`) was not included in alert thresholds.
3. No circuit breaker between the background job and the API-serving connection pool.
4. Alert failure meant 18-minute delay in detection — incident was user-reported, not system-detected.

## Impact

- 88 minutes of P2 degradation
- ~12,400 API requests returned 500 errors
- ~850 affected users
- No data loss
- No SLA breach (P2 threshold: 2-hour resolution)

## Corrective Actions

| Action | Owner | Priority | Due Date | Status |
|--------|-------|----------|----------|--------|
| Add `db.pool.connections_waiting > 5 for 2 min` to alert-thresholds-config.yml | Platform Eng | P1 | 2025-11-29 | Completed |
| Separate connection pool for background jobs (max 3 connections) | Backend Eng | P1 | 2025-12-15 | Completed |
| Add connection pool monitor to API gateway health check | Platform Eng | P2 | 2025-12-01 | Completed |
| Code review checklist: verify DB connection reuse in all background jobs | Engineering Lead | P2 | 2025-11-26 | Completed |
| Load test background jobs against production-like pool sizes before deploy | QA/Eng | P3 | 2026-01-15 | Completed |

## Lessons Learned

1. Background jobs must use a separate, capped connection pool. Sharing the API connection pool is an anti-pattern.
2. All key resource exhaustion metrics must have alerts. Adding `connections_waiting` to alert thresholds immediately post-incident reduces future detection lag.
3. The 18-minute customer-reported detection gap was unacceptable for a P2 incident. Metric-based detection must cover connection pool exhaustion.
