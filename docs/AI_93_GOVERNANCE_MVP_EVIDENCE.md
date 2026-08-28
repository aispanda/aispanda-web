# AI-93 Governance MVP Evidence

Linear issue: [AI-93 — Enforce governed Linear contracts and issue-linked branches before AI implementation](https://linear.app/ai-spanda/issue/AI-93/enforce-governed-linear-contracts-and-issue-linked-branches-before-ai)

Validated on `2026-08-28` against local n8n Community Edition `2.36.7` and the inactive Cloud development copy.

## Objective

Before an agent begins the governed implementation path, answer one question using current evidence:

> Is the saved Linear story complete, governance-compliant, and associated with the actual current Git branch?

The PowerShell launcher observes Git directly. The authenticated localhost n8n workflow fetches the saved Linear issue through read-only OAuth and applies deterministic contract, governance, repository, and branch rules. Only an exact `PASS` lets the launcher return success.

## Runtime arrangement

- Permanent endpoint: `http://127.0.0.1:5678/webhook/authorize-build-start`
- Workflow: `authorize_build_start` (`ai93buildstart01`)
- Repository export: `workflows/authorize-build-start.local.json`
- Authentication: `X-Governance-Key` Header Auth; the key is stored outside Git using Windows CurrentUser encryption under `%LOCALAPPDATA%\AIspanda\governance\`.
- Linear authority: read-only OAuth; every request fetches the current saved issue.
- Git authority: `scripts/Start-GovernedTask.ps1` independently reads the worktree root, origin, branch, and HEAD.
- Cloud n8n remains a development/reference copy and is not the live build-start authority.

The repository export is intentionally inactive and contains no credentials, tokens, pinned live data, or execution history. Local activation and credential binding are installation state, not source-controlled data.

## Live evidence

### Negative branch boundary

Request: real `AI-93` with deliberately wrong branch `codex/notai-93x`.

Observed result:

- HTTP status: `502`
- Outcome: `FAIL`
- Violations: `BRANCH_TASK_MISMATCH`, followed by independent `BRANCH_BOUNDARY_INVALID` attestation
- `candidate_build_allowed: false`
- `build_allowed: false`
- Linear data was returned live and the contract received a valid SHA-256 hash.

This proves that valid story content and a valid caller key cannot compensate for the wrong Git branch.

### Positive governed branch

Launcher: `scripts/Start-GovernedTask.ps1`

Observed result:

- `approved: true`
- `code: PASS`
- Task: `AI-93`
- Repository: `github.com/aispanda/aispanda-web`
- Branch: `codex/ai-93-n8n-delivery-controller`
- HEAD: `d1bd88182eabea9378bb75452ecd6e5d814a1e1d`
- Permitted action: `local_build_start`
- Contract hash: `94ddb639a48ec2331412ea11773d3af28662eb08574b455f4e095e3e40d6827e`
- Linear revision: `2026-08-28T07:49:54.506Z`
- Policy version: `governance-policy-v1.1`
- Contract version: `story-contract-v2`

No build command or external write was executed by this proof.

### Inactive Cloud parity check

Cloud workflow `get_task_contract` (`3873bmInftBGbgEo`) remained inactive and unpublished. It is a visual, test-only copy and cannot authorize a build.

The parity update:

- replaced the legacy FNV test fingerprint with n8n's native SHA-256 Crypto node;
- configured the Linear HTTP node to return the response body without retaining complete response headers;
- connected validation → SHA-256 calculation → hash finalization → outcome classification; and
- added fail-closed handling for an invalid SHA-256 result.

Manual Cloud execution `29` exercised four synthetic fixtures:

- validation `PASS` → HTTP `200`, no violations
- `BLOCKED` → HTTP `409`, `DECISION_BLOCKER`
- `REPLAN` → HTTP `422`, `INVALID_DEPLOYMENT`
- `FAIL` → HTTP `502`, `LINEAR_QUERY_FAILED`

Every Cloud result returned `build_allowed: false` and `authorization_mode: cloud_test_only`. The canonical fixture produced SHA-256 `81cc26057b5c467cad9ceda65813b8486e9d67577eb64bcba09aee3187ef9627`; an independent local recomputation over the exact canonical hash input matched it byte-for-byte.

The synthetic run did not call Linear. The separate localhost evidence above proves the real read-only Linear lookup, exact-branch `PASS`, and mismatched-branch denial used for build-start authorization.

### Live generalization check — AI-95

AI-95 was used as the first real story outside AI-93 to exercise the gate progressively without starting implementation.

1. Inactive Cloud execution `30` read the real AI-95 story while it was in `Backlog`. The contract was complete, but the diagnostic returned `BLOCKED` / HTTP `409` with `STATUS_NOT_BUILDABLE` and `build_allowed: false`.
2. The local launcher was invoked for AI-95 from the existing AI-93 worktree. It returned `BRANCH_TASK_MISMATCH`. The localhost n8n execution count remained `6`, proving the launcher rejected the mismatch before network authorization.
3. After explicit human authorization, AI-95 moved to `Ready`. Its contract content, priority, and labels were not changed.
4. A clean worktree was created from `origin/main` on branch `codex/ai-95-harden-governed-ai-delivery-path` at HEAD `d1bd88182eabea9378bb75452ecd6e5d814a1e1d`. No AI-93 uncommitted changes were copied.
5. Inactive Cloud execution `31` returned a validation `PASS` / HTTP `200` with no violations, but retained `build_allowed: false` and `authorization_mode: cloud_test_only`.
6. The authenticated localhost launcher returned an exact `PASS` for AI-95, the observed repository, branch and HEAD, `governance-policy-v1.1`, `story-contract-v2`, Linear revision `2026-08-28T14:01:33.294Z`, and contract hash `7ef74d4d3ce28e6f6b89a755f5dcadf6a1b084c3e41b42fb3c8ea24624e3fad0`. The localhost execution count increased exactly once, from `6` to `7`.
7. Moving AI-95 to `In Progress` produced a new Linear revision and contract hash. A fresh localhost resumption check returned an exact `PASS` for revision `2026-08-28T14:27:42.166Z` and contract hash `e5ef01567553528291dcfe93b06f3148bd215ac7e36d05053ef18e0c13e3831e`; the execution count increased exactly once again, from `7` to `8`. AI-93 does not persist decisions or prevent reuse of an earlier response; AI-95 owns stale-decision, replay and concurrency enforcement.

This result authorizes only `local_build_start` for the recorded AI-95 state. The test did not run a build, modify the AI-95 worktree, commit, push, create a PR, or deploy.

## Automated verification

Command:

```powershell
pnpm test:governance
```

Result: `78 passed, 0 failed`.

Coverage includes canonical and malformed stories, legacy headings, acceptance-evidence rules, Deployment syntax, decision blockers, status and version checks, missing runtime fields, default/detached/wrong-task branches, repository mismatches, native SHA-256 parity, unavailable dependencies, authentication failure, redirects, timeouts, and exact launcher response matching.

The independent tester confirmed that the combined negative and positive live results complete the AI-93 MVP authorization proof.

## Reproduction

Negative path:

```powershell
& '.\scripts\Test-GovernanceBranchMismatch.ps1'
```

Positive path from the governed worktree:

```powershell
& '.\scripts\Start-GovernedTask.ps1' `
  -TaskId 'AI-93' `
  -N8nUri 'http://127.0.0.1:5678/webhook/authorize-build-start'
```

Both commands resolve the local key without printing it.

## Authority boundary

The `PASS` result authorizes only the caller to begin the governed local implementation path for the exact task, repository, branch, HEAD, versions, and current Linear revision.

It does **not** authorize commit, push, PR creation, merge, secrets, IAM, spending, staging, deployment, or production changes. It also does not stop an unmanaged shell process at the operating-system level; enforcement outside the governed launcher is post-MVP hardening.
