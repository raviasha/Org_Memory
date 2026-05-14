# Privacy Incident Response Playbook
**Version:** 2.3  
**Owner:** Security / Compliance Team  
**Classification:** Confidential  
**Last reviewed:** February 2026

---

## 1. Purpose

This playbook provides step-by-step procedures for responding to data privacy incidents including personal data breaches, unauthorized access, and ransomware events affecting personal data.

## 2. Incident Severity Classification

| Severity | Criteria | Examples |
|----------|----------|---------|
| P1 Critical | >10,000 records OR sensitive PII exposed | Credential database breach, payment card exposure |
| P2 High | 1,000–10,000 records OR special-category data | Employee health data, login data for subset of users |
| P3 Medium | <1,000 records, non-sensitive | Name/email of small user group |
| P4 Low | Single individual, inadvertent disclosure | Misdirected email with one customer's order |

## 3. Incident Response Team

| Role | Responsibility | Contact |
|------|---------------|---------|
| Incident Commander | Coordinates all response activities | security-oncall@acme-corp.example |
| DPO | GDPR/regulatory decisions | dpo@acme-corp.example |
| Legal Counsel | Legal liability, breach notifications | legal-privacy@acme-corp.example |
| Engineering Lead | Technical containment, forensics | engineering-security@acme-corp.example |
| Communications | Internal and external messaging | comms@acme-corp.example |
| Executive Sponsor | P1 escalations | CISO |

## 4. Response Phases

### Phase 1: Detection and Triage (0–2 hours)

1. Incident reporter files ticket in security portal with all known details.
2. Security on-call acknowledges within **15 minutes**.
3. Initial triage: classify severity (P1–P4).
4. If P1/P2: activate Incident Response Team immediately.
5. Preserve evidence: snapshot affected systems, do not delete logs.
6. Initial containment: isolate affected systems if breach is ongoing.

### Phase 2: Containment and Assessment (2–24 hours)

1. Forensic investigation to determine scope: what data, how many records, what period.
2. Identify root cause.
3. Apply containment measures (credential rotation, network isolation, patch if applicable).
4. DPO assesses whether GDPR Article 33 notification threshold is met (risk to individuals' rights and freedoms).
5. Begin drafting regulatory notification if threshold met.

### Phase 3: Notification (within 72 hours of awareness for GDPR breaches)

#### Regulatory Notification (GDPR Art. 33)
- DPO must assess and notify relevant supervisory authority **within 72 hours** of becoming aware.
- If notification is delayed beyond 72 hours, provide documented reason for delay.
- Required notification contents: nature of breach, categories/numbers of data subjects affected, likely consequences, measures taken or proposed.

#### Controller Notification (if Acme is acting as Processor)
- Notify Controller **within 48 hours** per DPA clause 7.1.
- Use breach notification template in Legal/Compliance portal.

#### Data Subject Notification (GDPR Art. 34)
- Required when breach is likely to result in high risk to individuals.
- DPO and Legal approve communication before sending.
- Notify without undue delay once high risk determined.

### Phase 4: Eradication and Recovery (24–72 hours)

1. Remove malware or unauthorized access paths.
2. Apply security patches.
3. Restore affected systems from clean backups.
4. Verify integrity of restored data.
5. Resume normal operations with enhanced monitoring.

### Phase 5: Post-Incident Review (within 14 days)

1. Full incident timeline documented.
2. Root cause analysis completed.
3. Corrective actions assigned with owners and due dates.
4. Incident added to breach register.
5. Lessons learned shared with relevant teams.
6. GDPR and DPA compliance verified.

## 5. Breach Register

All incidents of any severity must be logged in the Compliance Breach Register within 24 hours of classification. Register fields:
- Incident ID, date detected, date reported, severity
- Data types affected, estimated records, affected data subjects
- Root cause, regulatory notifications sent, corrective actions, closure date

## 6. Key Contacts and Escalation

- **ICO (UK DPA):** report.ico.org.uk (for UK GDPR incidents)
- **Supervisory authorities:** see Legal/Compliance portal for EU member-state contacts
- **Cyber insurance:** Legal holds the policy and contact details
