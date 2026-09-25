# AI-114 authenticated release test

`pnpm test:staging` imports the reusable package's hosted journey. The consumer only
provides its approved staging profile and `config/blog-staging-test.json` fixture.
The release wrapper checks these inputs before cloud work. Nothing in this test
targets production.

For the initial Google sign-in, or after the test session expires:

```powershell
New-Item -ItemType Directory -Force .staging-auth | Out-Null
pnpm exec playwright open --channel=chrome --save-storage=.staging-auth/publisher.json https://aispanda-web-staging-kbtqetae3q-ue.a.run.app/account
```

Use an existing staging Administrator/Publisher who owns the fixture. Finish sign-in
and close that isolated window to save its session. `.staging-auth/` is ignored;
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
