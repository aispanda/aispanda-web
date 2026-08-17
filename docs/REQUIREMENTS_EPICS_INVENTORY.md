# Requirements and Epics Inventory

Status values: `Prototype`, `In progress`, `Planned`, `Deferred`, `Complete`
Detailed acceptance criteria remain in the owning requirement or implementation document.

| Epic | Outcome | Status | Requirement owner | Current boundary / next proof |
|---|---|---|---|---|
| EP-01 Content workspace | Find, filter, read and explicitly edit content. | Prototype | `CONTENT_AUTHORING_REQUIREMENTS.md` | Local content index; production source and cloud data are not connected. |
| EP-02 Identity and access | Verified users start as Commenters; Administrators approve editorial access. | In progress | `CONTENT_AUTHORING_REQUIREMENTS.md` | Google provider, two private Administrator invitations, default Commenter registration and role requests exist; browser proof covers request cancellation and re-request, while approval/denial tests remain. |
| EP-03 Persistent drafts and revisions | Drafts survive devices, sessions and failures. | In progress | `CONTENT_AUTHORING_REQUIREMENTS.md` | Local drafts work; Firestore synchronization and conflict tests remain. |
| EP-04 Structured editor and preview | Authors write semantically and preview the real public rendering. | Prototype | `CONTENT_AUTHORING_REQUIREMENTS.md` | Prototype uses browser editing commands; production editor and stable serialization remain. |
| EP-05 Content lifecycle | Draft, published, draft-change and unpublished states behave predictably. | Prototype | `CONTENT_AUTHORING_REQUIREMENTS.md` | Local transitions and protected actions exist; API enforcement remains. |
| EP-06 Automated publishing | Publish produces a validated release and live URL without manual code work. | Planned | `CONTENT_AUTHORING_REQUIREMENTS.md` | Privileged publish API, repository integration and deployment status remain. |
| EP-07 Media and embeds | Authors add safe, accessible media. | Planned | `CONTENT_AUTHORING_REQUIREMENTS.md` | Upload, validation, variants and retention remain. |
| EP-08 Multi-user editorial roles | Administrators and authors collaborate within explicit permissions. | Planned | `CONTENT_AUTHORING_REQUIREMENTS.md` | Role matrix and enforcement tests remain. |
| EP-09 Books | Ordered parts and chapters use the shared authoring platform. | Planned | `CONTENT_AUTHORING_REQUIREMENTS.md` | Book-ready model is required; working book UI and export remain. |
| EP-10 Comments and moderation | All signed-in roles except View Only can comment, reply and like; Publishers/Administrators can pin; editing is owner-only and Administrators may delete any comment. | In progress | `CONTENT_AUTHORING_REQUIREMENTS.md` | Native bounded threads, likes, pins, private ownership records, tombstone deletion and rules are implemented; deployed cross-account ownership tests, abuse reporting and server-side rate controls remain. |
| EP-11 Community Groups and Discussions | Members create and find durable conversations in moderated, cost-bounded Groups. | Planned | `CONTENT_AUTHORING_REQUIREMENTS.md` | Product baseline covers Group authority, membership, Discussion/Post structure, ownership, topics, search, sorting, notifications and moderation; implementation and representative role/load proof remain. |
| EP-12 Reusable platform extraction | A generic package launches brand-specific content communities safely. | Deferred | RA-003 promotion process | Requires verified AIspanda implementation and independent portability evidence. |
| EP-13 Events | Members discover and join simple scheduled activities. | Planned | `CONTENT_AUTHORING_REQUIREMENTS.md` | RSVP event baseline is defined; implementation and timezone, capacity, cancellation and role proof remain. |
| EP-14 Learn and Learning paths | Members learn through self-paced Learning paths and track progress in `My learning plan`. | Planned | `CONTENT_AUTHORING_REQUIREMENTS.md` | Learning path structure, Lessons, progress, linked Discussion, publication and role rules are defined; implementation and proof remain. |
| EP-15 User-funded AI router connection | Members connect their preferred managed router once, retain activation until explicit disconnect and compare bounded results without AIspanda paying model charges. | In progress | `CONTENT_AUTHORING_REQUIREMENTS.md` | Dedicated `/ai` connect-compare-activate UI, one-active-router contract, OpenRouter and Hugging Face live OAuth proof, token fallbacks, Cloudflare adapter, the approved comparison matrix, encrypted-vault/server-relay implementation and focused local tests exist. Production secret/IAM bootstrap, cross-device restoration, expiry/refresh, revocation, disconnect and account-deletion proofs remain. |
| EP-16 AI assistance experiences | Approved roles receive bounded, transparent AI help for specific authoring, reading and community needs. | Planned | `CONTENT_AUTHORING_REQUIREMENTS.md` | Owner approval of prioritized use cases, shared context, outputs and review behavior is required before implementation. |

## Cross-epic rules already accepted

- Published titles open the read-only version; explicit edit actions open the working version.
- Published content cannot be deleted. It must be unpublished first, then pass the protected deletion workflow.
- Publishing remains deliberate and cannot occur directly from a list-row action.
- Privileged permissions are enforced outside the browser.
- New accounts cannot self-escalate beyond Commenter; only an existing Administrator can approve editorial access.
- Administrators and Publishers may create Groups; every signed-in role except View Only may participate in permitted Groups and start Discussions.
- No role may edit another member's Post. Administrators may delete another member's Post only as a recorded moderation action.
- Brand, domain, credentials, user data and project evidence do not enter the reusable core.
- AI connectors must not persist user API keys or silently switch to site-funded providers; integrated AI use cases require owner approval before implementation.
