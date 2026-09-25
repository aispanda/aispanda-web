#!/usr/bin/env bash
set -euo pipefail

[[ -n "${REUSABLE_AI_ASSETS_ROOT:-}" ]] || {
  echo "ERROR: REUSABLE_AI_ASSETS_ROOT must point to the reusable-assets checkout." >&2
  exit 1
}

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTROLLER="$REUSABLE_AI_ASSETS_ROOT/Deployment Automation/staged_release.sh"
[[ -f "$CONTROLLER" ]] || {
  echo "ERROR: RA-002 staged release controller not found under REUSABLE_AI_ASSETS_ROOT." >&2
  exit 1
}

export STAGED_RELEASE_CONFIG="${STAGED_RELEASE_CONFIG:-$REPO_ROOT/.staged-release.config}"
# Detect absent test sessions/fixtures before cloud checks or an expensive build.
# Hosted identity, role and publication checks still run against the candidate.
case "${1:-}" in
  --check|--stage|--verify-stage|--promote)
    case "${STAGING_BROWSER_MODE:-isolated}" in
      isolated) node "$REPO_ROOT/scripts/staging-test-preflight.mjs" ;;
      inapp) node "$REPO_ROOT/scripts/inapp-release-verification.mjs" --check ;;
      *) echo "ERROR: Unsupported staging browser mode." >&2; exit 1 ;;
    esac ;;
esac
exec bash "$CONTROLLER" "$@"
