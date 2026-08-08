# Documentation Router

Open this file first. One fact has one owning document; other files link rather than duplicate it.

| Document | Owns | Does not own | Status |
|---|---|---|---|
| `DOCUMENTATION_ROUTER.md` | Documentation ownership, lifecycle and navigation | Product facts or automation | Current |
| `AUTOMATION_ROUTER.md` | Script and external automation boundaries | Site strategy or public copy | Current |
| `SITE_FOUNDATION.md` | Purpose, audiences, launch stages, brand direction, architecture and accepted decisions | Page implementation or deployment execution | Current |
| `SEED_IDEAS.md` + `docs/seeds/` | Local-only incubating ideas (gitignored — not published) | Live routes | Local only — gitignored |
| `../site-profile.json` | Machine-readable identity, audiences, launch capabilities, repository and hosting profile | Long explanations or secrets | Current |
| `../README.md` | Human quick start | Strategy or detailed operating procedure | Current |
| `RA-006 Website Delivery System` | Reusable cross-project website method, templates and QA | AIspanda-specific decisions | Resolve through the owner's reusable-asset inventory |
| `RA-002 Deployment Automation` | Reusable gated Cloud Run deployment workflow | AIspanda deployment values or authorization | Resolve through the owner's reusable-asset inventory |
