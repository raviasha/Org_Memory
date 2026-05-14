# Database Failover Runbook
**Version:** 2.0  
**Owner:** Platform Engineering / Database Team  
**Classification:** Internal  
**Last reviewed:** January 2026

---

## Overview

This runbook covers database failover procedures for Acme's primary PostgreSQL cluster (AWS RDS Multi-AZ) and the promotion of read replicas to primary in case of primary failure.

**Primary DB:** `acme-prod-postgres` (RDS Multi-AZ, us-east-1)  
**Read replicas:** `acme-prod-postgres-replica-1` (us-east-1b), `acme-prod-postgres-replica-2` (us-west-2)  
**Connection string managed by:** Kubernetes Secret `db-connection-string` in namespace `platform`

---

## Scenario 1: Automatic RDS Multi-AZ Failover

### When it happens
AWS RDS automatically fails over to the standby AZ when:
- Primary DB instance is unhealthy
- Primary AZ experiences an outage
- Maintenance window triggers a restart

### What happens automatically
- RDS DNS endpoint updates to point to standby (typically within 60–120 seconds)
- Applications reconnect automatically if they handle transient connection errors

### Operator actions during auto-failover

1. **Verify failover is in progress**:
   - Check AWS RDS console: Events tab for `Multi-AZ instance failover started/completed`
   - Or check CloudWatch: `DBInstanceIdentifier=acme-prod-postgres` → Metrics

2. **Check application connectivity**:
   ```
   kubectl get pods -n platform | grep -v Running
   # Any pods in CrashLoopBackOff may need restart after failover
   kubectl rollout restart deployment -n platform
   ```

3. **Verify DB health post-failover**:
   ```
   psql $DATABASE_URL -c "SELECT now(), pg_is_in_recovery();"
   # Should return: false (meaning it's now the primary)
   ```

4. **Update incident log**: note failover time, duration, and affected services.

5. **Check for data inconsistency**: if any writes were in-flight during failover, check application error logs for constraint violations or duplicates.

---

## Scenario 2: Manual Read Replica Promotion

Use this when the primary is permanently unavailable and automatic failover has not triggered (e.g., DB corruption, extended regional outage).

### Pre-conditions
- Confirm primary is truly unrecoverable (check with AWS Support if needed)
- Identify the most up-to-date replica (check replication lag metric: `ReplicaLag`)

### Steps

1. **Select the replica with lowest ReplicaLag**:
   ```
   aws rds describe-db-instances --query 'DBInstances[*].[DBInstanceIdentifier,ReplicaLag]' --output table
   ```

2. **Stop writes to the failing primary** (if still partially available):
   - Scale down application deployments:
   ```
   kubectl scale deployment --all -n platform --replicas=0
   ```

3. **Promote the selected replica to primary**:
   ```
   aws rds promote-read-replica --db-instance-identifier acme-prod-postgres-replica-1
   ```
   - Promotion typically takes 2–5 minutes.
   - Monitor: `aws rds describe-db-instances --db-instance-identifier acme-prod-postgres-replica-1`

4. **Update connection string** to point to newly promoted instance:
   ```
   kubectl create secret generic db-connection-string \
     --from-literal=url="postgresql://admin:<password>@<new-endpoint>:5432/acmeprod" \
     -n platform --dry-run=client -o yaml | kubectl apply -f -
   ```

5. **Restart applications**:
   ```
   kubectl scale deployment --all -n platform --replicas=<original-replicas>
   kubectl rollout restart deployment -n platform
   ```

6. **Verify connectivity and data integrity**:
   ```
   psql $DATABASE_URL -c "SELECT count(*) FROM assets WHERE created_at > now() - interval '1 hour';"
   ```

7. **Create new read replicas** from the new primary (the old replicas are now detached):
   ```
   aws rds create-db-instance-read-replica \
     --db-instance-identifier acme-prod-postgres-replica-new-1 \
     --source-db-instance-identifier acme-prod-postgres-replica-1
   ```

8. **Post-incident**: Open postmortem ticket, notify stakeholders, review SLA impact.

---

## RTO / RPO Targets

| Scenario | Target RTO | Target RPO |
|----------|-----------|-----------|
| Auto failover (Multi-AZ) | 2 minutes | ~0 (synchronous standby) |
| Manual replica promotion | 30 minutes | <5 minutes (async replication lag) |
| Full region recovery (DR) | 4 hours | <15 minutes |

---

## Escalation

| Level | Contact | Trigger |
|-------|---------|---------|
| On-call DBA | PagerDuty | Any DB alert |
| Platform Lead | Direct | Unresolved after 15 min |
| AWS Support | Premier Support | AWS infrastructure issue suspected |
| VP Engineering | Phone | Customer-impacting DB outage >30 min |
