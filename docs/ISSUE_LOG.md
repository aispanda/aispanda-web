# Issue log

This log records defects whose cause or resolution should survive the immediate implementation session. It must not contain credentials, OAuth codes, personal evidence or provider response bodies.

## 2026-08-17 — Hugging Face OAuth callback rejected after successful consent

- Symptom: Hugging Face returned an authorization code, but AI Spanda showed “The Hugging Face connection expired or could not be verified. Start again.”
- Root cause: the registered OAuth redirect URI was `/account`. That page intentionally forwarded the callback parameters to the dedicated `/ai` experience, but the connector then compared the processing page `/ai` with the registered redirect path `/account` and rejected the valid same-origin handoff.
- Fix: retain exact origin, state, code, PKCE verifier and 30-minute age checks; permit only the registered redirect path or the explicit same-origin `/ai` handoff as the callback-processing location. Continue exchanging the code with the original registered `/account` redirect URI.
- Regression proof: `tests/ai-connections.test.ts` covers the `/account` to `/ai` handoff. The focused AI suite passed before production revision `aispanda-web-00018-rnx` was deployed.
- Reusable promotion: RA-006 `authenticated-content-application-pattern.md` and issue WEB-051.

## 2026-08-17 — AI connections disappeared on sign-out

- Symptom: a verified provider connection survived navigation in one tab but disappeared after sign-out, tab closure or another-device sign-in.
- Root cause: provider credentials and active-router selection intentionally used `sessionStorage`; `account-settings.ts` also called `disconnectAll()` during application sign-out.
- Product decision: an activated connection belongs to the signed-in account and persists until explicit Disconnect, subject to provider expiry/revocation or a security-required reconnect. Application sign-out must not silently revoke that separate provider decision.
- Implementation: authenticated Cloud Run API, Firebase ID-token verification, AES-256-GCM encrypted records in Firestore bound to `uid:provider:v1`, Secret Manager key injection, server-side provider relay, bounded request validation, and an explicit disconnect endpoint. Sign-out now clears browser material only.
- Infrastructure safety finding: the predefined `roles/datastore.user` role is database-wide and cannot be limited to one collection. The preferred design is a separate delete-protected `ai-vault` database with a conditional IAM grant. For the current low-usage phase, the owner explicitly chose the existing default database to retain its free quota and accepted the dedicated runtime identity's database-wide server access. This must be revisited before wider onboarding or material credential volume.
- Verification required before closure: production secret/IAM bootstrap, deployed status/generation/disconnect tests, sign-out/sign-in restoration, second-browser restoration, expired/revoked-provider behavior, and confirmation that browser storage, Firestore client reads, logs and generated output contain no credential.
