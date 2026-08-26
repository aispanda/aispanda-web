# AI-89 staging release gate

AI-89 uses RA-002's central staged-release controller through `scripts/staged-release.sh`. The project owns only its ignored profile, authenticated browser fixture and evidence receipts. AI-92 must be merged into the configured reusable-assets checkout before the AI-89 staging gate can run; during coordinated branch testing, point `REUSABLE_AI_ASSETS_ROOT` at the AI-92 worktree. `inter-agent-gateway`, AI-73 and the existing Agent Staging project are outside this scope.

## Required separate bootstrap approval

Before the first staging run, explicitly approve and create or designate two non-production projects: one dedicated release/build project for Cloud Build, logs, a dedicated source-staging bucket and Artifact Registry, and one dedicated web-publishing staging project for Cloud Run, Firebase and test data. Bootstrap billing and required APIs (including Firebase Management and Policy Troubleshooter), the default staging Firestore database, `aispanda-web-staging`, isolated build/runtime identities, repository-scoped Artifact Registry access, source-bucket-scoped object read access and environment-specific Secret Manager bindings. Configure the staging and production Cloud Run services with their own `RUNTIME_*` public client values outside Git. The authoritative Firebase Management API configuration must match each runtime profile, and Policy Troubleshooter must deny cross-environment access on the exact Cloud Run, Firestore, Secret Manager, service-account and project resources.

Deploy the bound Firestore rules to each environment as a separately governed prerequisite. The release controller verifies prerequisites but does not create infrastructure, change IAM, deploy rules or write secrets.

The existing coupled `cloudbuild.yaml` production path remains a rollout blocker until its trigger is explicitly approved for retirement or replacement. The governed path uses `cloudbuild.image.yaml`; one Build ID produces one digest, staging tests that digest, and production promotion reuses it without Cloud Build.

## Governed article fixture

Seed staging with a reviewed one-time copy of draft `4b87639e-5e30-4302-a1e3-4bdf116c8a37` and preserve the expected slug `consulting-rewired`. This is a fixture transfer, not ongoing staging access to production data. Keep any export and authenticated publisher state outside Git.

Authorize the stable staging Cloud Run service origin for Firebase/Google sign-in. Capture an ignored Playwright storage-state file on that same stable origin, including Firebase Auth IndexedDB for an authorized staging Publisher. Set these local variables without committing their values:

```text
STAGING_STORAGE_STATE=<ignored authenticated state path>
STAGING_DRAFT_ID=4b87639e-5e30-4302-a1e3-4bdf116c8a37
STAGING_EXPECTED_SLUG=consulting-rewired
```

The controller first smokes the exact tagged Cloud Run revision, then routes the isolated staging service's stable origin to that exact revision. The staging test publishes the draft through Studio on the stable authenticated origin, confirms the injected Firebase project is staging, reads the public article there, and the controller revalidates the exact digest/revision afterward. It intentionally leaves the article published in staging as release evidence.

## Operator sequence

```bash
REUSABLE_AI_ASSETS_ROOT=/path/to/Reusable-ai-assets bash scripts/staged-release.sh --check
REUSABLE_AI_ASSETS_ROOT=/path/to/Reusable-ai-assets bash scripts/staged-release.sh --stage --dry-run
REUSABLE_AI_ASSETS_ROOT=/path/to/Reusable-ai-assets bash scripts/staged-release.sh --stage
REUSABLE_AI_ASSETS_ROOT=/path/to/Reusable-ai-assets bash scripts/staged-release.sh --verify-stage
REUSABLE_AI_ASSETS_ROOT=/path/to/Reusable-ai-assets bash scripts/staged-release.sh --promote --dry-run
```

Production remains untouched until the exact `DEPLOY` gate is separately approved.
