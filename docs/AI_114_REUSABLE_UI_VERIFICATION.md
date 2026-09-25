# AI-114 reusable publishing verification

Issue: https://linear.app/ai-spanda/issue/AI-114/reuse-complete-publishing-and-user-management-on-aispanda

Branch: `codex/ai-114-reusable-publishing`

## Candidate

Package: `0.2.0-rc.8`

SHA-256: `8bf5f58342541b68dffc78557c2980cb1743d9bb8ace0934384c25eca0a139d2`

The installer and archive are pinned in `vendor/blog/lock.json`. This is a local integration candidate, not a production certification.

## Repeatable browser check

After installing locked host/runtime dependencies and building both applications, run:

```sh
node scripts/test-blog-browser.mjs
```

The consumer wrapper starts Firebase Auth and Firestore emulators and the actual AIspanda HTTP server. It imports the browser journey from the installed package instead of maintaining a second copy. The journey uses disposable emulator users/data, rejects live credential files, and cleans up its fixtures.

Verified on 2026-09-25:

- Administrator creates a collection using the shared management page.
- User invitations expose all three editorial roles; the mobile users page fits its viewport.
- Author saves all three layout choices, previews on mobile, reloads the session and submits explicitly. Author publishing and administrator navigation are unavailable.
- Administrator reviews without editing the author's content and publishes the submitted revision.
- The anonymous article contains the exact submitted title, prose and selected layout.
- Existing host routes and the integrated editorial routes return HTTP 200.

The rebuilt consumer passed this journey and 51 host tests. The current installed package passed 119 runtime tests and its build. The preceding candidate passed 33 editorial emulator tests and 10 media tests; those results are historical evidence, not reruns on the new archive. These are distinct layers, not a count of acceptance criteria.

## UI consistency policy

Keep shared editorial behavior, states and accessibility expectations in the package. Keep branding, host navigation and deployment configuration in the consumer. Screenshots support review; passing screenshots alone do not prove publishing or authorization.

Storybook remains optional for isolated states of actual shared components. Do not duplicate Astro markup in a separate component framework merely to create stories. Playwright exercises the installed UI; backend/emulator tests remain the authority for server-side permissions.

## Remaining hosted evidence

- Authenticated staging Google sign-in and session navigation.
- Real staging Storage upload and published image delivery.
- Container build and governed staging deployment of the candidate.
- Staging publication gate using an explicitly designated staging draft/account.

No AI-114 production deployment is claimed. The staging gate requires `STAGING_STORAGE_STATE`, `STAGING_DRAFT_ID`, `STAGING_EXPECTED_SLUG`, `TARGET_PROJECT` and `PLAYWRIGHT_BASE_URL`. Browser storage state is secret and must remain untracked. Production content must not be used as a disposable fixture.

The current browser journey also verifies that restored sessions remain on account settings and both My articles and bare studio open the list rather than an editor. Five navigation tests cover explicit sign-in to home, callback ordering, cancellation and stale account callbacks. Hosted Google OAuth is still unproven.

## Historical article comments repair — 2026-09-25

Candidate package `9b1496b7aaacda32f3772b5f9806034f5bb4942978dc408c33bf8c7873e73347` repairs native-host routing of retired Comments bundles. The comments compatibility response initializes the current public configuration before importing the current entry. Shared modules retain exports; existing host bundles retain precedence over compatibility fallback. Publication bytes are not rewritten.

Evidence on this exact archive: build PASS; 122 runtime tests PASS; 3 adapter routing tests PASS; actual consumer Playwright/emulator journey PASS, including historical HTML without the modern configuration global, restored-account composer, anonymous sign-in, loaded comment count and byte-identical stored publication. Test-only local-network permission is scoped to the disposable loopback origin; external requests remain blocked.

The prior staging build was deployed, and real Google sign-in/navigation was manually verified after a staging-only Firebase Auth read permission correction. This candidate still requires staging deployment and exact-page verification. The full hosted publication automation remains blocked by missing dedicated `STAGING_STORAGE_STATE` and fixture settings; no production promotion is claimed.
