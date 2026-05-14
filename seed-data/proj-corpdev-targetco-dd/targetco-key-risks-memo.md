# TargetCo Acquisition — Key Risks Memo
**Classification:** Restricted — Deal Team Only  
**Author:** Corporate Development Team  
**Date:** April 2026  
**Status:** DRAFT — for Deal Committee review

---

## Purpose

This memo identifies and assesses the top risks in acquiring TargetCo Inc. Each risk is rated on likelihood (H/M/L) and impact (H/M/L) and assessed as a deal-breaker or manageable.

---

## Risk 1: Customer Concentration

**Likelihood:** High | **Impact:** High | **Assessment:** Manageable with monitoring

TargetCo's top 5 customers account for 31% of FY25 revenue. The single largest customer accounts for 9.2% of ARR. Loss of this customer post-acquisition (due to change-of-control anxiety or competitor offers) would materially impact near-term revenue.

**Mitigants:** Customer interviews recommended pre-close. Retention agreements for top 3 customers as closing condition. Earn-out structure partially addresses financial risk.

---

## Risk 2: Key Person Dependency — CTO

**Likelihood:** High | **Impact:** High | **Assessment:** Manageable with retention

The CTO is the sole architect of TargetCo's core platform, owns critical knowledge of the indexing and retrieval algorithms, and leads the 28-person engineering team. Engineering team morale and retention are closely tied to the CTO's continued presence.

**Mitigants:** 2-year employment agreement + equity retention package estimated at $2.2M. Require CTO to produce architecture documentation and succession plan within 90 days post-close.

---

## Risk 3: IP Encumbrance — ML Model Training Data

**Likelihood:** Medium | **Impact:** High | **Assessment:** Requires resolution before close

TargetCo's ML feature extractor (SW-004) was trained on customer data under a broad IP assignment clause (contract section 5.2). It is unclear whether customers consented to ML training explicitly or whether GDPR/CCPA-compliant consent exists. If regulators take a restrictive view, the ML model may need to be retrained.

**Mitigants:** Legal review required. If consent is insufficient, exclude SW-004 from deal scope or require TargetCo to re-train on properly consented data pre-close. Legal hold on all customer data contracts.

---

## Risk 4: Patent Challenge — PAT-002

**Likelihood:** Low | **Impact:** Medium | **Assessment:** Manageable

A competitor filed a similar patent claim in Q3 2024. PAT-002 prosecution is ongoing. If the claim fails or the competitor's patent is granted first, TargetCo may lose a competitive moat in context-aware retrieval.

**Mitigants:** IP counsel review of prosecution status and prior art analysis. Competitor patent not yet granted; risk is speculative.

---

## Risk 5: Auto-Renewal and Change of Control in Customer Contracts

**Likelihood:** Medium | **Impact:** Medium | **Assessment:** Manageable

Standard customer contracts include 90-day auto-renewal notification windows. If acquisition closes without customer notification, contracts may auto-renew at TargetCo terms that Acme does not wish to honor. Additionally, several enterprise contracts include change-of-control consent requirements.

**Mitigants:** Legal review of all contracts >$100K ACV. Identify contracts with explicit change-of-control clauses. Notification timeline to be planned as part of integration workstream.

---

## Risk 6: Analytics Pipeline Technical Debt

**Likelihood:** High | **Impact:** Low | **Assessment:** Manageable — known cost

Legacy Python 3.8 analytics pipeline requires remediation within 12 months (Python EOL risk). Estimated cost: $800K remediation over 6 months.

**Mitigants:** Budget included in deal model as integration cost. Not a deal-breaker; timeline risk is manageable.

---

## Risk 7: FX and International Expansion Risk

**Likelihood:** Low | **Impact:** Low | **Assessment:** Not a deal issue

TargetCo currently derives <5% of revenue internationally. No significant FX exposure. APAC and EMEA expansion planned for post-acquisition is an opportunity, not a risk.

---

## Risk 8: Competitive Response

**Likelihood:** Medium | **Impact:** Medium | **Assessment:** Manageable

Announcement of acquisition may trigger competitive activity from larger players in TargetCo's market. Key customers may be approached by competitors with switch incentives post-announcement.

**Mitigants:** Retention outreach program. Announcement messaging that emphasizes continuity and Acme investment in the product.

---

## Summary Risk Matrix

| Risk | Likelihood | Impact | Deal-Breaker? | Primary Mitigation |
|------|-----------|--------|--------------|-------------------|
| Customer concentration | H | H | No | Retention agreements |
| CTO key person | H | H | No (if mitigated) | $2.2M retention package |
| IP encumbrance (ML) | M | H | Conditional | Legal review, consent audit |
| Patent challenge | L | M | No | IP counsel review |
| Auto-renewal/change of control | M | M | No | Contract review workstream |
| Analytics tech debt | H | L | No | $800K remediation budget |
| FX exposure | L | L | No | Not material |
| Competitive response | M | M | No | Retention and messaging plan |
