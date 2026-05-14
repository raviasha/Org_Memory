# Acme Corp AI Usage Policy
**Version:** 1.3  
**Owner:** Legal / Information Security  
**Classification:** Internal  
**Effective:** November 2025  
**Review date:** November 2026

---

## Purpose

This policy governs the use of AI tools and services by Acme Corp employees, contractors, and vendors processing Acme data. It applies to all AI tools including large language models, code assistants, image generators, and AI-powered productivity software.

---

## 1. Approved AI Providers

Employees may use AI tools from the following approved providers for business purposes:

| Provider | Tools Approved | Data Classification Allowed | Notes |
|---------|---------------|----------------------------|-------|
| Anthropic | Claude (via Acme enterprise account) | Up to Confidential | Do not input Restricted data |
| OpenAI | ChatGPT Enterprise (via Acme account) | Up to Confidential | Do not input Restricted data |
| GitHub | GitHub Copilot (via Acme account) | Up to Confidential | Code only; no customer data in prompts |
| Google | Gemini for Workspace (via Acme account) | Up to Internal | Not approved for Confidential use yet |

**Unapproved providers:** Do not use consumer AI tools (free ChatGPT, consumer Claude, Gemini personal, etc.) for any Acme business content. These accounts do not have data processing agreements with Acme.

---

## 2. Prohibited Uses

The following uses are prohibited regardless of provider:

1. **Restricted data in AI prompts**: Do not input Restricted-classified data (deal materials, individual health/financial records, authentication credentials, board pre-announcement content) into any AI tool.
2. **Customer PII without consent**: Do not input identifiable customer personal data into AI tools unless the customer has explicitly consented and the DPA covers this use.
3. **Unreviewed AI-generated legal or compliance content**: AI-generated legal opinions, compliance determinations, or contractual commitments must be reviewed and approved by qualified Legal or Compliance personnel before use.
4. **Presenting AI output as human-generated**: Do not misrepresent AI-generated content as entirely human-authored in contexts where authenticity matters (e.g., research papers, regulatory filings).
5. **Competitive intelligence gathering**: Do not use AI tools to gather intelligence about specific named competitor employees, customers, or non-public information.

---

## 3. Required Output Review

| Output Type | Review Required By |
|------------|-------------------|
| Customer-facing communications | Manager or Communications team |
| Legal agreements or compliance determinations | Legal or Compliance |
| Financial models or projections | Finance |
| Code for production systems | Code reviewer (standard PR process) |
| Marketing materials | Marketing team |

---

## 4. Data Minimization in Prompts

Apply data minimization when constructing AI prompts:
- Use pseudonymized or anonymized examples wherever possible
- Omit personally identifiable fields unless strictly necessary
- Prefer synthetic examples over real customer data
- Do not paste entire confidential documents; provide only the relevant excerpt

---

## 5. AI Tool Selection for Memory Platform

For the Org Memory platform (Acme's internal AI-assisted work tool):
- **Claude (Anthropic)** is the approved primary provider for all memory store operations and wiki maintenance
- **OpenAI (GPT-4 series)** is approved as the secondary execution provider when configured by an authorized operator
- Memory store writes require Acme-controlled API credentials; personal API keys must not be used

---

## 6. Reporting and Escalation

Report suspected AI misuse, data exposure, or policy violations to:
- Email: security@acme-corp.example
- Anonymous hotline: ethics.acme-corp.example

---

## 7. Policy Compliance

All employees must complete annual AI usage training (30 minutes, in LMS). Completion is required before using approved AI tools for Confidential-level content.

Non-compliance may result in revocation of AI tool access and disciplinary action.
