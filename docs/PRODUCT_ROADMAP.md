# Product Roadmap

Status: Current outcome roadmap
Rule: sequence by proven user value and risk reduction; dates require a separate commitment

| Phase | User outcome | Included | Exit gate |
|---|---|---|---|
| 0. Local Studio prototype | Owner can evaluate the content workflow before cloud setup. | Content lists, status model, rich-text editing, local drafts, preview and guarded actions. | Owner accepts the core navigation and editing workflow; build and browser checks pass. |
| 1. Private persistent Studio | Verified members sign in safely; approved staff continue drafts across devices. | Firebase Authentication, default Commenter access, Administrator-approved editorial requests, role/access records, Firestore drafts, autosave state, denied/error states and audit basics. | Administrator, editorial and Commenter allow/deny tests pass; self-escalation fails; local and cloud draft conflict/recovery tests pass. |
| 2. One-click publishing | An author publishes without editing files or running deployments. | Final review, deterministic rich-text conversion, validation, privileged publish API, repository write, Cloud Build status, live URL and failure recovery. | Existing and new articles publish through a non-production path; rollback and failed-publish recovery pass. |
| 3. Multi-user editorial work | Administrators and authors collaborate safely. | Role administration, ownership, review requests, revision attribution, concurrent-edit protection and moderation audit. | Every role passes allow/deny tests; concurrent edits cannot silently overwrite work. |
| 4. Books | Authors create ordered long-form books with the same platform. | Books, parts, chapters, reordering, cross-chapter navigation, book preview and export-ready structure. | A representative book can be drafted, reordered, previewed and published without changing the article model. |
| 5. Comments | Signed-in readers participate safely beneath published content. | Native article-first threads and replies; one like per eligible member; Publisher/Administrator pins; owner edit/delete; Administrator edit/delete; View Only denial. Reporting, rate limits and notifications follow measured need. | Core role, ownership, like, pin, authorization and tombstone-deletion scenarios pass; abuse reporting and server-side rate controls remain the next hardening gate. |
| 6. Community groups and chat | Members participate in bounded topic communities. | Groups/channels, membership, messages, pagination, unread state, moderation, retention and cost controls. | Load, moderation, privacy and cost-budget tests pass for the agreed launch size. |
| 7. Reusable platform extraction | A proven generic package can launch purpose-specific content communities. | Brand/config profile, reusable schemas, auth/role module, publishing adapters, comments/community modules, deployment templates and verification suites. | AIspanda is verified; at least one independent consumer validates portability; project-specific data is excluded. |

## Cost and scale checkpoints

- Set budgets and alerts before production Firestore or new Cloud Run services are enabled.
- Review bounded comment reads/writes and storage after initial use, and repeat the review before Community launch.
- Re-evaluate message storage when measured traffic or cost—not speculation—shows Firestore is no longer the best fit.
