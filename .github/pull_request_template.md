## Delivery scope

- Linear issue: `AI-<id>`
- Builder: `@<name>`
- Intended user-visible outcome:
- Explicit non-goals:

## Builder verification

List the exact commands, CI run(s), preview URL(s), and expected/actual result. State any remaining uncertainty; do not describe an unrun check as passed.

| Check | Result | Evidence |
| --- | --- | --- |
| Unit / contract checks | PASS / FAIL / UNPROVEN | Command or CI link |
| Production build | PASS / FAIL / UNPROVEN | Command or CI link |
| Browser / preview evidence, if applicable | PASS / FAIL / UNPROVEN | URL, command, or CI link |

## Assertion-integrity declaration

- [ ] I did not use `test.only`, `test.skip`, `test.fixme`, or a conditional test bypass to conceal a failure.
- [ ] Any focused, skipped, or `fixme` test in this change has a specific rationale, a linked follow-up issue, and an explicit reviewer decision.
- [ ] I retained or strengthened existing assertions; I did not weaken an assertion merely to obtain a green result.

> Focused tests and unexplained `skip`/`fixme` use are not permitted repair paths. This template documents the policy; CI enforcement remains the existing Playwright `forbidOnly` guard.

## Independent verification receipt

A verifier distinct from the builder must complete this section. The verifier must not repair and approve the same change.

- Verifier: `@<name>`
- Review date:
- Scope compared: `main...HEAD`
- Evidence reviewed:
- Material out-of-scope finding, if any:

| Applicable criterion | PASS / FAIL / UNPROVEN | Evidence or reason |
| --- | --- | --- |
| Scope integrity |  |  |
| Assertion integrity |  |  |
| Required verification evidence |  |  |
| Product / delivery boundary |  |  |

**Verifier decision:** `PASS` / `AMEND` / `DEFER`
