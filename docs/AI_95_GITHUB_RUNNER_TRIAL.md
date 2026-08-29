# AI-95 GitHub runner trial

This non-required pull request proves that the protected workflow on `main`
can call the local, baseline-aware n8n gate for the exact pull-request head.

The workflow must not check out pull-request code. It must pass only when the
current Linear contract and a matching local build-start baseline both match the
same repository, branch, and commit. A denial, unavailable laptop, unavailable
n8n service, or response mismatch must fail the check.

This trial neither makes the check required nor authorizes a merge, deployment,
or any action beyond reporting the governance result for its exact commit.
