# Handoff — prevent stale deployment reports

| Field | Value |
|---|---|
| From | Codex |
| To | Cursor |
| Date | 2026-08-17 |
| Handoff ID/version | AISPANDA-DEPLOY-RECONCILE@1 |
| Execution mode | IMPLEMENT_BOUNDED |
| Execution authorization | NOT_GRANTED initially |
| Decision owner | Rajeev Kasat |
| Handback destination | This file, section 10 |

> If execution mode or approval is missing or contradictory, default to `REVIEW_ONLY` and report the conflict.

## 1. Outcome

Strengthen RA-002 Deployment Automation so its final handover cannot report an older commit, Cloud Run revision, traffic assignment, image, test count or superseded issue diagnosis after concurrent agent work.

## 2. Canonical source map

| Source | Owns | Required read |
|---|---|---|
| `C:\Personal\Reusable-ai-assets\Deployment Automation\ASSET.md` | RA-002 boundary and manifest | yes |
| `C:\Personal\Reusable-ai-assets\Deployment Automation\deploy.sh` | Deployment controller and generated handover | yes |
| `C:\Personal\Reusable-ai-assets\Deployment Automation\README.md` | Operating procedure | yes |
| `C:\Personal\Reusable-ai-assets\Deployment Automation\DEPLOY_PROJECT_PROMPT.md` | Agent reporting contract | yes |
| `C:\Personal\Reusable-ai-assets\Deployment Automation\ISSUES_AND_RESOLUTIONS.md` | Reusable deployment lessons | yes |
| `C:\Personal\Reusable-ai-assets\Deployment Automation\test.sh` | Isolated controller tests | yes |
| `docs/ISSUE_LOG.md` | Current project defect status | yes |
| `docs/HANDOFF_CLOUDFLARE_OAUTH_WIP.md` | Obsolete Cloudflare diagnosis requiring a superseded notice | yes |

## 3. Observed current state

- **Verified state:** AI Spanda HEAD and `origin/main` are `94dfc5a05680914e149cd291311a8764ffff90a9` (`Route Cloudflare through account vault relay`). Cloud Run serves revision `aispanda-web-00021-gr9` at 100% from that SHA-tagged image. The current focused AI suite passes 27/27.
- **Verified Cloudflare status:** `docs/ISSUE_LOG.md` records accepted scopes `aig.run` and `ai.read`, relay-only transport, Authenticated Gateway off, and a real local HTTP 200 through the vault relay. Production lifecycle proof and cleanup remain open.
- **Unverified claims:** Production connect → generate → sign out → sign in → Disconnect; deprecated fallback repair; cleanup completion.
- **Existing changes:** Working tree was clean before this handoff file. A prior attempted patch to RA-002 failed verification and changed no reusable-asset files.
- **Known blocker:** User stated `HANDOFF_CLOUDFLARE_RELAY.md` supersedes the WIP handoff, but no such file exists in current HEAD. `docs/ISSUE_LOG.md` is the existing canonical owner; do not create a duplicate status document without explicit approval.

## 4. Authority envelope

- **Allowed reads:** AI Spanda repository; `C:\Personal\Reusable-ai-assets\REUSABLE_ASSET_INVENTORY.md`; RA-002 and RA-003 packages.
- **Allowed writes:** Only `C:\Personal\Reusable-ai-assets\Deployment Automation\deploy.sh`, `test.sh`, `README.md`, `DEPLOY_PROJECT_PROMPT.md`, `ISSUES_AND_RESOLUTIONS.md`, and `C:\Personal\AIspanda\docs\HANDOFF_CLOUDFLARE_OAUTH_WIP.md`.
- **Allowed commands/tools:** Targeted file inspection; patch edits; Git Bash `bash -n deploy.sh` and `bash test.sh`; project read-only Git inspection.
- **Allowed external systems:** None.
- **External side effects:** None.
- **Delegation/parallelism:** Forbidden.
- **Security-sensitive:** Yes. Do not inspect, print, rotate or revoke credentials/tokens.
- **Forbidden:** Editing product code; committing; pushing; deploying; deleting Cloud Run revisions/repos/domains/tokens; changing Cloudflare/Firebase/GCP configuration; destructive Git operations.
- **Mock/stub policy:** Existing RA-002 isolated stubs are allowed only inside `test.sh`; no mock counts as live proof.
- **Status-document authority:** Only the obsolete handoff file listed above; `docs/ISSUE_LOG.md` is read-only.

## 5. Output contract (not execution authority)

- **Produce:** A minimal RA-002 improvement with a final reconciliation verdict and regression test; replace the obsolete Cloudflare handoff content with a short superseded pointer to the canonical issue-log entry.
- **Location/format:** Existing files only; no new reusable asset or competing project status document.
- **Do not produce:** Branch strategy implementation, product changes, cleanup, deployment, duplicate Cloudflare handoff, or broad refactor.
- **Completion language:** `VERIFIED` only if all acceptance checks pass; otherwise `CHANGED_UNVERIFIED` or `BLOCKED`.

## 6. Budget envelope

- **Turns/time/tool calls:** One bounded implementation pass; stop after one repair cycle if tests fail for a new reason.
- **Parallel agents:** None.
- **Paid spend:** Zero.
- **Verification:** One `bash -n deploy.sh`, one full RA-002 `bash test.sh`, and one final diff review.
- **Expansion rule:** Stop and request approval before changing configuration schema or creating a new status document.

## 7. Acceptance proof

| Requirement | Proof | Pass condition |
|---|---|---|
| Final report uses current Git/live state | Controller test with newer remote commit or changed live revision | Handover prints `REPORT RECONCILE: STALE` and exits non-zero |
| Stable release remains reportable | Existing standalone verify fixture | Handover prints `REPORT RECONCILE: PASS` |
| No memory-based release facts | README and deploy prompt inspection | Requires latest block, current test command and canonical issue log; forbids copied earlier values |
| Reusable lesson retained | `ISSUES_AND_RESOLUTIONS.md` | One new unique issue row records cause, resolution and prevention |
| Obsolete Cloudflare pointer cannot mislead | Project handoff inspection | File clearly says superseded and links to the 2026-08-17 Cloudflare entry in `ISSUE_LOG.md` |
| No regression | `bash -n deploy.sh`; `bash test.sh` | Both exit 0; all tests pass |

## 8. Stop conditions and rollback

- **Stop if:** Allowed files contain overlapping unowned changes, config schema expansion becomes necessary, tests require network/cloud access, or a requested canonical replacement document is absent and duplication would result.
- **On stop:** Report `BLOCKED`; do not fabricate a value or create mock success.
- **Rollback:** Revert only Cursor's patch hunks in the allowed files; never reset the repository or reusable-asset library.

## 9. Receiver receipt

Before consequential execution, reply with only:

```text
RECEIPT AISPANDA-DEPLOY-RECONCILE@1
MODE:
OUTPUT:
ALLOWED WRITES/ACTIONS:
FORBIDDEN:
BUDGET:
BLOCKERS/CONFLICTS:
REQUIRED VERIFICATION:
READY TO PROCEED: yes/no
EXECUTION APPROVAL REQUIRED: yes
```

Stop after the receipt. Execution starts only after Rajeev replies:

```text
AUTHORIZE AISPANDA-DEPLOY-RECONCILE@1
```

## 10. Handback

- **Outcome:** `VERIFIED` for `AISPANDA-DEPLOY-RECONCILE@1`. Cursor completed the bounded RA-002 reconcile pass after `AUTHORIZE AISPANDA-DEPLOY-RECONCILE@1`.
- **Files/actions:**
  - `C:\Personal\Reusable-ai-assets\Deployment Automation\deploy.sh` — handover now re-fetches Git and re-queries live revision/traffic/digest; prints `REPORT RECONCILE: PASS` or `STALE`; `STALE` exits non-zero.
  - `C:\Personal\Reusable-ai-assets\Deployment Automation\test.sh` — existing standalone `--verify` requires `REPORT RECONCILE: PASS`; new fixture with a newer origin commit requires `REPORT RECONCILE: STALE`.
  - `README.md`, `DEPLOY_PROJECT_PROMPT.md` — forbid memory-copied SHA/revision/traffic/image/test counts/issue diagnoses; require latest handover block, current test command, canonical issue log.
  - `ISSUES_AND_RESOLUTIONS.md` — added unique `DA-030`.
  - `C:\Personal\AIspanda\docs\HANDOFF_CLOUDFLARE_OAUTH_WIP.md` — replaced with a superseded pointer to the 2026-08-17 Cloudflare entry in `docs/ISSUE_LOG.md`.
- **Verification actually run:** `bash -n deploy.sh` exit 0; `bash test.sh` `ALL TESTS PASSED`, including `configured standalone verification` and `stale remote commit rejected`. No Google Cloud calls (isolated stubs).
- **Not verified / still open (out of this envelope):** production connect → generate → sign out → sign in → Disconnect; deprecated fallback repair; cleanup of temporary Cloud Run revision/source-deploy repo/redirect/Firebase domain/diagnostic tokens. `HANDOFF_CLOUDFLARE_RELAY.md` still does not exist; `docs/ISSUE_LOG.md` remains canonical. AI Spanda `nginx.conf` is still a local modification and was not touched.
- **Material drift for the next agent:** the RA-002 git working tree already contained uncommitted content vs its HEAD (DA-021–DA-029, source-publication prompt text, post-build clean-tree test). This pass added reconcile/`DA-030` on top of that on-disk state. Do not treat DA-021–DA-029 as this ticket’s authorship. Do not commit or push unless Rajeev explicitly asks.
- **Next action and authority:** No further RA-002 work in this envelope. Grok Bot may take later product/deploy/cleanup work from this section plus `docs/ISSUE_LOG.md`. Do not revive the obsolete Cloudflare WIP diagnosis. Do not copy earlier release facts from this chat; re-read Git, live Cloud Run, current tests, and the issue log.
