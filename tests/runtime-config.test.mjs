import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRuntimePublicConfig, injectRuntimePublicConfig, prepareServedText } from '../server/runtime-config.mjs';

const validEnvironment = (overrides = {}) => ({
  K_SERVICE: 'example-web-staging',
  GOOGLE_CLOUD_PROJECT: 'example-web-stage-123',
  RUNTIME_ENVIRONMENT: 'staging',
  RUNTIME_FIREBASE_API_KEY: 'public-api-key',
  RUNTIME_FIREBASE_AUTH_DOMAIN: 'example-web-stage-123.firebaseapp.com',
  RUNTIME_FIREBASE_PROJECT_ID: 'example-web-stage-123',
  RUNTIME_FIREBASE_STORAGE_BUCKET: 'example-web-stage-123.firebasestorage.app',
  RUNTIME_FIREBASE_MESSAGING_SENDER_ID: '123456789',
  RUNTIME_FIREBASE_APP_ID: '1:123456789:web:abcdef',
  RUNTIME_GOOGLE_CLIENT_ID: '123456789-example.apps.googleusercontent.com',
  ...overrides,
});

test('local static serving can use the build-time Firebase fallback', () => {
  assert.equal(buildRuntimePublicConfig({}), null);
});

test('a runtime profile fails closed when public configuration is incomplete', () => {
  assert.throws(
    () => buildRuntimePublicConfig({ K_SERVICE: 'example-web-staging', RUNTIME_ENVIRONMENT: 'staging' }),
    /Missing runtime public configuration/,
  );
});

test('managed runtime rejects a Firebase project mismatch', () => {
  assert.throws(
    () => buildRuntimePublicConfig(validEnvironment({ GOOGLE_CLOUD_PROJECT: 'different-project-123' })),
    /does not match GOOGLE_CLOUD_PROJECT/,
  );
});

test('HTML injection precedes client modules, is idempotent and script-safe', () => {
  const config = buildRuntimePublicConfig(validEnvironment({
    RUNTIME_GOOGLE_CLIENT_ID: '</script><script>bad()</script>',
  }));
  const html = '<html><head><script type="module" src="/client.js"></script></head><body></body></html>';
  const injected = injectRuntimePublicConfig(html, config);
  assert.ok(injected.indexOf('data-aispanda-runtime-config') < injected.indexOf('type="module"'));
  assert.equal(injected.includes('</script><script>bad()'), false);
  assert.match(injected, /\\u003c\/script>/);
  assert.equal(injectRuntimePublicConfig(injected, config), injected);
});

test('article text cannot suppress runtime configuration injection', () => {
  const config = buildRuntimePublicConfig(validEnvironment());
  const html = '<html><head></head><body><p>&lt;script data-aispanda-runtime-config&gt;</p><script data-aispanda-runtime-config>article()</script></body></html>';
  const injected = injectRuntimePublicConfig(html, config);
  assert.ok(injected.startsWith('<html><head><script data-aispanda-runtime-config>globalThis.__AISPANDA_RUNTIME_CONFIG__='));
  assert.ok(injected.includes('<script data-aispanda-runtime-config>article()</script>'));
});

test('the HTTP response path preserves validated frozen publication bytes across runtime config changes', () => {
  const firstConfig = buildRuntimePublicConfig(validEnvironment());
  const changedConfig = buildRuntimePublicConfig(validEnvironment({
    RUNTIME_FIREBASE_API_KEY: 'changed-public-api-key',
  }));
  const frozenPage = injectRuntimePublicConfig('<html><head></head><body>Frozen</body></html>', firstConfig);
  assert.equal(prepareServedText({
    body: frozenPage,
    contentType: 'text/html; charset=utf-8',
    runtimeConfig: changedConfig,
    preserveExactBytes: true,
  }), frozenPage);
  assert.notEqual(prepareServedText({
    body: frozenPage,
    contentType: 'text/html; charset=utf-8',
    runtimeConfig: changedConfig,
  }), frozenPage);
});
