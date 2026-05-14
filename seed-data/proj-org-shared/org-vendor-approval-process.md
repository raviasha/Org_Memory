# Acme Corp Vendor Approval Process
**Version:** 2.0  
**Owner:** Procurement / Legal  
**Classification:** Internal  
**Effective:** January 2026

---

## Purpose

This document defines the end-to-end process for approving new vendors before they may access Acme systems, data, or employees in any capacity. All new vendor relationships must complete this process before engagement.

---

## Process Overview

```
Step 1: Business Sponsor Request
          ↓
Step 2: Procurement Intake
          ↓
Step 3: Security Review
          ↓
Step 4: Legal Review
          ↓
Step 5: Compliance Approval (if data access)
          ↓
Step 6: Finance Approval (if >$10K ACV)
          ↓
Step 7: Contract Execution
          ↓
Step 8: Vendor Registration
```

---

## Step 1: Business Sponsor Request

**Owner:** Business sponsor (department head or manager)  
**Timeframe:** N/A — initiates process

Business sponsor submits the Vendor Approval Request form (in Procurement portal) with:
- Vendor name and website
- Description of goods or services
- Estimated annual contract value
- Whether the vendor will access Acme systems or data
- Data classification tier of data the vendor will access
- Business justification

---

## Step 2: Procurement Intake

**Owner:** Procurement team  
**Timeframe:** 2 business days

Procurement reviews for:
- Duplicate vendor (is there an existing approved vendor who can meet this need?)
- Completeness of the request
- Contract value routing (determines approval authorities)

If duplicate vendor identified: redirect to existing vendor. Otherwise advance to Step 3.

---

## Step 3: Security Review

**Owner:** Information Security team  
**Timeframe:** 3–5 business days (standard); 10 business days (high-data-risk vendors)

Security reviews:
- Vendor Security Questionnaire (VSQ) — sent to vendor; required response within 10 business days
- Compliance certifications (SOC 2 Type II, ISO 27001, or equivalent)
- For Confidential/Restricted data access: penetration test results and encryption attestation required

**Outcome:** Security Approved, Conditionally Approved (with remediation plan), or Rejected.

For new analytics or data-processing vendors: cross-reference against org-data-classification-policy.pdf to confirm the vendor meets the requirements for the relevant data tier.

---

## Step 4: Legal Review

**Owner:** Legal team  
**Timeframe:** 3–5 business days

Legal reviews or drafts:
- Master Services Agreement (MSA) or terms of service
- Data Processing Agreement (DPA) — required if vendor accesses personal data (use DPA template v2)
- Non-Disclosure Agreement (NDA) — required for all Confidential/Restricted vendors
- Change-of-control provisions for strategic vendors
- IP assignment and licensing terms

**Outcome:** Legal Approved, Negotiation Required, or Rejected.

---

## Step 5: Compliance Approval (data access vendors)

**Owner:** Compliance team  
**Timeframe:** 2–3 business days

Required only for vendors accessing Internal, Confidential, or Restricted data.

Compliance reviews:
- Data classification tier vs. vendor security posture (per vendor-data-handling-requirements.pdf)
- DPA completeness
- Data residency compliance (EU data residency for GDPR-in-scope data)
- CCPA service provider agreement (if vendor accesses California consumer data)

**Outcome:** Compliance Approved or Rejected (with required remediation).

---

## Step 6: Finance Approval

**Owner:** Finance (Controller / CFO)  
**Timeframe:** 2–3 business days  
**Required for:** Contracts above $10,000 ACV

Finance approves budget availability and contract terms. Contracts above $50K ACV require VP approval. Contracts above $200K ACV require CFO approval.

---

## Step 7: Contract Execution

**Owner:** Legal + Business Sponsor  
**Timeframe:** Varies by vendor negotiation

Contract is signed by an authorized signatory (VP or above for contracts >$25K; C-suite for contracts >$200K).

---

## Step 8: Vendor Registration

**Owner:** Procurement  
**Timeframe:** 1 business day

Approved vendor is registered in:
- Approved Vendor Register (procurement system)
- Security risk register (if Confidential/Restricted data access)
- DPA register (if DPA was required)
- Sub-processor list (if vendor will access customer personal data)

---

## Expedited Process

For urgent business needs, an expedited 5-business-day process is available with VP approval and temporary access only. Full process must complete within 30 days or access is revoked.

---

## Vendor Re-approval

All vendors with access to personal data undergo annual re-approval. Vendors with significant security changes must re-apply before continuing access.

---

## Contact

Procurement portal: procurement.acme-corp.example  
Questions: procurement@acme-corp.example
