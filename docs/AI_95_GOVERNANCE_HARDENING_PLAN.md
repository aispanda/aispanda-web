# AI-95 Governance Hardening Plan

Linear issue: [AI-95 — Harden the governed AI delivery path after AI-93 MVP validation](https://linear.app/ai-spanda/issue/AI-95/harden-the-governed-ai-delivery-path-after-ai-93-mvp-validation)

Status: inactive localhost implementation and merge-check evidence verified; live GitHub enforcement, publication, and merge remain unapproved and unproven. This document does not grant commit, push, merge, secret, or deployment authority.

## Objective

Make one rule difficult to bypass accidentally:

> At build start and at every protected pull-request check, confirm from freshly read evidence that the saved Linear story is valid and that the requested repository, issue-linked branch, and commit belong together.

AI-93 proved the deterministic story and branch decision. AI-95 connects that decision to repository and CI controls without turning n8n into a planner, builder, tester, or deployment engine.

## Final workflow topology

The caller experiences one sequence, while n8n keeps its responsibilities in small, testable workflows:

```text
Agent or governed launcher
  -> AI-93 authorize_build_start (the caller-facing parent)
       -> read and validate the current Linear story contract
       -> validate the actual repository, branch, and HEAD
       -> AI-95 Governance Baseline Store (record or safely reuse the approved snapshot)
  -> exact PASS or a fail-closed outcome
```

Keeping the baseline store as a subworkflow is not a second user journey. It is the parent workflow's durable memory: it remembers the exact approved story version and branch facts so a later merge check can detect a changed story or replayed decision. Combining every rule and database action on one canvas would make the one sequence harder to review, test, restore, and upgrade.

Three locations hold the final artifacts:

- **Git:** versioned, sanitized workflow exports, validator code, fixtures, and tests. This is the reviewable source of truth for configuration; no credentials, tokens, or execution records enter Git.
- **n8n Cloud:** inactive development mirrors of the final AI-93 parent/validator and AI-95 baseline workflows. They remain available for inspection, safe fixture tests, and export/restore comparison, but cannot grant build authority.
- **Local n8n Community Edition:** the live pilot copies, local Data Table, and read-only Linear credential. It is the only build-start authority because it participates in the local launcher flow and can validate the current Git facts.

The existing Cloud `get_task_contract` workflow remains a read-only validator and diagnostic reference. The new Cloud `AI-95 Governance Baseline Store` remains its redacted baseline component. Neither replaces the local `authorize_build_start` parent, and neither should be deleted until the connected local sequence and its Cloud mirror pass parity and recovery tests.

## MVP decision

Use two fresh checks of the same localhost n8n authority plus one minimal remembered baseline:

1. The local launcher checks before an agent begins governed implementation.
2. n8n records only the Linear revision and contract hash approved at build start.
3. A governance-only GitHub self-hosted runner checks again before merge and compares the current story with that baseline.

The CI runner runs on the same Windows host as localhost n8n. It can therefore call `127.0.0.1` without exposing n8n publicly. The CI check fetches the current Linear issue every time; it does not trust a previously returned decision. If the Linear revision or contract hash differs from the approved build-start baseline, the result is `REPLAN` even when the changed story is otherwise valid.

This is the smallest design that detects a Linear story changed after work began. A fresh read without a baseline can prove only current validity, not that the story remained unchanged. A signed receipt alone has the same limitation unless CI can compare it with current Linear.

### Freshness boundary

The MVP result is current **when the protected GitHub check runs**. GitHub commit statuses do not expire automatically: if Linear changes after a successful check and the pull-request commit does not change, the old green status remains attached to that commit until the workflow runs again. GitHub's native merge queue can force a new `merge_group` check near merge time, but it is not available for this private repository without GitHub Enterprise Cloud and is not assumed by this pilot.

Therefore AI-95 must not claim hard merge-time freshness yet. The pilot requires an explicit rerun after any story change and immediately before merge, and records this as an operating control rather than a technically unbypassable one. Automatic invalidation or a protected merge-time recheck belongs in the follow-up governance design after the MVP is proven; it must not be simulated by a custom scheduler in AI-95.

## End-to-end operating flow

### Before implementation

1. The user gives an agent a Linear issue link or task ID.
2. Repository instructions tell the agent to run `scripts/Start-GovernedTask.ps1` before governed edits.
3. The launcher observes the actual repository, branch, and HEAD directly from Git.
4. Authenticated localhost n8n reads the current Linear story using read-only OAuth.
5. n8n returns `PASS`, `REPLAN`, `BLOCKED`, or `FAIL`.
6. For an exact `PASS`, n8n stores one redacted active baseline for the task, repository, branch, Linear revision, contract hash, policy/contract versions, starting HEAD, operation ID, and time. It stores no story text or secret.
7. Only a successfully stored `PASS` for `local_build_start` lets the governed agent workflow continue.

Example: AI-95 on `codex/ai-95-harden-governed-ai-delivery-path` may pass. AI-95 on an AI-93 branch fails before implementation starts.

### Before merge

1. A pull request triggers `.github/workflows/ai-governance.yml` through `pull_request_target`, so the workflow definition comes from protected `main`.
2. The self-hosted job does not check out or execute pull-request code.
3. The job rejects pull requests from fork repositories. The MVP supports branches in this repository only.
4. The protected job reads exactly `pull_request.head.repo.full_name`, `pull_request.head.ref`, and `pull_request.head.sha` from the GitHub event. It does not use `GITHUB_SHA`, which identifies the synthetic pull-request merge commit for this trigger.
5. The job extracts exactly one task ID from the anchored branch form `codex/<team>-<number>-<description>`. Missing, ambiguous, or unsafe branch text fails closed.
6. The job passes these facts as inert environment data, never as interpolated PowerShell or shell source.
7. The job calls localhost n8n with those immutable event values and action `pr_merge_gate`.
8. n8n re-reads the current Linear story and verifies that its identifier and generated Linear branch name contain the same task ID before validating the contract, policy version, status, blockers, repository, branch, commit shape, and requested action.
9. n8n requires exactly one matching active build-start baseline. A missing or ambiguous baseline fails; a changed Linear revision or contract hash returns `REPLAN`.
10. The protected workflow posts commit-status context `AI governance` directly on `pull_request.head.sha` using the job's short-lived `GITHUB_TOKEN` with only `statuses: write`. The status description is redacted and links to the workflow run.
11. Branch protection requires `AI governance`. Merge remains blocked unless the latest status on the exact candidate SHA is `success`.
12. The operator reruns `AI governance` after any Linear change and immediately before merge. This closes the practical MVP workflow but is not equivalent to automatic status invalidation; that limitation remains visible until a later control replaces it.

Example: if Linear changes after implementation starts, the next merge check reads the new revision, compares it with the stored baseline, and returns `REPLAN`. The agent must review the change and run build-start authorization again before CI can pass. If no new check runs, GitHub cannot detect that Linear changed; that is the explicit MVP limitation above.

## Trust boundaries

- Linear owns the current story, properties, status, labels, and revision.
- Git owns the actual local repository, branch, and HEAD before work begins.
- GitHub owns the pull-request repository, branch, and candidate SHA at merge time.
- The MVP rejects fork pull requests and accepts exactly one task ID from the protected branch-name grammar.
- Local n8n owns the deterministic decision and retains read-only Linear credentials.
- A minimal n8n Data Table owns the redacted build-start baseline. Zero or multiple active matches fail closed.
- The GitHub job receives only the n8n caller key. It receives no Linear credential.
- Pull-request code is untrusted and is never executed by the governance-only self-hosted job.
- The required workflow definition and validator are loaded from protected `main`, not from the candidate branch.
- The organization runner group is restricted to this repository and exactly `aispanda/aispanda-web/.github/workflows/ai-governance.yml@refs/heads/main`.
- The runner uses a dedicated Windows service account and work directory with no permission to user worktrees, n8n data, or the user's DPAPI secret store.
- The protected job has `contents: read` and `statuses: write`; every other GitHub permission is disabled. It can report a result but cannot change repository content.
- A result for one action cannot authorize another action.

## Deterministic decision input

Each live check provides:

- `task_id`
- `repository`
- `branch_name`
- `head_sha`
- `caller`
- `operation_id`
- `permitted_action`
- `governance_policy_version`
- `story_contract_version`

n8n adds the current Linear issue ID, `updatedAt`, contract hash, status, labels, and validation findings.

The response contains no bearer authorization that a later process can reuse. It is evidence of that one live request only.

The minimal baseline record contains:

- operation ID and deterministic request fingerprint;
- task, repository, branch, and starting HEAD;
- Linear revision and contract hash;
- policy version, contract version, and exact action;
- outcome, created time, expiry, and active state.

The supported launcher serializes local build-start requests. Repeating the same operation and fingerprint returns the original baseline. Reusing an operation ID with different facts fails. No or multiple active baseline matches fail closed, so a storage race cannot authorize CI.

A fresh authorization for the same task, repository, and branch uses a fail-closed rollover:

1. Store the newly validated baseline as `pending`.
2. Mark the previous `active` baseline `retired`.
3. Mark the new baseline `active`.

If the approved revision and hash have not changed, return the existing active baseline instead of rolling it over. If rollover stops midway, CI can see only the old mismatched baseline, no active baseline, or the new baseline—never two valid baselines. A retry revalidates current Linear before completing a pending rollover.

## Outcomes

- `PASS`: current evidence satisfies every rule for the requested action.
- `REPLAN`: the story or contract changed, is malformed, or no longer matches the governed work. Refresh the plan and validate again.
- `BLOCKED`: a human decision, approval, status, or blocker label prevents progress.
- `FAIL`: authentication, dependency, runtime, repository, branch, commit, or controller evidence is invalid or unavailable.

All non-PASS outcomes fail closed. Technical retries are bounded; a retry always performs a fresh validation and cannot convert an old decision into authority.

## First implementation slice

1. Extend the shared deterministic validator with exact permitted-action rules for `local_build_start` and `pr_merge_gate`.
2. Require a full Git commit SHA, exact governed repository, issue-linked non-default branch, caller, and operation ID.
3. Add the minimal Data Table baseline, safe pending → retired → active rollover, and exact duplicate/conflict behavior; store no story text, credential, or broad audit payload.
4. Keep the current live Linear revision and contract hash in the redacted response.
5. Reject unsupported actions, malformed operation IDs, missing inputs, baseline conflicts, changed Linear revisions/hashes, and mismatched repository/branch/commit facts.
6. Add fixtures and automated tests before changing the live n8n workflow.
7. Export an inactive, credential-free, Community-compatible workflow and prove import parity locally.
8. Prove that a GitHub Free organization runner group can be restricted to the exact protected workflow before registering the runner.
9. Add the protected governance-only self-hosted workflow and explicit head-SHA commit status, but do not make it a required status until its security and failure tests pass.
10. Enable the required status only after explicit human approval.

## Required tests

- Current AI-95 story, exact repository, issue-linked branch, valid commit, and supported action pass.
- The CI job uses the pull request's head repository, head ref, and head SHA; a different `GITHUB_SHA` cannot replace the candidate SHA.
- Forks, missing or ambiguous task IDs, branch metacharacters, and branches that disagree with the Linear issue/generated branch identity fail closed.
- Pull-request attempts to modify the governance workflow or helper script cannot change the running protected-base check.
- Every GitHub event value reaches PowerShell as inert data rather than executable interpolation.
- Missing or malformed task, repository, branch, commit, caller, operation ID, or versions fail.
- Default, detached, wrong-task, changed, or unrelated branches fail.
- Unsupported or wrong-purpose actions fail; `local_build_start` cannot satisfy `pr_merge_gate`.
- A changed Linear revision or contract returns `REPLAN` after fresh validation.
- Decision-blocker labels and disallowed statuses return `BLOCKED`.
- Invalid authentication, unavailable Linear, unavailable n8n, or controller errors return `FAIL` with sanitized external details.
- Repeated identical requests return the same classification from current inputs; changed inputs are re-evaluated.
- Reused operation IDs with different facts fail; missing or multiple active baseline records fail closed.
- Concurrent checks cannot make a failing request pass or let an ambiguous baseline authorize CI.
- After a changed story is reauthorized, the old baseline cannot authorize, the new revision/hash can, and CI during rollover sees only old-mismatch, no-active, or new-active—never a false `PASS`.
- The self-hosted CI job executes no candidate code, performs no checkout, and cannot write repository content.
- Only the exact protected workflow on `refs/heads/main` can target the dedicated runner group.
- The runner service account cannot read worktrees, n8n storage, or the user's DPAPI store.
- The workflow posts `AI governance` on the exact PR head SHA with only `statuses: write`; a base or synthetic merge SHA cannot receive the authoritative result.
- The check fails closed while the laptop, runner, or n8n is unavailable.
- Cloud export/import parity and rollback are verified.

## Recovery and rollback

- Preserve the AI-93 workflow export as the known-good build-start validator.
- Develop AI-95 changes in a separate inactive workflow/export until tests pass.
- If the AI-95 CI gate misbehaves, disable the new required check and restore the AI-93 validator; do not bypass repository protections with an allow result.
- Restore credentials through n8n configuration only. Secrets and live credential bindings never enter Git.
- Re-run the complete negative and positive suite after restore.

## Verified localhost parity evidence

The inactive localhost Community Edition workflow `AI-95 Governance Baseline Store` was tested through the inactive `AI-95 Local Baseline Parity Harness (Inactive)` against a dedicated `ai95_governance_baselines` Data Table. No Linear, GitHub, credential, or live build-authority workflow was changed by these synthetic tests.

- Initialize: a valid first request returned `PASS`, `BASELINE_INITIALIZE`, and `storage_verified:true`; one active baseline was stored.
- Duplicate: the identical operation returned `PASS`, `BASELINE_DUPLICATE`, and reused the same stored baseline without increasing the row count.
- Conflict: reusing the operation ID with changed commit, Linear revision, and contract hash returned `FAIL`, `OPERATION_ID_CONFLICT`, and did not change storage.
- Rollover: submitting the changed facts under a new operation ID returned `PASS`, `BASELINE_ROLLOVER`, retired the previous baseline, activated the replacement, and left exactly one current approval.
- Upstream rejection: otherwise valid facts with `build_allowed:false` returned `FAIL`, `UPSTREAM_BUILD_NOT_ALLOWED`, and wrote no row.

This proves Community Edition parity for the MVP storage lifecycle. It does not grant build authority and does not authorize publishing or connecting the child to the live parent until the integrated fail-closed tests pass.

### Integrated inactive PR-merge evidence — 28 August 2026

The merge-capable parent and child were imported as separate unpublished localhost candidates:

- parent: `ai95buildcandidate1` — `AI-95 authorize_build_start Integration Candidate (Inactive)`;
- child: `ai95baselinecandidate1` — `AI-95 Governance Baseline — Build Start and Merge Candidate (Inactive)`.

The existing OAuth2 credential was bound locally and remains outside Git. An initial import bound that generic OAuth2 credential under the Linear-specific credential type; execution `48` failed safely with `LINEAR_DEPENDENCY_ERROR`. Correcting only the inactive node's credential type restored the read-only Linear call.

- Execution `49`: real AI-95, exact branch and current baseline returned HTTP `200`, `PASS`, `BASELINE_CURRENT`, `storage_verified:true`, and `localhost_merge_verified`.
- Execution `51`: the identical compare-only request returned the same `PASS` without writing a row.
- Execution `53`: a controlled one-second baseline revision mismatch returned HTTP `422`, `REPLAN`, and `BASELINE_STALE`; the original revision was restored exactly.
- Execution `55`: one disposable duplicate active row returned HTTP `502`, `FAIL`, and `BASELINE_AMBIGUOUS`; that row was then deleted.
- Execution `57`: a deliberately missing child dependency returned the sanitized `BASELINE_DEPENDENCY_ERROR` violation and no internal workflow, credential, SQLite, or Data Table detail.
- Execution `58`: after restoring the correct child binding, the same real AI-95 facts returned `PASS` again.

The Data Table contained three pre-existing rows before testing and the same three rows afterward. Its full-row SHA-256 fingerprint was `4fe3ef2f931e5fcc7835cceb0209b88cf7d45eee80bd7c4d0364fe91c3383584` before the duplicate check, after the duplicate check, and after every controlled fault was restored. AI-95 ended with exactly one active baseline. This proves that the `pr_merge_gate` path is compare-only and that all disposable mutations were removed.

`npm run test:governance --silent` completed with **129/129 passing tests** in approximately 33 seconds. The tests include generated-artifact drift checks, contract and baseline decisions, launcher failures, hostile inputs, exact GitHub head binding, retry behavior, strict PASS-response validation, and the merge candidate's read-only paths. The test HTTP servers now close deterministically, removing the earlier combined-suite hang.

The host's `pnpm` launcher still hangs before starting any package script and produces no output; the same registered `test:governance` script completes through npm/direct Node. This is a host package-manager shim limitation, not a governance-test failure, and is not being expanded into unrelated package-manager repair work in AI-95.

## Public-release boundary

[AI-97](https://linear.app/ai-spanda/issue/AI-97/experiment-console-001-publish-a-sanitized-public-governance) owns any sanitized public experiment console, public packaging, documentation, and public-repository decision. AI-95 proves the private MVP and keeps workflow exports credential-free, environment-neutral, and portable. AI-95 does not publish the governance service, live endpoints, credentials, story data, baseline rows, or private operating evidence.

## Explicitly deferred

The MVP does not add:

- a public n8n callback;
- a signed-receipt or two-commit attestation protocol;
- a general-purpose audit journal beyond the minimal build-start baseline;
- GitHub or Linear write credentials in agents;
- automatic planning, building, testing, committing, pushing, merging, or deployment;
- automatic revocation of a green GitHub status when Linear changes after the check, or a protected merge-time freshness mechanism;
- a database, queue, paid service, or custom cryptography framework.

These remain backlog candidates only if live evidence exposes a need that the simpler fresh-check design cannot meet.

## Stop conditions

Stop and record `NEEDS_TECHNICAL_INPUT` rather than weakening the gate if:

- GitHub cannot run the governance check from protected base-branch code without executing candidate content;
- the GitHub account cannot restrict the self-hosted runner group to the exact protected workflow;
- the workflow cannot post and require a redacted status on the exact pull-request head SHA;
- localhost n8n cannot receive trusted pull-request repository, branch, and commit facts;
- current Linear state cannot be read at decision time;
- an unavailable dependency can accidentally produce `PASS`; or
- tests show that one action's result can authorize another action.

## Completion evidence

AI-95 is not complete from an agent statement. Completion requires:

- versioned repository files and fixtures;
- automated negative and positive test results;
- a live local launcher result;
- a live governance-only CI result;
- Cloud/Community export-import parity and recovery evidence;
- independent tester review; and
- the merged GitHub revision linked from Linear.

Current state: repository implementation, deterministic tests, inactive localhost Community import, real Linear read, compare-only PASS, stale `REPLAN`, ambiguous `FAIL`, dependency failure, recovery, and no-write fingerprint evidence are complete. Live parent publication/cutover, protected runner registration, exact-source required check, immediately-before-merge rerun evidence, Cloud mirror parity/restore, commit/push/PR/merge, and the final Linear link remain `UNPROVEN` until explicitly authorized and performed.

## Control references

- [GitHub: manage access to self-hosted runners using groups](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/manage-access)
- [GitHub: securely use `pull_request_target`](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target)
- [GitHub: create a commit status for an exact SHA](https://docs.github.com/en/rest/commits/statuses)
- [GitHub: merge queue availability and `merge_group` checks](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)
