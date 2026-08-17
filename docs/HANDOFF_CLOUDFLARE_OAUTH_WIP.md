# Cloudflare AI Gateway OAuth — WIP handoff

Status: WIP. The rest of the AI router playground remains usable; Cloudflare is not connected.

## Verified behavior

- AI Spanda starts Cloudflare Authorization Code + PKCE with S256.
- The requested permission is `account.ai_gateway_run`.
- The callback returns `error=invalid_scope`; Cloudflare reports that the OAuth client is not allowed to request that scope.
- The UI now shows an actionable message telling the user to add the AI Gateway Run permission in Cloudflare.
- No Cloudflare credential was stored or exposed by the app.

## Next controlled investigation

1. In the Cloudflare OAuth client for AI Spanda, edit the permission scopes and select the account-level **AI Gateway → Run** permission. Do not add unrelated permissions.
2. Confirm the client remains configured for Authorization Code + PKCE with S256 and the verified `aispanda.com` redirect/domain settings.
3. Retry from `http://localhost:4321/ai` and confirm the consent screen shows the requested permission.
4. After authorization, verify the configured account, gateway `aispanda`, route `editorial`, and a small test request. Confirm the connection badge becomes connected.

## Scope guardrails

- Do not revert to pasted Cloudflare API tokens.
- Do not broaden OAuth permissions to account edit/admin access.
- Do not change OpenRouter, Hugging Face, Merge, or shared playground behavior while diagnosing this OAuth configuration issue.
- If the permission is unavailable in the Cloudflare client editor, verify the exact current Cloudflare OAuth scope identifier from Cloudflare’s API/docs before changing code.

## Relevant files

- `src/scripts/ai-connections.ts`
- `src/pages/auth/cloudflare/callback.astro`
- `src/pages/ai/index.astro`
- `tests/ai-connections.test.ts`
