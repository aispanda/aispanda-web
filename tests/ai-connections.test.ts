import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AiActiveConnectionManager,
  AiConnectorRegistry,
  buildHuggingFaceAuthorizationUrl,
  buildOpenRouterAuthorizationUrl,
  classifyModelOwnership,
  createCloudflareAiGatewayConnector,
  createHuggingFaceConnector,
  createMergeGatewayConnector,
  createOpenRouterConnector,
  runRouterComparison,
  selectHuggingFacePlaygroundModel,
  type AiRouterConnector,
} from '../src/scripts/ai-connections.ts';

const createMemoryStore = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
};

test('builds the recommended OpenRouter S256 authorization URL', () => {
  const url = new URL(buildOpenRouterAuthorizationUrl('https://aispanda.com/studio?ai_provider=openrouter', 'challenge'));
  assert.equal(url.origin, 'https://openrouter.ai');
  assert.equal(url.pathname, '/auth');
  assert.equal(url.searchParams.get('callback_url'), 'https://aispanda.com/studio?ai_provider=openrouter');
  assert.equal(url.searchParams.get('code_challenge'), 'challenge');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
});

test('builds least-privilege Hugging Face OAuth with S256 PKCE', () => {
  const url = new URL(buildHuggingFaceAuthorizationUrl(
    'http://localhost:4321/account',
    'challenge',
    'state',
  ));
  assert.equal(url.origin, 'https://huggingface.co');
  assert.equal(url.pathname, '/oauth/authorize');
  assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost:4321/account');
  assert.equal(url.searchParams.get('scope'), 'inference-api');
  assert.equal(url.searchParams.get('state'), 'state');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
});

test('prefers a small non-reasoning Hugging Face model and cheapest provider route', () => {
  assert.equal(selectHuggingFacePlaygroundModel([
    'openai/gpt-oss-120b',
    'Qwen/Qwen2.5-7B-Instruct',
    'meta-llama/Llama-3.1-70B-Instruct',
  ]), 'Qwen/Qwen2.5-7B-Instruct:cheapest');
});

test('classifies model ownership conservatively for the comparison table', () => {
  assert.equal(classifyModelOwnership('Qwen/Qwen3-4B-Instruct-2507:cheapest'), 'Open-weight family');
  assert.equal(classifyModelOwnership('openai/gpt-4.1-mini'), 'Proprietary family');
  assert.equal(classifyModelOwnership('unknown/model'), 'Not determined');
});

test('registers connectors once and rejects duplicate router ids', () => {
  const connector = createOpenRouterConnector({
    fetchImpl: async () => new Response('{}'),
    cryptoImpl: globalThis.crypto,
    sessionStore: createMemoryStore(),
    navigate: () => undefined,
    siteUrl: 'https://aispanda.com',
  });
  const registry = new AiConnectorRegistry([connector]);
  assert.equal(registry.get('openrouter'), connector);
  assert.throws(() => registry.register(connector), /already registered/);
});

test('validates an existing key directly with OpenRouter and forgets it on disconnect', async () => {
  const requests: Array<{ url: string; authorization: string | null }> = [];
  const sessionStore = createMemoryStore();
  const connector = createOpenRouterConnector({
    fetchImpl: async (input, init) => {
      requests.push({
        url: String(input),
        authorization: new Headers(init?.headers).get('Authorization'),
      });
      return Response.json({ data: { label: 'AI Spanda', usage: 1.5, limit: 10, limit_remaining: 8.5 } });
    },
    cryptoImpl: globalThis.crypto,
    sessionStore,
    navigate: () => undefined,
    siteUrl: 'https://aispanda.com',
  });

  const status = await connector.connectWithApiKey?.('sk-or-v1-test-key-that-is-long-enough');
  assert.equal(status?.connected, true);
  assert.equal(status?.limitRemaining, 8.5);
  assert.deepEqual(requests, [{
    url: 'https://openrouter.ai/api/v1/key',
    authorization: 'Bearer sk-or-v1-test-key-that-is-long-enough',
  }]);

  const restoredConnector = createOpenRouterConnector({
    fetchImpl: async () => Response.json({ data: { label: 'AI Spanda', limit_remaining: 8.5 } }),
    cryptoImpl: globalThis.crypto,
    sessionStore,
    navigate: () => undefined,
    siteUrl: 'https://aispanda.com',
  });
  assert.equal(restoredConnector.status.connected, true);

  restoredConnector.disconnect();
  assert.deepEqual(restoredConnector.status, { connected: false });
  assert.equal(sessionStore.getItem('aispanda-ai-openrouter-session-v1'), null);
  await assert.rejects(restoredConnector.generate({ instruction: 'Summarize', content: 'Example' }), /Connect OpenRouter/);
});

test('disables hidden reasoning for a bounded economy OpenRouter request', async () => {
  const requestBodies: Array<Record<string, unknown>> = [];
  const connector = createOpenRouterConnector({
    fetchImpl: async (input, init) => {
      const url = String(input);
      if (url.endsWith('/key')) return Response.json({ data: { limit_remaining: 1 } });
      requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json({
        id: 'request-1',
        model: 'example/tiny-model',
        provider: 'Example Host',
        choices: [{ message: { content: 'Welcome curious minds learn together' } }],
        usage: { prompt_tokens: 7, completion_tokens: 5, total_tokens: 12, cost: 0.00012 },
      });
    },
    cryptoImpl: globalThis.crypto,
    sessionStore: createMemoryStore(),
    navigate: () => undefined,
    siteUrl: 'https://aispanda.com',
  });

  await connector.connectWithApiKey?.('sk-or-v1-test-key-that-is-long-enough');
  const result = await connector.generate({
    instruction: 'Return five words.',
    content: 'Go.',
    maxOutputTokens: 64,
    routePreference: 'economy',
  });

  assert.equal(result.text, 'Welcome curious minds learn together');
  assert.equal(result.requestedRoute, 'Auto · economy');
  assert.equal(result.provider, 'Example Host');
  assert.equal(result.usage?.cost, 0.00012);
  assert.equal(result.usage?.costUnit, 'USD');
  assert.deepEqual(requestBodies[0]?.reasoning, { effort: 'none', exclude: true });
});

test('normalizes a bounded Playground result without inventing unavailable metrics', async () => {
  const longResponse = 'x'.repeat(510);
  const connector = {
    descriptor: {
      id: 'example',
      label: 'Example Router',
      authentication: ['user-api-key'],
      transports: ['browser-direct'],
      capabilities: new Set(['text-generation']),
    },
    status: { connected: true },
    beginConnection: async () => undefined,
    completeConnectionCallback: async () => ({ handled: false, connected: true }),
    refreshStatus: async () => ({ connected: true }),
    generate: async () => ({
      text: longResponse,
      model: 'example/model',
      requestedRoute: 'Economy',
      provider: 'Example Provider',
      firstResponseMs: 18,
      fallbackStatus: 'Fallback available; use not reported',
      usage: { inputTokens: 11, outputTokens: 22, totalTokens: 33, cost: 0.0002, costUnit: 'USD', costSource: 'reported', reasoningTokens: 4 },
    }),
    disconnect: () => undefined,
  } as AiRouterConnector;
  const moments = [100, 142];

  const result = await runRouterComparison(connector, 'Explain routing.', () => moments.shift() ?? 142);

  assert.equal(result.success, true);
  assert.equal(result.actualModel, 'example/model');
  assert.equal(result.provider, 'Example Provider');
  assert.equal(result.totalLatencyMs, 42);
  assert.equal(result.firstResponseMs, 18);
  assert.equal(result.outputTokensPerSecond, 22 / 0.042);
  assert.equal(result.reasoningTokens, 4);
  assert.equal(result.fallbackStatus, 'Fallback available; use not reported');
  assert.equal(result.responseTruncated, true);
  assert.equal(result.responseText.length, 501);
  assert.equal(result.cost, 0.0002);
  assert.equal(result.cacheHit, undefined);
});

test('isolates a failed Playground router and keeps the error actionable', async () => {
  const connector = {
    descriptor: {
      id: 'failing',
      label: 'Failing Router',
      authentication: ['user-api-key'],
      transports: ['browser-direct'],
      capabilities: new Set(['text-generation']),
    },
    status: { connected: true },
    beginConnection: async () => undefined,
    completeConnectionCallback: async () => ({ handled: false, connected: true }),
    refreshStatus: async () => ({ connected: true }),
    generate: async () => { throw new Error('Provider allowance reached.'); },
    disconnect: () => undefined,
  } as AiRouterConnector;
  const moments = [10, 25];

  const result = await runRouterComparison(connector, 'Hello', () => moments.shift() ?? 25);

  assert.equal(result.success, false);
  assert.equal(result.error, 'Provider allowance reached.');
  assert.equal(result.totalLatencyMs, 15);
});

test('rejects Playground prompts outside the bounded input contract', async () => {
  const connector = { descriptor: { id: 'unused', label: 'Unused Router' } } as AiRouterConnector;
  await assert.rejects(runRouterComparison(connector, ' '), /Enter a short prompt/);
  await assert.rejects(runRouterComparison(connector, 'x'.repeat(301)), /within 300 characters/);
});

test('surfaces a route-level completion error returned with a successful response', async () => {
  const connector = createOpenRouterConnector({
    fetchImpl: async (input) => {
      if (String(input).endsWith('/key')) return Response.json({ data: { limit_remaining: 1 } });
      return Response.json({ choices: [{ finish_reason: 'error', error: { message: 'No eligible provider is available.' } }] });
    },
    cryptoImpl: globalThis.crypto,
    sessionStore: createMemoryStore(),
    navigate: () => undefined,
    siteUrl: 'https://aispanda.com',
  });

  await connector.connectWithApiKey?.('sk-or-v1-test-key-that-is-long-enough');
  await assert.rejects(
    connector.generate({ instruction: 'Return five words.', content: 'Go.' }),
    /No eligible provider is available/,
  );
});

test('completes PKCE and keeps the returned key only for the browser-tab session', async () => {
  const sessionStore = createMemoryStore();
  let authorizationUrl = '';
  const requestBodies: unknown[] = [];
  const connector = createOpenRouterConnector({
    fetchImpl: async (input, init) => {
      const url = String(input);
      if (url.endsWith('/auth/keys')) {
        requestBodies.push(JSON.parse(String(init?.body)));
        return Response.json({ key: 'sk-or-v1-oauth-key-that-is-long-enough' });
      }
      if (url.endsWith('/key')) return Response.json({ data: { label: 'OAuth key', limit_remaining: 4 } });
      return new Response('Not found', { status: 404 });
    },
    cryptoImpl: globalThis.crypto,
    sessionStore,
    navigate: (url) => { authorizationUrl = url; },
    siteUrl: 'https://aispanda.com',
  });

  await connector.beginConnection('https://aispanda.com/studio?draft=example');
  assert.match(new URL(authorizationUrl).searchParams.get('callback_url') ?? '', /ai_provider=openrouter/);
  const callback = new URL('https://aispanda.com/account?code=one-time-code');
  const result = await connector.completeConnectionCallback(callback.toString());

  assert.equal(result.connected, true);
  assert.equal(connector.status.label, 'OAuth key');
  assert.equal(sessionStore.getItem('aispanda-ai-openrouter-pkce-v1'), null);
  assert.match(sessionStore.getItem('aispanda-ai-openrouter-session-v1') ?? '', /sk-or-v1-oauth/);
  assert.equal(JSON.stringify(requestBodies).includes('sk-or-v1-oauth'), false);
  assert.match(JSON.stringify(requestBodies), /one-time-code/);
});

test('completes Hugging Face OAuth and validates Inference Providers access', async () => {
  const sessionStore = createMemoryStore();
  let authorizationUrl = '';
  const requests: Array<{ url: string; body?: string }> = [];
  const connector = createHuggingFaceConnector({
    fetchImpl: async (input, init) => {
      const url = String(input);
      requests.push({ url, body: init?.body?.toString() });
      if (url.endsWith('/oauth/token')) {
        return Response.json({ access_token: 'hf_oauth_test_token', expires_in: 3600, scope: 'inference-api' });
      }
      if (url.endsWith('/v1/models')) {
        return Response.json({ data: [{ id: 'openai/gpt-oss-120b:cheapest' }] });
      }
      return new Response('Not found', { status: 404 });
    },
    cryptoImpl: globalThis.crypto,
    sessionStore,
    navigate: (url) => { authorizationUrl = url; },
  });

  await connector.beginConnection('http://localhost:4321/account?section=ai');
  const authorization = new URL(authorizationUrl);
  const callback = new URL('http://localhost:4321/account');
  callback.searchParams.set('code', 'one-time-hf-code');
  callback.searchParams.set('state', authorization.searchParams.get('state') ?? '');
  const result = await connector.completeConnectionCallback(callback.toString());

  assert.equal(result.connected, true);
  assert.equal(connector.status.connected, true);
  assert.match(sessionStore.getItem('aispanda-ai-huggingface-session-v1') ?? '', /hf_oauth_test_token/);
  assert.equal(sessionStore.getItem('aispanda-ai-huggingface-pkce-v1'), null);
  assert.match(requests[0]?.body ?? '', /grant_type=authorization_code/);
  assert.match(requests[0]?.body ?? '', /code_verifier=/);
  assert.match(result.cleanUrl ?? '', /section=ai/);
});

test('reports a recoverable Hugging Face callback when same-tab verification state is missing', async () => {
  const connector = createHuggingFaceConnector({ sessionStore: createMemoryStore() });
  const result = await connector.completeConnectionCallback('http://localhost:4321/account?code=returned-code&state=returned-state');

  assert.equal(result.handled, true);
  assert.equal(result.connected, false);
  assert.match(result.error ?? '', /same tab/i);
  assert.match(result.cleanUrl ?? '', /section=ai/);
});

test('activating a router preserves other connected routers', async () => {
  const sessionStore = createMemoryStore();
  const fetchImpl = async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('openrouter.ai')) return Response.json({ data: { label: 'OpenRouter key' } });
    if (url.includes('huggingface.co')) return Response.json({ data: [{ id: 'openai/gpt-oss-120b:cheapest' }] });
    return new Response('Not found', { status: 404 });
  };
  const openRouter = createOpenRouterConnector({ fetchImpl, sessionStore, cryptoImpl: globalThis.crypto, navigate: () => undefined });
  const huggingFace = createHuggingFaceConnector({ fetchImpl, sessionStore });
  const registry = new AiConnectorRegistry([openRouter, huggingFace]);
  const manager = new AiActiveConnectionManager(registry, sessionStore);

  await openRouter.connectWithApiKey?.('sk-or-v1-test-key-that-is-long-enough');
  manager.activate('openrouter');
  assert.equal(manager.activeId, 'openrouter');

  await huggingFace.connectWithApiKey?.('hf_test_token_that_is_long_enough');
  manager.activate('huggingface');
  assert.equal(manager.activeId, 'huggingface');
  assert.equal(openRouter.status.connected, true);
  assert.match(sessionStore.getItem('aispanda-ai-openrouter-session-v1') ?? '', /sk-or-v1-test-key/);
});

test('connects Cloudflare with PKCE, keeps OAuth access in memory, and revokes it on disconnect', async () => {
  const sessionStore = createMemoryStore();
  let authorizationUrl = '';
  let routeRequests = 0;
  let revoked = false;
  const connector = createCloudflareAiGatewayConnector({
    sessionStore,
    cryptoImpl: globalThis.crypto,
    openWindow: () => ({
      close: () => undefined,
      location: { assign: (url) => { authorizationUrl = url; } },
    }),
    fetchImpl: async (input, init) => {
      const url = String(input);
      if (url === 'https://dash.cloudflare.com/oauth2/token') {
        const form = new URLSearchParams(String(init?.body));
        assert.equal(form.get('grant_type'), 'authorization_code');
        assert.equal(form.get('client_id'), '29693e35e11d3865e28facf20adfcb38');
        assert.equal(form.get('redirect_uri'), 'http://localhost:4321/auth/cloudflare/callback');
        assert.ok(form.get('code_verifier'));
        assert.equal(form.has('client_secret'), false);
        return Response.json({ access_token: 'temporary-cloudflare-oauth-access', expires_in: 3600 });
      }
      if (url === 'https://dash.cloudflare.com/oauth2/revoke') {
        const form = new URLSearchParams(String(init?.body));
        assert.equal(form.get('token'), 'temporary-cloudflare-oauth-access');
        revoked = true;
        return new Response(null, { status: 200 });
      }
      assert.equal(url, 'https://api.cloudflare.com/client/v4/accounts/0123456789abcdef0123456789abcdef/ai/v1/chat/completions');
      const headers = new Headers(init?.headers);
      assert.equal(headers.get('Authorization'), 'Bearer temporary-cloudflare-oauth-access');
      assert.equal(headers.get('cf-aig-gateway-id'), 'aispanda');
      const body = JSON.parse(String(init?.body)) as { model?: string; max_tokens?: number };
      assert.equal(body.model, 'dynamic/editorial');
      routeRequests += 1;
      return Response.json({
        model: 'provider/model-selected-by-route',
        choices: [{ message: { content: routeRequests === 1 ? 'OK' : 'Cloudflare route works.' } }],
      });
    },
  });
  await connector.connectWithConfiguration?.({
    accountId: '0123456789abcdef0123456789abcdef',
    gatewayId: 'aispanda',
    route: 'dynamic/editorial',
  });
  await connector.beginConnection('http://localhost:4321/auth/cloudflare/callback');
  const authorization = new URL(authorizationUrl);
  assert.equal(authorization.origin + authorization.pathname, 'https://dash.cloudflare.com/oauth2/auth');
  assert.equal(authorization.searchParams.get('response_type'), 'code');
  assert.equal(authorization.searchParams.get('scope'), 'account.ai_gateway_run');
  assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(authorization.searchParams.get('code_challenge'));
  const callback = new URL('http://localhost:4321/auth/cloudflare/callback');
  callback.searchParams.set('code', 'returned-authorization-code');
  callback.searchParams.set('state', authorization.searchParams.get('state') ?? '');
  const result = await connector.completeConnectionCallback(callback.toString());
  assert.equal(result.connected, true);
  assert.equal(connector.status.label, 'aispanda · dynamic/editorial');
  assert.equal(sessionStore.getItem('aispanda-ai-cloudflare-session-v1'), null);
  const generated = await connector.generate({ instruction: 'Be concise.', content: 'Test the route.' });
  assert.equal(generated.text, 'Cloudflare route works.');
  assert.equal(routeRequests, 2);
  connector.disconnect();
  await Promise.resolve();
  assert.equal(connector.status.connected, false);
  assert.equal(revoked, true);
});

test('rejects a mismatched Cloudflare OAuth state before exchanging a token', async () => {
  let tokenExchangeAttempted = false;
  const connector = createCloudflareAiGatewayConnector({
    cryptoImpl: globalThis.crypto,
    openWindow: () => ({ close: () => undefined, location: { assign: () => undefined } }),
    fetchImpl: async () => {
      tokenExchangeAttempted = true;
      return new Response(null, { status: 500 });
    },
  });
  await connector.connectWithConfiguration?.({
    accountId: '0123456789abcdef0123456789abcdef',
    gatewayId: 'aispanda',
    route: 'editorial',
  });
  await connector.beginConnection('http://localhost:4321/auth/cloudflare/callback');
  const callback = await connector.completeConnectionCallback('http://localhost:4321/auth/cloudflare/callback?code=returned&state=wrong');
  assert.equal(callback.connected, false);
  assert.match(callback.error ?? '', /invalid connection state/i);
  assert.equal(tokenExchangeAttempted, false);
});

test('connects Merge Gateway, uses default_routing, and removes its credential on disconnect', async () => {
  const sessionStore = createMemoryStore();
  let generated = false;
  const connector = createMergeGatewayConnector({
    sessionStore,
    fetchImpl: async (input, init) => {
      const url = String(input);
      assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer merge-project-key-that-is-long-enough');
      if (url.endsWith('/v1/models')) return Response.json({ data: [{ id: 'default_routing' }] });
      assert.equal(url, 'https://api-gateway.merge.dev/v1/openai/chat/completions');
      const body = JSON.parse(String(init?.body)) as { model?: string };
      assert.equal(body.model, 'default_routing');
      generated = true;
      return Response.json({
        id: 'merge-test',
        model: 'provider/model-selected-by-policy',
        choices: [{ message: { content: 'Merge route works.' } }],
        usage: { prompt_tokens: 5, completion_tokens: 4, total_tokens: 9, cost: 0.0001 },
      });
    },
  });

  const status = await connector.connectWithApiKey?.('merge-project-key-that-is-long-enough');
  assert.equal(status?.connected, true);
  assert.match(sessionStore.getItem('aispanda-ai-merge-session-v1') ?? '', /merge-project-key/);
  const result = await connector.generate({ instruction: 'Be concise.', content: 'Test Merge.' });
  assert.equal(generated, true);
  assert.equal(result.requestedModel, 'default_routing');
  assert.equal(result.text, 'Merge route works.');

  connector.disconnect();
  assert.equal(sessionStore.getItem('aispanda-ai-merge-session-v1'), null);
  await assert.rejects(() => connector.generate({ instruction: 'Test.', content: 'Again.' }), /Connect Merge Gateway/);
});

test('rejects an invalid Merge Gateway key without storing or exposing it', async () => {
  const sessionStore = createMemoryStore();
  const connector = createMergeGatewayConnector({
    sessionStore,
    fetchImpl: async () => Response.json({ error: 'invalid merge-project-secret-value' }, { status: 401 }),
  });
  await assert.rejects(
    () => connector.connectWithApiKey?.('invalid-merge-project-secret-value'),
    (error: Error) => {
      assert.match(error.message, /invalid or has been revoked/i);
      assert.doesNotMatch(error.message, /invalid-merge-project-secret-value/);
      return true;
    },
  );
  assert.equal(sessionStore.getItem('aispanda-ai-merge-session-v1'), null);
});

test('explains Merge Gateway project budget exhaustion', async () => {
  let requestCount = 0;
  const connector = createMergeGatewayConnector({
    sessionStore: createMemoryStore(),
    fetchImpl: async () => {
      requestCount += 1;
      if (requestCount === 1) return Response.json({ data: [] });
      return Response.json({ error: { code: 'budget_exceeded' } }, { status: 402 });
    },
  });
  await connector.connectWithApiKey?.('merge-project-key-that-is-long-enough');
  await assert.rejects(
    () => connector.generate({ instruction: 'Test.', content: 'Budget.' }),
    /Your Merge Gateway project budget has been reached/,
  );
});
