\# Phase 1: Observability Pilot Baseline — aispanda-web



\*\*Ticket\*\*: AI-48  

\*\*Branch\*\*: `ai-48/sentry-setup`  

\*\*Date\*\*: 2026-08-18  

\*\*Status\*\*: Baseline captured (non-production pilot)



\---



\## Objective



Document current aispanda-web observability state before introducing Sentry error monitoring and Better Stack uptime monitoring. Establish baseline metrics for MATTD (Mean Agent Time to Diagnosis) improvement measurement.



\---



\## Current State (Pre-Integration)



\### Error Observability

\- \*\*Current tracking method\*\*: Browser console errors only (no centralized logging)

\- \*\*Incident discovery\*\*: Manual user reports or on-call manual investigation

\- \*\*MATTD baseline\*\*: Unknown (estimated 30+ minutes per incident with manual investigation)

\- \*\*Existing monitoring\*\*: None (no Sentry, no centralized error aggregation)



\### Uptime Monitoring

\- \*\*Current visibility\*\*: Cloud Run health checks (basic)

\- \*\*Downtime discovery\*\*: Users report 503 errors; no proactive alerting

\- \*\*Alert destination\*\*: None (reactive only)

\- \*\*SLA tracking\*\*: Manual (not automated)



\### Data Safety \& Security

\- \*\*PII handling\*\*: Firebase auth tokens in URLs; need scrubbing rules

\- \*\*Secrets\*\*: Environment variables in `.env.local` (not committed; staging only)

\- \*\*Data retention\*\*: Will implement 7-day retention for staging logs (GDPR safe)

\- \*\*Scrubbing rules needed\*\*:

&#x20; - ✅ Redact Firebase session tokens

&#x20; - ✅ Redact API keys in query params

&#x20; - ✅ Redact email addresses (PII)



\### Current Architecture

\- \*\*Framework\*\*: Astro 7.2.0 (static site with Firebase backend)

\- \*\*Deployment\*\*: Cloud Run (manual push via `cloudbuild.yaml`)

\- \*\*Environment\*\*: Staging (aispanda.com) only

\- \*\*Dependencies\*\*: Firebase admin SDK, Firebase client SDK



\---



\## Phase 1 Implementation (This Commit)



\### Changes Made



\*\*1. Sentry Integration\*\*

\- Added `@sentry/astro` to `astro.config.mjs`

\- Configured DSN from `SENTRY\_DSN` environment variable

\- Set environment to "staging" (non-production boundary)

\- Enabled 10% trace sampling (prevents quota overflow)

\- Release tagged as "ai-48-observability-pilot"



\*\*2. Better Stack Integration (Setup Only)\*\*

\- Added environment variables for Telemetry API token (logs) and Uptime API token (monitors)

\- Integration code deferred to Phase 2 (this phase = setup only)



\*\*3. Environment Configuration\*\*

\- Created `.env.local` with non-production credentials (staging only)

\- `.env.local` added to `.gitignore` (secrets never committed)

\- Created `.env.example` template for reference



\---



\## Acceptance Criteria (Phase 1)



\- \[x] Current error observability state documented

\- \[x] Current uptime monitoring state documented

\- \[x] Sentry DSN configured (staging, non-production only)

\- \[x] Better Stack tokens configured (staging, non-production only)

\- \[x] Data safety rules identified (PII scrubbing needed)

\- \[x] BASELINE.md written and committed

\- \[x] Draft PR created for review before merge



\---



\## Next Steps (Phase 2 — If Approved Week 3)



\*\*Phase 2 deliverables\*\* (only if pilot decision is YES to scale):



1\. \*\*Sentry error capture\*\* — Implement error boundary + test with dummy error

2\. \*\*Better Stack uptime monitoring\*\* — Create HTTP monitors for health endpoints

3\. \*\*Alert destination\*\* — Configure safe staging-only alert channel

4\. \*\*Test evidence\*\* — Document first captured error + alert delivery

5\. \*\*Review \& approval\*\* — Release Auditor verifies safe deployment



\---



\## Week 3 Decision Gate



\*\*Question\*\*: Does baseline + Phase 1 integration justify full observability rollout?

