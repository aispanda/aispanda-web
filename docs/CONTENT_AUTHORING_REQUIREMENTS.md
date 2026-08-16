# AIspanda Content Studio Requirements

Status: Proposed product baseline
Audience: product, design and engineering
Scope: authenticated blog authoring and article comments first; structured books and community later

## Outcome

AIspanda should provide a private content studio where authorized staff initially sign in with Google, create or update content with a structured rich-text editor, preview it in the real site design, save it as a draft and deliberately publish it. The identity model must permit additional sign-in providers for future community members.

The public site should remain fast and static-first. The first release should preserve Markdown as the published source format and the existing Cloud Build deployment path, while removing Markdown and deployment work from the normal author experience.

## Product principles

1. **Writing is immediate; publishing is deliberate.** Draft changes autosave. Publishing requires an explicit review step and confirmation.
2. **Authors choose meaning; the design system owns presentation.** Authors select semantic blocks such as heading, quote and callout. Site typography and responsive layout remain centrally controlled.
3. **Preview the real result.** Preview must use the same renderer and design tokens as the public site, at desktop and mobile widths.
4. **Never lose work.** Drafts, revisions and publishing failures must be recoverable.
5. **Keep the current escape hatch.** Existing Markdown editing and deployment remain supported during migration.
6. **Design the content model for extension.** Blog delivery is first, but identity, storage and editor contracts must support books, comments and community capabilities without replacing the platform foundation.

## Users and permissions

### Initial release

- A verified new account signs in with Google and receives Commenter access by default.
- Commenters may request Author, Publisher or Administrator access; only an existing Administrator can approve or decline the request. A pending request may be cancelled and submitted again without granting or changing access.
- Content Studio remains inaccessible until the account has an active Administrator, Publisher or Author role.
- Firestore security rules verify access for draft data; Cloud Run verifies identity and role for every privileged mutation, preview-link and publish request.
- The owner can create, edit, preview, publish, unpublish, archive and restore content.

### Role model

| Role | Capability |
|---|---|
| Administrator | All content and publishing capabilities; manage users and roles; create, reply to and like comments; edit only their own comments; delete any comment for moderation; pin top-level comments; manage publication settings and integrations. |
| Publisher | Create and edit articles; publish and unpublish articles; create, reply to and like comments; edit or delete their own comments; pin top-level comments; no user, role or security administration. |
| Author | Create and edit articles, initially their own; create, reply to and like comments; edit or delete their own comments; cannot publish or unpublish. |
| Commenter | Default role for a verified new account. Create, reply to and like comments; edit or delete their own comments; cannot change another person's comments or access Studio. May request an editorial role. |
| View Only | Read permitted content; cannot create, reply to, like, edit or delete articles or comments. On public content this is equivalent to an ordinary reader. |

Add another role only when it requires a distinct permission set. Permissions must be enforced by security rules and privileged APIs, not only hidden in the interface.

Role requests never grant access by themselves. A requester may cancel a pending request and submit another one; the latest cancellation time remains recorded. Approval must update the private UID-based role record, record the reviewing Administrator and retain the request outcome for audit.

Published content cannot be deleted by any role. An Administrator or Publisher must unpublish it first; deletion then follows the protected unpublished-content workflow.

Comment permissions are ownership-based. Every role may edit only comments they authored. Commenters, Authors and Publishers may delete only comments they authored; Administrators may delete any comment for moderation but may not rewrite another person's words. Publishers and Administrators may pin or unpin top-level comments. Every eligible signed-in member may like a comment once and remove their own like; View Only cannot mutate discussion data. These constraints must be enforced in Firestore rules or privileged APIs as well as reflected in the interface.

The first discussion UI remains article-first: a minimal composer, chronological two-level threads, replies grouped under their top-level comment and pinned top-level comments first. Deleting text preserves a visible tombstone when needed so replies do not lose context. V1 excludes avatars, images, rich text, votes/dislikes, badges, follower mechanics, notifications and passage-level responses.

### Identity, analysis and outreach data

- Use basic Google sign-in only; do not request Gmail, contacts or other expanded Google scopes.
- Use one `Continue with Google` action for both account creation and returning sign-in. On first successful use, show a one-time profile step before continuing.
- Record the stable account ID, verified email, display name, provider, first/last sign-in times, privacy-notice version, role and necessary security/audit events. Do not store or display the Google profile photo.
- The profile step uses three optional native dropdowns: `Professional role`, `Primary interest` and `Country or area`. Each defaults to `Prefer not to say`; declining optional profile data must not block registration or change permissions.
- Keep professional role and interest separate from authorization roles. Use a small product-owned category list rather than free text so analysis remains consistent and the form stays quick.
- Store country/area as an ISO 3166-1 alpha-2 code sourced from the public UN M49 list; render localized names with `Intl.DisplayNames`, provide a no-answer option and do not use flags.
- Use product activity for service operation and aggregated analysis under a documented purpose and retention period.
- Do not use sign-in or content activity for outreach unless the person separately opts in. Store the consent purpose, notice version, timestamp and withdrawal state; provide unsubscribe and preference controls.
- Do not infer or target people by religion, philosophy, politics, health or other sensitive traits from the sites, groups, articles or comments they use. Any future exceptional use requires a documented lawful basis, explicit product approval and appropriate consent/safeguards before collection.
- Provide account-data access, correction and deletion/request workflows before community accounts launch.
- Review and delete data that is no longer necessary; anonymize or aggregate analysis where individual identity is unnecessary.

This baseline follows [ICO data minimisation and purpose limitation guidance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-protection-principles/a-guide-to-the-data-protection-principles/), treats religious, philosophical and political profiling as [special-category processing](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/special-category-data/what-is-special-category-data/), and follows Google's requirement to request only the [smallest necessary OAuth scopes](https://developers.google.com/identity/protocols/oauth2/policies).

## Core author journey

1. Sign in with Google.
2. Land on the content list, filtered by status if desired.
3. Open an existing item or create a new article.
4. Enter a title and compose with semantic rich-text blocks.
5. Draft changes autosave and show `Saving`, `Saved` or `Save failed`.
6. Use the `Save` split action:
   - `Save as draft` creates an explicit revision checkpoint without publishing.
   - `Publish` opens publication settings and final review; it never publishes immediately from the first click.
7. Preview the real page at desktop and mobile widths.
8. Publish now or schedule for later.
9. See a durable publishing result with the live URL, release identifier and any failure recovery action.

## Content lifecycle

User-facing states:

- Draft
- Publishing
- Published
- Published · Draft changes
- Scheduled
- Publish failed
- Archived

Required behavior:

- Autosave draft changes after a short idle interval and when focus leaves a field.
- Preserve the draft if publishing or deployment fails.
- Create an immutable revision at explicit draft save and before every publish.
- Prevent stale browser tabs from silently overwriting newer work; show a conflict resolution path.
- Permit rollback to a previous published revision by creating a new release from it.
- Support unpublish and archive as reversible operations.
- Never allow a published article to be deleted or moved to trash. It must be unpublished first, with a confirmation that explains the public URL will stop working.
- After unpublishing, `Move to trash` is allowed. Trash remains restorable for a defined retention period before permanent deletion is available.
- Reserve permanent deletion for the owner, require a typed title confirmation and preserve an audit record. Enforce these rules in the publish API as well as the interface.

## Content list workspace

The default workspace must provide:

- Tabs or filters for all, drafts, scheduled, published and archived content.
- Search by title and body text.
- Filters for content type, author, tag and access level.
- Newest/oldest and recently updated sorting.
- Each row shows title, author, status, last update or publication time and content type.
- Keep the primary row action contextual: `Edit` for drafts and `Edit draft` when a public version exists.
- Put secondary actions in an overflow menu: preview, duplicate, archive and status-dependent publication actions.
- Show `Unpublish` only when a public version exists. Show `Move to trash` only for content with no public version; never place either destructive action directly in the row.
- A clear empty state and a prominent `New` action.

Use three plain author-facing states:

- `Draft`: no public version exists.
- `Published`: the public and working versions match.
- `Published · Draft changes`: a public version exists and newer edits remain unpublished.

`Drafts` includes `Draft` and `Published · Draft changes`; `Published` includes `Published` and `Published · Draft changes`. When a public version exists, selecting the title opens that read-only version and `Edit draft` opens the working version.

## Article editor

### Required blocks for the first release

- Title
- Paragraph
- Heading 2 and Heading 3
- Bold, italic, link and inline code
- Bulleted and numbered lists
- Block quote
- Divider
- Callout
- Code block with language metadata
- Image with upload, alt text, caption and optional credit
- Table with an accessible header row
- Embed/bookmark with a safe URL allowlist

### Later blocks

- Gallery
- Button or call to action
- Video, audio and downloadable file
- Toggle/disclosure
- Public excerpt boundary
- Member-only section
- Newsletter-only section
- Raw Markdown for expert users
- Sanitized custom HTML for administrators only

### Editing behavior

- Slash command or add-block menu, plus keyboard shortcuts.
- Selection toolbar for common inline formatting and semantic headings.
- Drag-and-drop block reordering with keyboard-accessible alternatives.
- Undo/redo, word count and calculated reading time.
- Paste from common editors without importing foreign fonts, sizes or unsafe markup.
- Stable serialization: editor JSON to Markdown and Markdown back to editor JSON must preserve supported content.
- Unicode support, including Indic scripts, smart punctuation and mixed-script text.

### Zero-cost AI assistance MVP

- Offer a clearly labelled `Copy AI request & open Gemini` action; never imply that AI runs inside AIspanda.
- Let the author choose selected text or the entire article and edit the instruction before continuing.
- Show the exact request, including article content, before anything is copied or shared.
- Copy only after an explicit click, open Gemini in a separate tab and tell the author to paste with `Ctrl+V` or `Cmd+V`.
- If browser clipboard access fails, expose a manual copy control and select the request for keyboard copying.
- Returning revised text remains a deliberate manual paste in the first release; the Studio must not overwrite content automatically.
- Keep the page structure and labels understandable to Gemini in Chrome when a user explicitly shares the tab.
- Do not add provider API keys, usage billing or background data transfer until observed demand justifies an integrated version and its privacy controls.

## Typography and branding

- Do not expose arbitrary per-selection font family or font size in published content.
- Expose semantic styles only: title, lede, H2, H3, body, quote, caption, callout and code.
- Keep actual fonts, sizes, line height, spacing, colors and responsive behavior in site design tokens.
- Optional private editor preferences may include editor theme, zoom/font size and line height, but must not affect publication output.
- Site-level brand controls may later manage logo, icon, cover, accent color, heading font and body font with responsive preview.

## Article settings

The editor must support:

- Slug with uniqueness validation and live URL preview.
- Excerpt/summary.
- Tags and primary tag.
- Author.
- Feature image with focal point, alt text and credit.
- Featured-content flag.
- Publish now or schedule with an explicit timezone.
- Access level, initially public/private and later member tiers.
- SEO title and description with length guidance.
- Canonical URL.
- Search-result preview.
- Social title, description and image previews.
- Revision history with author and timestamp.

Custom code injection is not part of the first release. If added later, restrict it to administrators, sanitize or sandbox it, and log every change.

## Preview and publication review

- Web preview must use the production renderer rather than an editor approximation.
- Provide desktop and mobile viewport toggles.
- Allow an expiring, revocable preview link for a draft.
- Show title, slug, author, access, schedule, SEO warnings, missing image alt text and broken-link findings in final review.
- The final button must say exactly what will happen, such as `Publish now` or `Schedule for 18 Aug, 9:00 AM ET`.
- Newsletter delivery, if introduced, must be a separate explicit choice from web publication and require its own recipient summary.

## Book-ready content model

The article UI is phase one, but the domain model must support:

```text
Publication
  -> Work (article or book)
      -> Section (optional for articles; required for books)
          -> ordered content blocks
      -> Revision
      -> Release
```

Book capabilities should be staged after the article workflow is stable:

- Front matter, body and back matter.
- Chapters and subchapters with drag-and-drop ordering.
- Chapter status, word count and manuscript total.
- Search and replace across one chapter or the whole manuscript.
- Chapter-specific preview links and comments.
- Endnotes/footnotes and cross-references.
- Book metadata, cover management and table of contents.
- Export to EPUB and print-ready PDF; DOCX backup is desirable.
- Shared editor blocks and revision machinery with articles.

## Validation and quality gates

Block publication when:

- The title or slug is missing.
- The slug is not unique.
- Required media upload has not completed.
- Content cannot be serialized safely.

Warn, but allow an authorized override, when:

- An informative image lacks alt text.
- Heading levels skip hierarchy.
- Links are invalid or unreachable.
- SEO title or description is outside guidance.
- No excerpt or social image is present.
- The content contains unsupported pasted formatting.

The preview and publish pipeline must run the same content-boundary checks used by the repository build.

## Recommended solution architecture

### Preserve the public site

- Keep the existing Astro static output, Nginx container and Cloud Run deployment.
- Keep published articles as Markdown in `src/content/insights` for the first phase.
- Keep the existing build validation and Cloud Build release path as the final publication gate.

### Add a separate private studio

Recommended components:

| Concern | Recommended technology | Reason |
|---|---|---|
| Studio UI | Protected Astro client route at `/studio` | Reuses the current deployment and design system; split into a separate application only if measured complexity justifies it. |
| Rich-text engine | TipTap/ProseMirror with a restricted extension set | Structured document model, mature block editing and controllable serialization. |
| Sign-in | Firebase Authentication; Google provider first for staff | Fits the existing Google Cloud footprint while permitting additional providers for future members. |
| Authorization | Private access/role records, Firestore security rules and Cloud Run role checks | Supports multiple roles without trusting browser visibility or exposing the allowlist in public code. |
| Drafts and revisions | Firestore | Autosave, revision metadata and structured editor JSON without changing the public renderer. |
| Media | Google Cloud Storage with signed uploads | Durable originals, controlled writes and future image processing. |
| Publish API | Small Cloud Run service | Verifies identity, validates content, creates releases and reports deployment state. |
| Repository write | GitHub App scoped to the content paths | Preserves reviewable Markdown history without storing a personal access token in the browser. |
| Release | Existing Cloud Build pipeline | Reuses the current validated deployment mechanism. |
| Observability | Structured audit log plus Cloud Logging | Records actor, action, revision, release and failure reason. |

The canonical draft should be versioned editor JSON. Publishing converts it deterministically to Markdown, validates it, commits it and records the resulting commit and deployment status. A tested Markdown-to-editor converter keeps the existing authoring route reversible.

### Future instant-publication option

If build latency becomes unacceptable, move selected content routes to an API-backed or on-demand renderer. Do not do this in the first release: it changes caching, availability, security and rollback behavior and removes the current static publication gate.

## Security and operational requirements

- No OAuth credentials, repository tokens or service-account keys in browser code.
- Verify identity tokens and role authorization on every mutation.
- Restrict the repository integration to required branches and content paths.
- Sanitize rendered HTML and embeds; disable arbitrary scripts in author content.
- Use signed, size-limited media uploads and validate MIME type.
- Log sign-in, draft checkpoint, publish, unpublish, rollback, permission and destructive actions.
- Back up draft/revision data and test restoration.
- Make preview links expiring and revocable.
- Rate-limit publish and media operations.
- Provide publishing idempotency so retries cannot create duplicate releases.

## Delivery stages and complexity

| Stage | Scope | Indicative effort for one experienced engineer |
|---|---|---|
| Technical spike | Auth, one editor document, Markdown round-trip, preview and one non-production publish path | 2-3 days |
| Blog MVP | Single owner, content list, editor, autosave, preview, draft/revisions, media, SEO basics, Git-backed publish and status | 10-15 focused engineering days |
| Production hardening | Conflict handling, rollback, audit, accessibility, failure recovery, security review and operational runbook | 5-10 days |
| Books phase | Hierarchy, reordering, manuscript navigation, cross-chapter tools and export pipeline | 4-8 additional weeks |

These are planning ranges, not commitments. The largest uncertainty is lossless conversion between structured editor content and the current Markdown/rendering conventions.

## Preparation checklist

- Keep at least two recovery Administrators. New verified accounts default to Commenter; test request, cancellation, re-request, approval, decline and self-escalation denial for every editorial role.
- Keep the initial Studio at the protected `/studio` route; reassess a separate application only if scale or release independence requires it.
- Create development and production Google/Firebase projects.
- Register OAuth origins and redirect URLs.
- Define the editor block schema and Markdown conversion contract.
- Build round-trip fixtures from the existing long-form article, including links, headings, quotes, tables and Unicode text.
- Define media limits, image variants, alt-text policy and retention.
- Create the restricted repository integration and non-production publish branch.
- Define preview-link lifetime and sharing policy.
- Specify release-state UI and failure messages.
- Create acceptance tests for autosave, concurrent edits, preview parity, publish, failed publish and rollback.
- Document backup, recovery and emergency credential rotation.

## MVP cut line

The first production release is complete when the authorized owner can sign in with Google, open the existing article, edit it in structured rich text, see `Saved`, preview the exact desktop/mobile public rendering, save a revision as draft, publish through final review, receive a live URL after successful deployment and recover the unchanged draft after a simulated publish failure.

Books, collaboration, comments, community groups/chat, newsletters, paid membership, arbitrary HTML, site-wide theme editing and instant database-backed publication are explicitly outside that first cut.
