import assert from 'node:assert/strict';
import test from 'node:test';
import { createCmsProxy, isCmsPath } from '../server/cms-proxy.mjs';

test('recognizes only the reserved CMS path', () => {
  assert.equal(isCmsPath('/cms'), true);
  assert.equal(isCmsPath('/cms/admin'), true);
  assert.equal(isCmsPath('/cms-malicious'), false);
  assert.equal(isCmsPath('/api/cms'), false);
});

test('forwards the complete CMS path through Cloud Run IAM without replacing Payload authorization', async () => {
  let observed;
  const proxy = createCmsProxy({
    targetOrigin: 'https://image-cms.example.run.app',
    identityToken: async () => 'Bearer cloud-run-token',
    fetchImpl: async (url, init) => {
      observed = { url: String(url), init };
      return new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } });
    },
  });
  const response = await proxy(new Request('https://aispanda.com/cms/api/assets?limit=10', {
    headers: { Authorization: 'integrations API-Key site-key', Cookie: 'payload-token=session' },
  }));
  assert.equal(response.status, 200);
  assert.equal(observed.url, 'https://image-cms.example.run.app/cms/api/assets?limit=10');
  assert.equal(observed.init.headers.get('Authorization'), 'integrations API-Key site-key');
  assert.equal(observed.init.headers.get('X-Serverless-Authorization'), 'Bearer cloud-run-token');
  assert.equal(observed.init.headers.get('X-Forwarded-Host'), 'aispanda.com');
});

test('rewrites an upstream absolute redirect to the canonical AIspanda origin', async () => {
  const proxy = createCmsProxy({
    targetOrigin: 'https://image-cms.example.run.app',
    identityToken: async () => 'Bearer cloud-run-token',
    fetchImpl: async () => new Response(null, {
      status: 307,
      headers: { Location: 'https://image-cms.example.run.app/cms/admin/login?redirect=%2Fcms%2Fadmin' },
    }),
  });
  const response = await proxy(new Request('https://aispanda.com/cms'));
  assert.equal(response.headers.get('location'), 'https://aispanda.com/cms/admin/login?redirect=%2Fcms%2Fadmin');
});

test('removes stale compression headers from decoded upstream responses', async () => {
  let observed;
  const proxy = createCmsProxy({
    targetOrigin: 'https://image-cms.example.run.app',
    identityToken: async () => 'Bearer cloud-run-token',
    fetchImpl: async (_url, init) => {
      observed = init;
      return new Response('decoded html', {
        headers: {
          'content-encoding': 'gzip',
          'content-length': '999',
          'content-type': 'text/html',
        },
      });
    },
  });
  const response = await proxy(new Request('https://aispanda.com/cms/admin/login', {
    headers: { 'Accept-Encoding': 'gzip, br' },
  }));
  assert.equal(observed.headers.get('Accept-Encoding'), 'identity');
  assert.equal(response.headers.has('content-encoding'), false);
  assert.equal(response.headers.has('content-length'), false);
  assert.equal(await response.text(), 'decoded html');
});

test('rejects non-HTTPS proxy targets', () => {
  assert.throws(() => createCmsProxy({ targetOrigin: 'http://image-cms.internal' }), /HTTPS origin/);
});

test('does not expose the CMS through the default Cloud Run hostname', async () => {
  const proxy = createCmsProxy({
    targetOrigin: 'https://image-cms.example.run.app',
    publicOrigin: 'https://aispanda.com',
    identityToken: async () => { throw new Error('must not request a token'); },
  });
  const response = await proxy(new Request('https://aispanda-web.example.run.app/cms/admin'));
  assert.equal(response.status, 404);
});
