# AIspanda Content Studio Requirements

Status: Proposed product baseline
Audience: product, design and engineering
Scope: authenticated blog authoring and article comments first; structured books and community later

## Outcome

AIspanda should provide a private content studio where authorized staff initially sign in with Google, create or update content with a structured rich-text editor, preview it in the real site design, save it as a draft and deliberately publish it. The identity model must permit additional sign-in providers for future community members.

The public site should remain fast and static-first. Studio-authored articles are published as immutable Firestore snapshots rendered by Cloud Run at request time, while established source-owned pages remain in the existing Astro and Cloud Build path.

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

### Publishing foundation release — AI-89

AI-89 establishes cloud drafts, safe preview, deliberate publication and runtime delivery. Its bounded transition editor supports:

- Title, paragraph, Heading 2 and Heading 3
- Bold and italic
- Validated HTTP, HTTPS and mailto links
- Bulleted and numbered lists
- Block quote and callout

The transition editor remains intentionally small so the cloud publication seam can ship without coupling it to an editor-framework migration. Server sanitization is authoritative; client HTML is never trusted as publication output.

### Professional structured editor — AI-91

[AI-91](https://linear.app/ai-spanda/issue/AI-91/build-a-professional-tiptap-editor-for-content-studio) replaces the transition editor with a governed Tiptap implementation. Its required blocks and controls are:

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

It also adds undo/redo, nested-list indent/outdent, accessible toolbar state and semantic typography presets. Font family, point size, arbitrary colour, highlight, underline and strike are excluded from the initial professional editor: authors choose meaning while the publication theme owns presentation. A semantic mark or correction treatment may be added later only when an evidenced editorial need and accessibility design exist.

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

### AI assistance and user-funded connection

- Offer a clearly labelled `Copy AI request & open Gemini` action; never imply that AI runs inside AIspanda.
- Let the author choose selected text or the entire article and edit the instruction before continuing.
- Show the exact request, including article content, before anything is copied or shared.
- Copy only after an explicit click, open Gemini in a separate tab and tell the author to paste with `Ctrl+V` or `Cmd+V`.
- If browser clipboard access fails, expose a manual copy control and select the request for keyboard copying.
- Returning revised text remains a deliberate manual paste in the first release; the Studio must not overwrite content automatically.
- Keep the page structure and labels understandable to Gemini in Chrome when a user explicitly shares the tab.
- Add a router-neutral connection layer that permits several managed routers to remain connected in the browser tab while exactly zero or one is active for AI actions. A newly connected first router may become active; connecting an additional router must not silently switch or remove the active one. Connected alternatives show `Make active`; the selected card shows a non-interactive Active indicator. Initial options are OpenRouter, Hugging Face Inference Providers and Cloudflare AI Gateway; LiteLLM is excluded from the member-facing MVP because it transfers operating and support responsibility to AIspanda or the member.
- Prefer one-click OpenRouter OAuth with S256 PKCE. Let expert users connect an existing OpenRouter key through a password field.
- Prefer one-click Hugging Face OAuth using AIspanda's public no-secret OAuth application and S256 PKCE. Request only `inference-api`; keep a fine-grained token field under `Use an API token instead` as the fallback.
- Validate the key directly with OpenRouter and show connection and per-key limit status without exposing the key. Label OpenRouter as the source of truth; the UI must not imply AIspanda guarantees the remaining balance, reset or billing outcome.
- Keep light personal information on `/account`. Put router connections and the comparison Playground together on one dedicated signed-in `/ai` page because comparison informs which connected router the member makes active. Every router card must make Not connected, Connected, Active and Needs attention states immediately understandable, with Connect, Make active and Disconnect actions as appropriate. Keep `/account/ai-playground` as a compatibility redirect to `/ai#playground`.
- Persist an activated router connection across sign-out, browser closure and devices until the member explicitly disconnects, subject to provider expiry/revocation or a security-required reconnect. Use an authenticated encrypted server-side account vault and server-relayed provider calls; browser clients receive connection status and bounded results, not stored credentials. Keep vault ciphertext and metadata outside client-readable Firestore paths and never place provider credentials in drafts, `localStorage`, logs, analytics, documentation or generated output. Sign-out clears browser session material but does not delete the vault entry. Disconnect deletes the vault entry and revokes provider access when supported. Until vault encryption, access-control, expiry/refresh, revocation, account-deletion and cross-device tests pass, retain same-tab `sessionStorage` as an explicitly temporary fallback and label its limited lifetime honestly.
- Connecting must not send article content. Every later AI request must show the exact content and instruction before transmission.
- Do not activate a specific integrated AI use case until the owner approves its user value, eligible roles, shared context, output limit and review/application behavior.
- Treat the user's router account as the payer; AIspanda must not silently fall back to a site-funded provider or retry through another router.
- The first approved AI action is a signed-in AI Router Playground. Accept a user-written prompt of at most 300 characters and offer one explicit beginner-friendly example prompt; allow a run through the active router or a concurrent comparison of explicitly selected connected routers using the identical prompt; request no more than 80 output tokens per router and display at most 500 response characters. Present routers as columns and aspects as rows in a horizontally scrollable comparison matrix. Show each of these fields once: routing method, model ownership, usage type, fallback, infrastructure provider, time to first response, output speed, reasoning tokens, reported cost and token use. Every comparable metric must state whether lower or higher is better; color the best comparable value green and the weakest red. Keep ownership, routing, provider and token rows neutral where lower/higher does not imply quality. Reported cost may identify a winner only when every successful router reports a directly comparable unit. Do not put answer quality in the metric table or ask routers to score one another; the member makes a temporary preference choice after reading the answers. Keep per-result trace details limited to non-duplicate evidence. Missing metrics must say `Not reported`; do not calculate unreported cost, create a combined score, persist prompts/results/preferences or retry through another router. A member may explicitly make a successful result's connected router active after comparison. State clearly that each run may consume the member's provider credit and AIspanda adds no AI usage charge. Link router/model identities to their source pages and keep a short, grouped set of benchmark and model-catalog learning links rather than a comprehensive directory.

Candidate use cases awaiting owner approval, in proposed order:

1. Studio authoring for Authors, Publishers and Administrators: improve selected text, simplify, correct grammar, adjust tone, and suggest title, excerpt or tags.
2. Deterministic connection help for everyone: account, credits, limits, privacy and common recovery steps; this must work even when AI is disconnected.
3. Published-reading help for every role: explain, define or show why selected text matters, using only the selection and a bounded context window.
4. Later: research planning, one's own comment/reply assistance, Discussion catch-up, Event/Learning drafting, and Administrator-only moderation summaries.

Every generated result remains a proposal. AI may never post, publish, delete, moderate, change roles or apply content without an explicit human review action.

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

## Community, Group, Discussion and Post requirements

The first community release should optimize for thoughtful, durable conversation rather than imitate a fast-moving chat stream. It reuses the existing identity, five-role authorization model, ownership rules, notifications and Firestore boundary.

### Plain product structure

```text
Community
  -> Group (stable topic or member space)
      -> Discussion (titled conversation; internally this may be a thread)
          -> Post (opening message or reply, with optional reply-to context)
```

- Use `Group`, `Discussion`, `Post` and `Reply` in the interface. Use `thread` only as an internal data or engineering term.
- The main creation action is `Start a discussion`; `New post` is reserved for contributing inside an existing Discussion.
- Article comments and community Posts share identity, ownership and moderation rules, but retain interfaces suited to their context.

### Authority and membership

- Administrators and Publishers may create Groups. Publishers may manage Groups they created; deleting a Group or changing its access boundary requires an Administrator.
- V1 supports `Open to members` and `Invite only` Groups. Secret, paid and real-time chat Groups remain later options.
- Every signed-in role except View Only may join or leave a permitted Group, start a Discussion, post, reply, like and remove their own like.
- Members may edit or delete only Posts they authored. Administrators may delete any Post for moderation but may never edit another person's words.
- Administrators and Publishers may pin or unpin Discussions and important Posts. Only Administrators may close or reopen a Group; Administrators and Publishers may close or reopen a Discussion.
- A question Discussion may be marked `Answered` by its creator, a Publisher responsible for the Group or an Administrator.

### Group and Discussion experience

- A Group landing page shows its purpose, access, member count, controlled topics and a compact Discussion list. It should not resemble a crowded administration dashboard.
- Each Discussion row prioritizes title, creator, topics, last activity, reply count, unread state and pin/answered/closed state. Hide views and participant decoration until proven useful.
- Put pinned Discussions first, then default to `Recent activity`. Let members choose `Newest` or `Most discussed`, and remember their last choice. Do not use numbered rankings.
- A title opens the Discussion from the beginning; an unread indicator resumes at the first unread Post; the activity timestamp opens the latest Post. Accessible labels must make these destinations explicit.
- Inside a Discussion, show the opening Post followed by oldest-first replies so the conversation reads coherently. Offer `Newest first` as a member preference.
- Show `Replying to [name]` and a short quoted context instead of deeply indenting every reply. A deleted Post becomes a tombstone when later replies depend on it.
- Keep states small: `Open`, `Answered` for question Discussions and `Closed`. Closing stops new Posts without hiding prior conversation.
- Draft Discussions autosave privately. Starting a Discussion requires a clear title, one Group, an opening Post and optional controlled topics.
- On narrow screens, use one column and preserve title, state, replies, unread position and activity. Remove secondary excerpts and decoration before compressing primary information.

### Post composer and media

- Keep the composer structured and brand-safe: bold, italic, semantic headings, lists, quote, code, links, mentions and emoji. Do not expose arbitrary fonts, sizes, colors, custom HTML or pasted foreign styling.
- Support pasted or uploaded images with alt text, links to internal Discussions, and safe previews for trusted video URLs such as YouTube. V1 does not host uploaded video.
- Show a live preview or reliable rich-text rendering before posting. Save unfinished Posts and Discussions as private drafts.
- An edited Post shows `Edited` and retains revision/audit data. A short edit reason may be offered but is not mandatory for ordinary member edits.
- Polls, GIF catalogues, voice/video recording, broad embed catalogues and complex tables remain optional later enhancements.

### Topics, filtering, sorting and search

- Administrators and Publishers manage a small controlled topic list. Eligible members select relevant topics when starting or editing a Discussion.
- Groups are stable destinations; topics are lightweight labels that work across Groups. Avoid deep Group hierarchies and uncontrolled member-created tags in V1.
- A Group provides `All` plus topic filters. Add `Unanswered`, `Following` and `Unread` when content volume justifies them.
- Site search spans Group names, Discussion titles, opening Posts and replies. Results are grouped into `Discussions` and `Posts`; every Post result shows and opens within its parent Discussion.
- Search supports optional Group and topic filters. Add author and date filters after content volume makes them valuable.
- Members may bookmark a Discussion or Post and later find saved items from their account area.

### Engagement, notifications and moderation

- One member may like each Discussion or Post once and remove their own like. View Only cannot like.
- Members may follow or unfollow a Group or Discussion. Posting follows that Discussion by default with a clear opt-out.
- Notification levels are simple: `All activity`, `Replies and mentions`, and `Muted`. The default is replies and mentions.
- Use one notification inbox with unread state and `Mark all read`. Notify direct replies, mentions, followed activity, role-request outcomes and pinned announcements.
- Every Post provides `Report`. Reports enter an Administrator queue with reporter, reason, target, status and audit history.
- Moderation actions are explicit and logged: pin/unpin, close/reopen, remove with reason, restore when supported and resolve/reject report.
- Read and write queries are paginated and bounded. Define retention, rate limits, abuse controls and cost alerts before public launch.

### Community acceptance criteria

- View Only can read permitted Groups and Discussions but sees no enabled join, create, reply, like or moderation controls; server rules reject equivalent direct writes.
- Administrator or Publisher can create a Group; Author or Commenter cannot, even through a direct request.
- An eligible member can join a Group, draft and start a Discussion, reply with visible context, and edit or delete only their own Posts.
- Administrator can remove any Post with an audit reason but cannot rewrite it as though the original member made the change.
- The same Discussion list can open its beginning, first unread Post and latest activity as three predictable destinations.
- A Discussion creator can mark their question Answered; authorized Group managers can pin, close, reopen or correct that state.
- Search returns matching Discussions and Posts with Group, topic and parent context; no result opens a reply without its Discussion.
- Report resolution and restoration leave audit records; repeated actions do not create duplicate moderation items.
- Core journeys remain usable without horizontal scrolling at a narrow mobile width.

## Optional Events and Learn modules

Events and Learning paths reuse the same account, role, Group, notification and Discussion contracts. They are staged after core community capability and do not create a second member system.

### Events baseline

- Administrators and Publishers may create, edit, publish, cancel and archive events. Authors may prepare event drafts but cannot publish them.
- V1 fields are title, concise description, start/end time with explicit timezone, location type (`Online link`, `In person` or `To be announced`), optional related Group/topic, capacity and access.
- Eligible members may RSVP, cancel an RSVP and see a clear confirmed/waitlisted/cancelled state. Event cancellation notifies registered members.
- Event discovery separates `Upcoming` and `Past`, defaults to a compact list, and keeps a calendar view optional. Each row prioritizes date, local time, title, location type and the member's RSVP state; the event page carries its discussion thread.
- Recurrence, payments, native live rooms, streaming, recordings and advanced host controls are deferred.

### Learn and Learning paths baseline

```text
Learn
  -> Learning path (published guided content)
      -> Section
          -> Lesson

My learning plan = a member's enrolled paths, next lessons and progress
```

- Start with self-paced Learning paths. A Learning path has a title, summary, learning outcomes, level, estimated effort, controlled topics, access, ordered Sections and Lessons, publication state and learner progress.
- `Learn` is a distinct destination, not a Group category. A Learning path may link to one relevant Group or Discussion while retaining its ordered educational structure.
- Authors may create and edit Learning paths they own. Publishers and Administrators may publish, unpublish and archive them. Published content can retain a separate unpublished draft until republished.
- Lessons reuse semantic authoring blocks and support text, headings, images with alt text, files, links and trusted video previews. Arbitrary fonts, custom HTML and direct video hosting remain excluded.
- A member may add or remove a Learning path from `My learning plan`, resume the next incomplete Lesson and mark Lessons complete. Progress is private to the member unless they explicitly share it.
- Learning path discovery supports topic, level and estimated-effort filters plus `Newest`. `My learning plan` prioritizes `Continue learning`, progress and completed paths rather than discovery filters.
- Each Learning path may have one overall Discussion. Lesson-level Discussions are added only when there is a teaching need, avoiding an empty Discussion for every Lesson.
- A path has `Draft`, `Published`, `Published with draft changes`, `Unpublished` and `Archived` states consistent with article publishing behavior.
- Scheduled cohorts, drip release, certificates, assessments, payments, prerequisites, live teaching and instructor analytics remain deferred.

### Learning acceptance criteria

- Author can draft and reorder Sections and Lessons in a Learning path they own but cannot publish it; Publisher or Administrator can publish after preview.
- A published Learning path remains readable while authorized staff prepare unpublished changes; members see only the latest published version.
- Eligible member can add a path to `My learning plan`, resume at the next incomplete Lesson, mark completion and remove the path without deleting the published content.
- View Only may read an openly accessible path but cannot enroll, record progress or post in linked Discussions.
- Reordering content never loses Lesson content or member completion records; progress remains tied to stable Lesson identifiers.
- Mobile members can find, continue and complete a Lesson without navigating the authoring hierarchy or encountering horizontal scrolling.

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
- Keep established source-owned pages and their build validation in the existing Cloud Build release path.
- Treat Studio-authored article slugs as the bounded dynamic exception: Cloud Run renders a validated immutable Firestore publication snapshot when no static route owns the path.

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
| Publish API | Small Cloud Run service | Verifies identity and role, rejects stale or conflicting work, sanitizes content, creates an immutable release and returns the live URL. |
| Article release | Firestore publication snapshot plus Cloud Run renderer | Makes a reviewed article live immediately without repository or deployment credentials in the authoring path. |
| Platform release | Existing Cloud Build pipeline | Keeps application-code changes on the reviewed deployment mechanism. |
| Observability | Structured audit log plus Cloud Logging | Records actor, action, revision, release and failure reason. |

The canonical draft is versioned editor data in Firestore. Publishing validates and sanitizes that cloud draft, creates an immutable release snapshot, updates the canonical public-slug pointer and records the release ID, live URL and audit event. Platform source remains Git-controlled, but article publication never writes the repository.

### Instant-publication boundary

Only Studio-authored article slugs use the on-demand renderer. Static files win route resolution, reserved slugs cannot be claimed, HTML is sanitized on the server, published snapshots are immutable, and unpublish removes only the public pointer while preserving the draft and release history.

## Security and operational requirements

- No OAuth credentials, repository tokens or service-account keys in browser code.
- Verify identity tokens and role authorization on every mutation.
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
| Technical spike | Auth, one cloud editor document, preview and one non-production runtime publish path | 2-3 days |
| Blog MVP | Single owner, content list, cloud autosave, preview, draft/revisions, media, SEO basics, immutable runtime publish and status | 10-15 focused engineering days |
| Production hardening | Conflict handling, rollback, audit, accessibility, failure recovery, security review and operational runbook | 5-10 days |
| Books phase | Hierarchy, reordering, manuscript navigation, cross-chapter tools and export pipeline | 4-8 additional weeks |

These are planning ranges, not commitments. The largest uncertainty is preserving preview/public rendering parity while keeping the author HTML allowlist narrow and safe.

## Preparation checklist

- Keep at least two recovery Administrators. New verified accounts default to Commenter; test request, cancellation, re-request, approval, decline and self-escalation denial for every editorial role.
- Keep the initial Studio at the protected `/studio` route; reassess a separate application only if scale or release independence requires it.
- Create development and production Google/Firebase projects.
- Register OAuth origins and redirect URLs.
- Define the editor block schema and server-side publication allowlist.
- Build publication fixtures from the existing long-form article, including links, headings, quotes, tables and Unicode text.
- Define media limits, image variants, alt-text policy and retention.
- Define preview-link lifetime and sharing policy.
- Specify release-state UI and failure messages.
- Create acceptance tests for autosave, concurrent edits, preview parity, publish, failed publish and rollback.
- Document backup, recovery and emergency credential rotation.

## MVP cut line

The first production release is complete when the authorized owner can sign in with Google, open an article, edit it in structured rich text, see `Saved`, preview the desktop/mobile public rendering, save a revision as a cloud draft, publish through final review, receive an immediately readable live URL and recover the unchanged cloud draft after a simulated publish failure.

Books, collaborative editing, Community Groups and Discussions, Events, Learning paths, newsletters, paid membership, arbitrary HTML and site-wide theme editing remain outside that first cut.
