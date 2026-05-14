# Acme Corp Organizational Glossary
**Version:** 4.1  
**Owner:** Corporate Communications / Legal  
**Classification:** Internal  
**Last updated:** March 2026

---

## Purpose

This document provides canonical definitions for terms, abbreviations, and acronyms used across Acme Corp. When a term has a specific meaning in Acme context that differs from industry standard, the Acme definition applies.

---

## A

**ACL (Access Control List)** — A list of permissions specifying which users or systems have access to a given resource, and what operations they may perform. In Acme's data platform, `acl_scope` is the primary field used to enforce access at the row level.

**ARR (Annual Recurring Revenue)** — The normalized annual value of all subscription revenue. Excludes one-time fees and professional services. Primary top-line metric for Acme's business.

**Asset (Acme Platform)** — Any document, file, image, URL, or data source ingested into the Acme platform and stored as a canonical record. Assets are the atomic unit of the knowledge management layer.

## C

**CCPA** — California Consumer Privacy Act, as amended by CPRA. Governs consumer data rights for California residents.

**CFO** — Chief Financial Officer. Holder of authority over capital allocation, discount rate approvals, and financial reporting.

**Change of Control** — Any transaction or series of transactions resulting in a change of ownership of more than 50% of Acme's voting securities. Material contracts often contain change-of-control provisions.

**Corpus** — The complete set of assets and wiki pages available within a given project or org scope. Used in the context of context selection and retrieval.

**Cross-Reference (Wiki)** — A directed link between two wiki pages indicating a semantic relationship (e.g., link, contradiction, staleness flag, synthesis source).

## D

**Data Classification** — Acme's four-tier data sensitivity classification: Public, Internal, Confidential, Restricted. Governs handling rules and access controls.

**DPA (Data Processing Agreement)** — A legally binding contract governing how a data processor handles personal data on behalf of a data controller. Required by GDPR Article 28.

**DPIA (Data Protection Impact Assessment)** — A systematic assessment of risks posed by high-risk data processing activities, required under GDPR Article 35.

## E

**EBITDA** — Earnings Before Interest, Taxes, Depreciation, and Amortization. Standard measure of operating profitability.

**EV (Enterprise Value)** — Market capitalization plus net debt. Used as the basis for M&A valuation multiples.

## G

**GDPR** — General Data Protection Regulation (EU) 2016/679. Governs processing of personal data of EU residents.

## I

**ICO** — UK Information Commissioner's Office. The UK data protection supervisory authority.

**Ingest** — The process of loading a new asset into the Acme platform, including normalization, metadata extraction, wiki update, and memory store write.

**IRR (Internal Rate of Return)** — The discount rate at which the net present value of a project's cash flows equals zero. Used in capital budgeting.

## L

**LIA (Legitimate Interests Assessment)** — A documented three-part test used to justify reliance on legitimate interests as a GDPR lawful basis.

## N

**NRR (Net Revenue Retention)** — The percentage of ARR retained from existing customers after expansions, contractions, and churn. Measures account-level growth.

**NPV (Net Present Value)** — The present value of a series of future cash flows, discounted at a specified rate. Primary metric for infrastructure investment decisions.

## O

**Org Memory** — Acme's knowledge management platform. The combined system of the Acme wiki (Supabase-backed), managed memory stores, and the org memory manifest.

**Org Memory Manifest** — The top-level configuration file loaded at the start of each AI-assisted work session. Contains source registry, project registry, ACL policies, and retrieval profiles.

## P

**PII (Personally Identifiable Information)** — Any information that can identify a specific individual, including name, email, IP address, and combinations of attributes.

**Project (Acme Platform)** — A named scope within the org that groups related assets, wiki pages, and memory stores. The primary unit of project-level access control.

**Provenance** — The complete chain of origin for a data item, including source URI, ingest run ID, normalization steps, and version history.

## R

**RLS (Row Level Security)** — A PostgreSQL feature enforced by Supabase that filters database rows based on the authenticated user's identity and policies. Used to enforce ACL in Acme's platform.

**RoPA (Record of Processing Activities)** — A register of all data processing activities carried out by an organization, required under GDPR Article 30.

**RFP (Request for Proposal)** — A formal procurement document inviting vendors to propose solutions for a defined scope of work.

## S

**SLA (Service Level Agreement)** — A commitment to measurable levels of service availability, response time, and resolution time. Customer-facing SLAs are governed by platform-sla-commitments.pdf.

**SCHEMA.md** — The master instruction document for Claude's wiki maintenance behavior. Committed to the repo root and loaded into every Claude session.

## W

**WACC (Weighted Average Cost of Capital)** — The blended cost of all capital sources (equity and debt). Used as the discount rate for NPV calculations unless a project-specific rate is approved.

**Wiki Page (Acme Platform)** — A structured Markdown document in the Acme wiki, owned and maintained by the LLM. Page types: summary, entity, concept, comparison, synthesis, index, log.

**Write Intent** — An application-level record submitted by an execution runtime requesting a write to memory stores or wiki pages. Subject to policy checks before execution.
