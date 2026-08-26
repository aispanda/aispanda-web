# AIspanda Web

Official website for AIspanda: practical AI insights, engineering principles, reusable assets, live demonstrations, and consulting expertise.

## Local development

```powershell
pnpm install
pnpm dev
```

The public site is generated into `dist/` with `pnpm build`. It is designed as a static-first Astro site and packaged for Google Cloud Run through the included container files. Studio-authored articles are the bounded exception: an authenticated Cloud Run API creates immutable Firestore publication snapshots, and Cloud Run renders those snapshots at their canonical public slugs without an article-specific build or deployment.

Platform releases for the publishing seam use the governed [AI-89 staging release gate](docs/AI_89_STAGING_RELEASE.md): one build-only Cloud Build, runtime-injected environment configuration, isolated staging publication, immutable evidence, then promotion of the exact tested digest. Infrastructure and production promotion retain separate approvals.

The live Data Model Explorer is a generated public artifact from reusable asset RA-001. Rebuild RA-001 with Vite base `/labs/data-model-explorer/`, then refresh it with the registered `scripts/sync-data-model-explorer.ps1` command described in the Automation Router.

Read `docs/DOCUMENTATION_ROUTER.md` before changing strategy, content, design, or architecture. Read `docs/AUTOMATION_ROUTER.md` before running or changing scripts.
