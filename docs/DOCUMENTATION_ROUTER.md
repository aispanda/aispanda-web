# Documentation Router

Open this file first. One fact has one owning document; other files link rather than duplicate it.

## Document-control rules

1. **Reuse the existing owner first.** Before creating a document, search this router and the repository for the intended subject. Update the owning document when its scope already covers the change.
2. **A new document requires a demonstrated ownership gap.** Record what unique information it will own, why an existing document cannot own it cleanly, what it must not duplicate and who will use it.
3. **Obtain owner approval for a new top-level product, architecture, governance, roadmap or requirements document.** Small implementation evidence may remain beside its implementation when an existing owner links to it.
4. **One fact has one canonical owner.** Other documents summarize only when necessary and link to the owner; they do not maintain competing copies of statuses, decisions, requirements or roadmap commitments.
5. **Register and route in the same change.** A new maintained document is incomplete until this router records its ownership, exclusions and lifecycle status and affected owners link to it.
6. **Use controlled lifecycle states.** Maintained documents are `Proposed`, `Current`, `Superseded` or `Archived`. When ownership moves, mark the prior owner `Superseded` and link to the replacement; do not leave two current owners.
7. **Verify before handoff.** Search for overlapping facts, check links, review the diff and confirm that no secret, private evidence or project-specific value entered a reusable or public document.
8. **Do not create documents as a substitute for execution.** A document must support a decision, requirement, operation, verification or handoff that has a named owner and consumer.

### New-document control gate

Create a maintained document only when all answers are present:

- What unique outcome does it support?
- Which existing owner was checked, and why is it insufficient?
- What exact scope does the new document own and exclude?
- Who approves and maintains it?
- Where is it registered and linked?
- What evidence will show that it remains current or should be superseded?

If these answers are missing, do not create the document; update an existing owner or keep the information as a temporary local note.

| Document | Owns | Does not own | Status |
|---|---|---|---|
| `DOCUMENTATION_ROUTER.md` | Documentation ownership, lifecycle and navigation | Product facts or automation | Current |
| `AUTOMATION_ROUTER.md` | Script and external automation boundaries | Site strategy or public copy | Current |
| `SITE_FOUNDATION.md` | Purpose, audiences, launch stages, brand direction, public-runtime baseline and site-wide accepted decisions | Detailed capability architecture, page implementation or deployment execution | Current |
| `ARCHITECTURE_DECISIONS.md` | Accepted content, identity, collaboration and community solution decisions with reasons and boundaries | Delivery sequence or detailed behavioral requirements | Current |
| `PRODUCT_ROADMAP.md` | Phased user outcomes, ordering and exit gates | Detailed requirements or committed dates | Current |
| `REQUIREMENTS_EPICS_INVENTORY.md` | Epic scope, status, requirement ownership and next proof | Detailed acceptance criteria | Current |
| `CONTENT_AUTHORING_REQUIREMENTS.md` | Authenticated authoring, draft/publish lifecycle, editor capabilities, book-ready model and recommended studio architecture | Named comparative research or implementation detail | Proposed baseline |
| `AI_95_GOVERNANCE_HARDENING_PLAN.md` | AI-95 baseline lifecycle, exact-commit PR gate design, verified local evidence and controlled bootstrap/cutover sequence | Story-contract policy, AI-96 agent capability governance, product requirements or permission to merge/publish | Current |
| `SEED_IDEAS.md` + `docs/seeds/` | Local-only incubating ideas (gitignored — not published) | Live routes | Local only — gitignored |
| `../site-profile.json` | Machine-readable identity, audiences, launch capabilities, repository and hosting profile | Long explanations or secrets | Current |
| `../README.md` | Human quick start | Strategy or detailed operating procedure | Current |
| `RA-006 Website Delivery System` | Reusable cross-project website method, templates and QA | AIspanda-specific decisions | Resolve through the owner's reusable-asset inventory |
| `RA-002 Deployment Automation` | Reusable gated Cloud Run deployment workflow | AIspanda deployment values or authorization | Resolve through the owner's reusable-asset inventory |
| `RA-004 Model-Routing bake-off skill` | Preflight + bake-off + task routing method | AIspanda essay claims | Central library |
| `RA-009 Insight Forge` | Flavor-matched public writing loop | Live site publish authority | Central library |
| `docs/research/compute-sovereignty/` | Compute-sovereignty / public switchboard research vault | Deployment | Local research |
| `docs/research/compute-sovereignty/HANDOVER-PROMPT-blog-preflight-switchboard.md` | Paste-ready prompt for blog thread on preflight/switchboard / multi-perspective bake-offs | Final published HTML | Updated 2026-08-09 (post §7 title fight) |
