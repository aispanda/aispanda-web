# AI-114 authenticated release test

`pnpm test:staging` imports the reusable package's hosted journey. The consumer only
provides its approved staging profile and `config/blog-staging-test.json` fixture.
The release wrapper checks these inputs before cloud work. Nothing in this test
targets production.

For the initial Google sign-in, or after the test session expires:

```powershell
node scripts/capture-staging-session.mjs
```

Use an existing staging Administrator/Publisher who owns the fixture. Finish sign-in
in the newly opened Chrome window and leave it open. The helper verifies the role,
saves only the staging-origin session, and closes itself. `.staging-auth/` is ignored;
never commit, display or share its credential files. `STAGING_STORAGE_STATE` may
point to another explicitly captured test session. This app uses Firebase local
persistence. An IndexedDB-based consumer must include IndexedDB when capturing.

```powershell
node scripts/staging-test-preflight.mjs
pnpm test:staging
```

The shared test verifies account role, list-first navigation, actual image upload,
draft save/reload, preview content, publication response and persistent release ID.
An independent anonymous context verifies public text, image decoding and mobile
width. Reports attach safe outcome identifiers and the installed package hash.
Screenshots/traces are retained only for failures and remain private local evidence.

The existing `staging-collection-journey-20260925` article and its collection are
disposable retained staging fixtures. The test reuses its marked image and may
append immutable staging releases; it does not delete audit history. Neither this
article nor its QA collection belongs in production. A read-only production check
found no collection registry. `config/blog-collections.json` therefore supplies
only the two approved editorial collections as initial migration seeds. Existing
registries remain authoritative and are never overwritten; staging data is not
copied. The emulator journey checks both conditions before release.

RA-002 remains the staging/prod deployment owner through `scripts/staged-release.sh`.
The approved production promotion uses the exact digest after this command passes;
production verification remains read-only. The older AI-89 fixture instructions are
superseded by this AI-114 profile for the current release.

## User-selected in-app browser

Set `STAGING_BROWSER_MODE=inapp` when the user explicitly chooses the signed-in
in-app browser instead of an isolated capture. The consumer's verification hook
runs `scripts/inapp-release-verification.mjs`; RA-002 remains unchanged. This is
agent-operated browser verification, not an unattended Playwright run.

Each hook invocation creates a fresh expiring challenge bound to the controller's
commit, image digest, staging target, fixture and installed package. The agent
performs the real role/list/editor/image/save/reload/preview/publication/mobile
checks through the browser skill, records only the observed safe results, and
answers that challenge. Existing unchanged fixture media/releases may be verified
again without republishing solely to generate another audit event. The verifier
independently checks staging configuration and anonymous published content/image.
It rejects missing, stale or mismatched observations. Public checks corroborate
publication; they do not independently prove authenticated editing or preview.

Never extract the in-app browser's session or credentials. Never manufacture a
success file or a deployment receipt. RA-002 revalidates the exact staged revision
before and after the hook, then writes its own immutable receipt. Every later hook
invocation requires fresh browser observations; previous PASS files are not reused.
The isolated Playwright path remains the default for unattended reruns.

### Image storage prerequisite regression — 25 September 2026

A hosted image upload returned 502 because the Firebase web-app config named a bucket that had never been provisioned. A config name is not proof of a working storage resource. The reusable preflight now verifies actual bucket existence/owning project, uniform bucket-level access, public access prevention, and effective runtime object create/get/delete permissions before release. The consumer uses the packaged check for both staging and production. Missing, foreign, public, denied and indeterminate configurations fail closed. Provisioning remains environment-specific.

Both configured buckets were provisioned privately in US-EAST1 with bucket-scoped objectUser access for their respective runtime identities. Retrying the user's selected image in the designated staging fixture succeeded; the image decoded and persisted after Save checkpoint and reload. It remains an unpublished draft change until the publisher publishes. Hosted candidate publication is still required by the release verification.
