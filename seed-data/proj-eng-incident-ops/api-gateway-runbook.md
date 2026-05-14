# API Gateway Incident Response Runbook
**Version:** 3.1  
**Owner:** Platform Engineering  
**Classification:** Internal  
**Last reviewed:** March 2026

---

## Overview

This runbook covers incident response procedures for the Acme API Gateway service. The API Gateway is the single ingress point for all external API traffic. Refer to the service dependency map for upstream and downstream dependencies.

**Service:** `api-gateway` (k8s namespace: `platform`)  
**On-call:** See on-call-rotation-q2-2026.csv  
**Escalation:** Platform Engineering Lead → VP Engineering

---

## Scenario 1: HTTP 502 Bad Gateway Errors

### Symptoms
- Elevated 502 error rate in API dashboard (>1% sustained for >2 minutes)
- PagerDuty alert: `APIGateway_502_Rate_High`

### Immediate Steps

1. **Check upstream health**
   ```
   kubectl get pods -n platform -l app=api-gateway
   kubectl describe pod <pod-name> -n platform
   ```

2. **Check upstream services**
   ```
   kubectl get pods -n services
   # Check error rates in Datadog: api.gateway.upstream_errors by service
   ```

3. **Check gateway logs**
   ```
   kubectl logs -n platform -l app=api-gateway --tail=100 | grep -i error
   ```

4. **Identify failing upstream**: if one upstream service is causing 502s, check that service's health and consider disabling it from the gateway routing config.

5. **Short-term mitigation**: if widespread, consider enabling maintenance mode (returns 503 with retry-after header) while upstream is fixed.

6. **Root cause**: Check recent deployments in the past 30 minutes:
   ```
   kubectl rollout history deployment -n services
   ```

### Escalation Trigger
Escalate to Platform Lead if: (a) 502 rate >5% sustained >5 min, or (b) cause cannot be identified within 15 minutes.

---

## Scenario 2: HTTP 504 Gateway Timeout Errors

### Symptoms
- PagerDuty alert: `APIGateway_504_Rate_High`
- Elevated p99 latency in API dashboard

### Immediate Steps

1. **Check timeout configuration**
   ```
   kubectl get configmap api-gateway-config -n platform -o yaml | grep timeout
   ```
   Compare to `alert-thresholds-config.yml` — look for mismatches.

2. **Check upstream latency**: Datadog dashboard → API Gateway → Upstream P99 by service.

3. **Check database health**: if DB queries are slow, gateway timeouts follow.
   ```
   # Check slow query log in RDS console or kubectl logs -n database
   ```

4. **Temporary fix**: increase timeout in ConfigMap (requires deployment rollout).
   > **Note:** Increasing timeouts may mask deeper latency issues. Document any change.

5. **Postmortem required** if outage affects >500 unique users or >15 minutes.

---

## Scenario 3: Rate Limit Triggered (429 Too Many Requests)

### Symptoms
- Clients reporting 429 errors
- Alert: `APIGateway_RateLimit_Triggered`

### Immediate Steps

1. Check which client/IP is triggering limits:
   ```
   kubectl logs -n platform -l app=api-gateway --tail=500 | grep 429 | awk '{print $6}' | sort | uniq -c | sort -rn | head -20
   ```

2. If the client is a known internal service, raise its rate limit quota:
   ```
   kubectl edit configmap api-gateway-rate-limits -n platform
   ```

3. If the client is external and suspicious, block the IP:
   ```
   kubectl edit configmap api-gateway-blocklist -n platform
   ```

4. Review with Security team if pattern suggests abuse.

---

## Scenario 4: TLS Certificate Expiry

### Symptoms
- Alert: `APIGateway_Cert_Expiry_Warning` (30-day warning)
- Alert: `APIGateway_Cert_Expired` (critical)
- Clients reporting SSL errors

### Immediate Steps

1. Check cert expiry:
   ```
   kubectl get secret api-gateway-tls -n platform -o jsonpath='{.data.tls\.crt}' | base64 -d | openssl x509 -noout -dates
   ```

2. Renew cert via cert-manager (automated renewal should trigger automatically — if it failed, check):
   ```
   kubectl describe certificate api-gateway-tls -n platform
   kubectl describe certificaterequest -n platform
   ```

3. If cert-manager renewal failed, manual renewal:
   ```
   kubectl delete certificate api-gateway-tls -n platform
   # Recreate certificate resource from Helm chart
   helm upgrade api-gateway ./charts/api-gateway -n platform
   ```

4. Force pod restart after cert renewal:
   ```
   kubectl rollout restart deployment/api-gateway -n platform
   ```

---

## Contact and Escalation

| Level | Contact | Trigger |
|-------|---------|---------|
| L1 On-call | PagerDuty → Platform | Any P1/P2 alert |
| L2 Platform Lead | Direct Slack DM | >15 min unresolved P1 |
| L3 VP Engineering | Phone | Customer-impacting >30 min |
