# Architecture Decisions

Status: Current decision register
Scope: AIspanda content, identity, collaboration and community platform

Owner approval recorded 2026-08-16: Google sign-in for staff now, with provider-flexible community identity later.

This document owns accepted solution decisions and their reasons. `SITE_FOUNDATION.md` owns the public-site baseline. Detailed behavior belongs in `CONTENT_AUTHORING_REQUIREMENTS.md`; delivery order belongs in `PRODUCT_ROADMAP.md`.

| ID | Status | Decision | Value and reason |
|---|---|---|---|
| AD-001 | Accepted | Keep the public site static-first on Astro, Nginx and Cloud Run. | Preserves the existing fast, low-runtime public site and validated deployment path. |
| AD-002 | Accepted | Add Firebase Authentication and Firestore alongside Cloud Run; do not replace Cloud Run. | Firebase supplies managed identity and cross-device draft persistence while Cloud Run continues to host the site and privileged publishing operations. |
| AD-003 | Accepted | Start staff access with Google sign-in, but keep identity provider-flexible for future community members. | Gives owners and authors the simplest first experience without forcing every future commenter or community member to use one provider. |
| AD-004 | Accepted | Use five roles: `Administrator`, `Publisher`, `Author`, `Commenter` and `View Only`. A verified new account starts as `Commenter`, may request an editorial role, and only an existing Administrator may approve or change roles. | Gives new members a safe useful default while preventing self-escalation into writing, publishing or administration. |
| AD-005 | Accepted | Enforce authorization in Firestore security rules and Cloud Run APIs, not only in interface visibility. | A modified browser must not be able to read drafts, change roles or publish content. |
| AD-006 | Accepted | Keep privileged actions in Cloud Run: publishing, deployment, role administration, moderation automation and security-sensitive mutations. | Repository and deployment authority never enters browser code. |
| AD-007 | Accepted | Use Firestore for structured drafts, comments and initial group/chat data, with bounded queries, pagination, retention and cost monitoring. | Supports real-time and multi-user capabilities with low initial operations; usage controls protect cost as activity grows. |
| AD-008 | Accepted | Published titles open the read-only public version; editing requires an explicit `Edit` or `Edit draft` action. A never-published draft is the only title that may open directly in the editor. | Navigation communicates the destination before the user acts. |
| AD-009 | Accepted | Treat no-cost quotas as an initial operating benefit, not a permanent cost promise. | Authentication, database and compute usage can exceed provider free quotas as comments or chat activity grows. |
| AD-010 | Accepted | Extract a reusable, brand-configurable content and community asset only after AIspanda proves the implementation and verification gates pass. | Prevents an unproven prototype or project-specific assumptions from becoming a reusable dependency. |
| AD-011 | Accepted | Collect necessary identity, role, security and audit data at sign-in; keep outreach consent separate and optional; do not infer sensitive beliefs for targeting. | Supports operations and useful analysis without turning participation in AI, spiritual or accountability communities into undisclosed sensitive profiling. |
| AD-012 | Accepted | Launch the private Studio at the protected `/studio` route and expose `Sign in` when signed out, `Content Studio` when authorized, and contextual `Edit article` controls only to authorized staff. | Welcomes Commenters and View Only members without implying editorial access; role checks still protect Studio and editing controls. |
| AD-013 | Accepted | Commit only Firebase's public web identifiers in `.env.production`; keep authorization in Firestore rules and private role records. | Ensures clean Cloud Build containers can initialize sign-in without treating client-visible identifiers as secrets or exposing private access data. |

## Activated foundation (2026-08-16)

- Firebase was added to the existing `aispanda` Google Cloud project; Analytics was left disabled.
- The `AIspanda Web` app and Google authentication provider were enabled.
- Authorized domains are `localhost`, `127.0.0.1`, `aispanda.com` and Firebase defaults.
- Firestore Standard was created in `us-east1`, matching Cloud Run, and production-deny-by-default rules were published.
- Two initial administrator invitations were created privately; each verified invitee claims a UID-based role record on first successful sign-in. User records remain outside version-controlled documentation.
- Verified accounts without an invitation receive Commenter access and may submit one editorial-role request; deployed Firestore rules reserve approval and role changes for existing Administrators.

## Target responsibility boundary

```text
Public website and Studio UI   Astro + Nginx on Cloud Run
Sign-in and sessions           Firebase Authentication
Drafts, comments and messages  Firestore
Authorization                  Role/access records + security rules + API checks
Publishing and moderation      Privileged Cloud Run services
Release                        Existing repository + Cloud Build path
```

## Reusable extraction boundary

The future reusable core may include configurable content types, rich-text authoring, books, comments, groups/chat, authentication adapters, role policies, moderation states, publishing adapters and verification suites.

It must exclude domains, brands, editorial content, user records, credentials, cloud project values, repository identifiers and project-specific evidence. Named future consumers are validation candidates, not reusable-core configuration.

## Decision evidence checked

- Project baseline and current Cloud Run/static architecture: `SITE_FOUNDATION.md`, accepted decisions D04-D05.
- Product behavior and first-release boundary: `CONTENT_AUTHORING_REQUIREMENTS.md`.
- Firebase supports web Google sign-in and additional identity providers: [Firebase Authentication](https://firebase.google.com/docs/auth).
- Firestore provides real-time queries and horizontally scaling change processing: [Firestore real-time queries at scale](https://firebase.google.com/docs/firestore/enterprise/real-time_queries_at_scale).
- Provider no-cost quotas are bounded and usage-priced beyond them: [Firebase pricing](https://firebase.google.com/pricing), [Firestore pricing](https://firebase.google.com/docs/firestore/pricing), [Cloud Run pricing](https://cloud.google.com/run/pricing).
