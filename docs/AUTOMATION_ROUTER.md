# Automation Router

Read before running or changing automation. Every maintained script must be registered here. Scripts may validate or build; they must not commit, push, deploy, spend money, change DNS/IAM, or handle secrets without explicit authority.

| Automation | Purpose | Inputs → outputs | Boundary | Verification |
|---|---|---|---|---|
| `scripts/validate-site-profile.mjs` | Fail clearly when required site-governance fields are absent | `site-profile.json` → pass/fail | Read-only; no external calls | `pnpm validate:profile` |
| `scripts/validate-content-boundary.mjs` | Block source or generated output containing prohibited source-project/third-party names | Repository or explicit build directory → pass/fail | Reads text-like project files; ignores dependencies and Git internals | `pnpm validate:content`; also runs after production build |
| `scripts/sync-data-model-explorer.ps1` | Copy a verified public Data Model Explorer build into the site | Explicit source build → `public/labs/data-model-explorer/` | Generated public files only; source asset remains canonical | Script verifies `index.html`, fixed destination and subpath base |
| `scripts/sync-supportzero-case-workspace.ps1` | Copy the verified fictional SupportZero list workspace into the site | Explicit curated source build → `public/support-workspace/` | Static public projection only; no database, runtime API, source map, identity, UUID or local path | Script verifies `index.html`, relative asset paths, fixed destination and public boundary patterns |
| `pnpm build` | Validate profile and generate the static public site | Source/pages/profile → `dist/` | No deployment | Build must pass cleanly |
| `Dockerfile` + `nginx.conf` | Package generated static site for Cloud Run | Repository → port-8080 container | Does not create registry, IAM, service or deployment | Local container smoke test before release |
| Central Deployment Automation asset | Preflight, typed approval, Cloud Build, verification and handback | Project deployment profile → authorized Cloud Run release | Resolve through the owner's reusable-asset inventory; never run without the exact documented gate | Central toolkit tests plus project dry run |
