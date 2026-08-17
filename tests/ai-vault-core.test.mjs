import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decodeVaultKey,
  decryptVaultConnection,
  encryptVaultConnection,
  generateWithProvider,
  refreshProviderConnection,
  validateVaultConnection,
} from '../server/ai-vault-core.mjs';

const key = decodeVaultKey(Buffer.alloc(32, 7).toString('base64'));

test('encrypts account credentials with authenticated uid/provider context', () => {
  const connection = validateVaultConnection('huggingface', {
    secret: { accessToken: 'hf_example_token_long_enough', refreshToken: 'refresh-example-long-enough' },
    status: { connected: true },
  });
  const encrypted = encryptVaultConnection(connection, key, 'user-a:huggingface:v1');
  assert.equal(encrypted.algorithm, 'aes-256-gcm');
  assert.doesNotMatch(JSON.stringify(encrypted), /hf_example_token/);
  const decrypted = decryptVaultConnection(encrypted, key, 'user-a:huggingface:v1');
  assert.equal(decrypted.secret.accessToken, connection.secret.accessToken);
  assert.equal(decrypted.secret.refreshToken, connection.secret.refreshToken);
  assert.equal(decrypted.status.connected, true);
  assert.throws(() => decryptVaultConnection(encrypted, key, 'user-b:huggingface:v1'));
  assert.throws(() => decryptVaultConnection(encrypted, key, 'user-a:openrouter:v1'));
});

test('rejects malformed provider credentials and Cloudflare routing metadata', () => {
  assert.throws(() => validateVaultConnection('openrouter', {
    secret: { accessToken: 'not-an-openrouter-key' }, status: { connected: true },
  }), /Invalid OpenRouter/);
  assert.throws(() => validateVaultConnection('cloudflare', {
    secret: { accessToken: 'cloudflare-token-long-enough' },
    configuration: { accountId: 'short', gatewayId: 'gateway', route: 'route' },
    status: { connected: true },
  }), /Invalid Cloudflare account/);
});

test('refreshes provider status without returning the stored credential', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return Response.json({ data: { label: 'Personal key', usage: 1, limit: 10, limit_remaining: 9 } });
  };
  const original = validateVaultConnection('openrouter', {
    secret: { accessToken: 'sk-or-example-token-long-enough' }, status: { connected: true },
  });
  const refreshed = await refreshProviderConnection('openrouter', original, fetchImpl);
  assert.equal(refreshed.status.label, 'Personal key');
  assert.equal(refreshed.status.limitRemaining, 9);
  assert.equal(calls[0].init.headers.Authorization, 'Bearer sk-or-example-token-long-enough');
  assert.doesNotMatch(JSON.stringify(refreshed.status), /sk-or-/);
});

test('relays generation and returns normalized output without exposing the credential', async () => {
  const fetchImpl = async (url, init = {}) => {
    if (String(url).endsWith('/key')) return Response.json({ data: { label: 'Personal key' } });
    const body = JSON.parse(init.body);
    assert.equal(init.headers.Authorization, 'Bearer sk-or-example-token-long-enough');
    assert.equal(body.messages[0].role, 'system');
    return Response.json({
      id: 'request-1', model: 'example/model', provider: 'Example',
      choices: [{ message: { content: 'Relayed response.' } }],
      usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13, cost: 0.001 },
    });
  };
  const connection = validateVaultConnection('openrouter', {
    secret: { accessToken: 'sk-or-example-token-long-enough' }, status: { connected: true },
  });
  const { result } = await generateWithProvider('openrouter', connection, {
    instruction: 'Answer directly.', content: 'Hello', routePreference: 'economy',
  }, fetchImpl);
  assert.equal(result.text, 'Relayed response.');
  assert.equal(result.usage.cost, 0.001);
  assert.doesNotMatch(JSON.stringify(result), /sk-or-/);
});
