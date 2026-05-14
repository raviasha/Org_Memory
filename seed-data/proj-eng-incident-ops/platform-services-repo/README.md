# platform-services-repo

**Repository:** acme-corp/platform-services  
**Type:** Git repository (synthetic stub for seed corpus)  
**Project:** proj-eng-incident-ops  
**Description:** Live copies of alert threshold configurations and incident runbooks for Acme's platform services.

This stub represents the GitHub repository ingested via the git connector (Session 5). At full ingest, each file in this repo produces a separate asset record in `proj-eng-incident-ops`.

## Repository Contents

| File | Description | Also in seed-data? |
|------|-------------|-------------------|
| `runbooks/api-gateway-runbook.md` | API gateway incident response | Yes (standalone asset) |
| `runbooks/database-failover-runbook.md` | DB failover procedures | Yes (standalone asset) |
| `config/alert-thresholds-config.yml` | Alert thresholds (live version in repo) | Yes (standalone asset) |
| `postmortems/incident-postmortem-2026-03-15.md` | API gateway outage postmortem | Yes (standalone asset) |
| `postmortems/incident-postmortem-2025-11-22.md` | DB connection pool postmortem | Yes (standalone asset) |

## Purpose in Eval

Task 10 (alert-drift) requires the git connector to detect changes in `config/alert-thresholds-config.yml` and compare them with the incident runbooks. This repo provides the authoritative live versions. The standalone `alert-thresholds-config.yml` asset in the seed corpus represents a snapshot; the repo version represents the live state.

## Note on Asset IDs

The git repo itself is recorded as a single corpus asset with ID `platform-services-repo`. Per-file asset records (from full git ingest in Session 5) will carry derived IDs following the convention `<repo-slug>/<filepath-stem>`.
