# Incident Postmortem: API Gateway Outage — 15 March 2026

**Incident ID:** INC-2026-0315  
**Severity:** P1  
**Service affected:** API Gateway (all external API traffic)  
**Duration:** 14:23 UTC – 15:01 UTC (38 minutes)  
**Detection:** Automated PagerDuty alert (APIGateway_502_Rate_High)  
**Incident Commander:** Platform Engineering Lead  
**Status:** Closed — corrective actions in progress  
**Classification:** Internal  

---

## Summary

On 15 March 2026, the Acme API Gateway experienced a 38-minute P1 outage resulting in a 94% error rate for all external API clients. The root cause was a misconfigured upstream timeout parameter introduced during a routine configuration change deployment at 14:20 UTC. The change set the `proxy_read_timeout` value to 1 second instead of 60 seconds, causing all API calls with backend latency above 1 second to return 502 errors.

## Timeline (UTC)

| Time  | Event |
|-------|-------|
| 14:20 | Configuration change deployed: api-gateway-config v1.4.2 (routine maintenance, timeout tuning) |
| 14:23 | PagerDuty fires `APIGateway_502_Rate_High` (>5% 502 rate sustained >2 min) |
| 14:24 | On-call engineer acknowledged alert |
| 14:27 | Initial investigation: upstream services appear healthy, all pods running |
| 14:33 | Reviewed recent deployments; config change at 14:20 identified as candidate |
| 14:38 | Root cause confirmed: `proxy_read_timeout: 1s` instead of `60s` in api-gateway-config |
| 14:42 | Config rollback initiated |
| 14:45 | Config rollback deployed, pod rollout started |
| 15:01 | All pods healthy, error rate back to <0.1%, incident resolved |

## Root Cause Analysis

The configuration change was intended to optimize connection pool timeouts. During authoring of `api-gateway-config v1.4.2`, the `proxy_read_timeout` value was incorrectly set to `1s` (intended: `60s`). This value controls how long the gateway waits for an upstream response before issuing a 502 error.

**Contributing factors:**
1. No automated validation of timeout values against acceptable ranges in the CI pipeline.
2. Code review was performed but the incorrect value was not caught (reviewer focused on other changes in the same PR).
3. Canary deployment was not used — the configuration change was deployed to 100% of pods simultaneously.

## Impact

- 38 minutes of P1 degradation
- ~85,000 API calls returned 502 errors during the incident window
- Estimated 2,100 affected users (external API clients)
- 3 enterprise customers triggered SLA review notifications
- No data loss

## Corrective Actions

| Action | Owner | Priority | Due Date | Status |
|--------|-------|----------|----------|--------|
| Add CI validation for timeout config values (reject values <10s for proxy_read_timeout) | Platform Eng | P1 | 2026-03-22 | In Progress |
| Implement canary deployment for config changes (10% → 50% → 100% with health checks) | Platform Eng | P1 | 2026-04-01 | Not Started |
| Add timeout config to change review checklist | Platform Lead | P2 | 2026-03-18 | Completed |
| Create runbook section for config-change-induced 502s | Platform Eng | P2 | 2026-03-25 | In Progress |
| Notify affected enterprise customers with post-incident report | Customer Success | P1 | 2026-03-17 | Completed |

## Lessons Learned

1. Timeout values are high-impact and easy to misconfigure. CI validation catches this class of error before deployment.
2. Canary deployments for configuration changes reduce blast radius significantly.
3. The 14-minute delay between deployment and root cause identification (14:20 → 14:33) was unnecessary — improving change correlation in dashboards would speed diagnosis.
