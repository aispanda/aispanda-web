import test from 'node:test';
import assert from 'node:assert/strict';
import { requiredChecks, verificationWindow, validateReleaseIdentity, validateObservations, validateRuntimeConfig, validatePublicHtml } from '../scripts/inapp-release-verification.mjs';

const now = Date.parse('2026-01-01T00:05:00.000Z');
const identity = { origin: 'https://staging.example.test', projectId: 'staging-example', commit: 'a'.repeat(40),
  digest: 'sha256:' + 'b'.repeat(64), packageSha256: 'c'.repeat(64), draftId: '11111111-2222-4333-8444-555555555555', expectedSlug: 'retained-fixture' };
const request = { ...identity, nonce: '11111111-2222-4333-8444-555555555555', requiredAction: 'published',
  issuedAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-01-01T00:15:00.000Z' };
const observations = () => ({ ...identity, nonce: request.nonce, mode: 'agent-operated-inapp', role: 'Administrator', action: 'published',
  completedAt: new Date(now).toISOString(), checks: Object.fromEntries(requiredChecks.map(check => [check, true])),
  title: 'A careful & useful journey', textSnippet: 'This retained article proves an actual publication.',
  imagePath: '/content-assets/11111111-2222-4333-8444-555555555555', imageAlt: 'A diagram of the publishing journey', releaseId: 'retained-release-123' });

test('controller identity must match current staging, commit and locked package', () => {
  const env = { TARGET_URL: identity.origin, TARGET_PROJECT: identity.projectId, RELEASE_COMMIT: identity.commit, IMAGE_DIGEST: identity.digest };
  assert.deepEqual(validateReleaseIdentity(identity, env, identity.commit), identity);
  for (const [field, value] of [['TARGET_URL', 'https://production.example.test'], ['TARGET_PROJECT', 'production-example'], ['RELEASE_COMMIT', 'd'.repeat(40)], ['IMAGE_DIGEST', 'latest']]) {
    assert.throws(() => validateReleaseIdentity(identity, { ...env, [field]: value }, identity.commit));
  }
  assert.throws(() => validateReleaseIdentity({ ...identity, packageSha256: '' }, env, identity.commit));
});

test('observations are bound to every challenge field and contain every real step', () => {
  assert.equal(validateObservations(request, observations(), now).releaseId, 'retained-release-123');
  for (const field of ['nonce', 'origin', 'projectId', 'commit', 'digest', 'packageSha256', 'draftId', 'expectedSlug']) {
    assert.throws(() => validateObservations(request, { ...observations(), [field]: 'wrong' }, now), new RegExp(field));
  }
  for (const field of requiredChecks) {
    const result = observations(); delete result.checks[field];
    assert.throws(() => validateObservations(request, result, now), new RegExp(field));
  }
  assert.throws(() => validateObservations(request, { outcome: 'PASS' }, now));
  assert.throws(() => validateObservations(request, { ...observations(), role: 'Author' }, now));
});

test('expired, future, stale and first-run revalidation claims fail closed', () => {
  assert.throws(() => validateObservations(request, observations(), now + 900000));
  assert.throws(() => validateObservations(request, { ...observations(), completedAt: '2025-12-31T23:59:00Z' }, now));
  assert.throws(() => validateObservations(request, { ...observations(), completedAt: '2026-01-01T00:06:00Z' }, now));
  assert.throws(() => validateObservations(request, { ...observations(), action: 'reverified' }, now));
  assert.equal(validateObservations({ ...request, requiredAction: 'published-or-reverified' }, { ...observations(), action: 'reverified' }, now).action, 'reverified');
});

test('issued challenge uses a single clock reading and stays within the strict verification window', () => {
  const start = Date.parse(request.issuedAt) + 933;
  const window = verificationWindow(start);
  assert.equal(Date.parse(window.expiresAt) - Date.parse(window.issuedAt), 900000);
  assert.equal(validateObservations({ ...request, ...window }, observations(), now).releaseId, observations().releaseId);
  assert.throws(() => validateObservations({ ...request, ...window,
    expiresAt: new Date(start + 900001).toISOString() }, observations(), now), /timestamps/);
  assert.throws(() => validateObservations({ ...request, ...window }, observations(), start + 900001), /expired/);
});

test('unsafe image paths are rejected and unrelated result fields are not retained', () => {
  for (const imagePath of ['https://production.example.test/image.webp', '//external.test/x', '/content-assets/../private', '/content-assets/%2e%2e/x', '/content-assets/id?token=secret', '/images/existing.webp']) {
    assert.throws(() => validateObservations(request, { ...observations(), imagePath }, now));
  }
  const result = observations(); result.unrelated = 'not retained'; result.checks.unrelated = 'not retained';
  const safe = validateObservations(request, result, now);
  assert.equal(safe.unrelated, undefined); assert.equal(safe.checks.unrelated, undefined);
});

test('independent runtime checks reject production or different project/origins', () => {
  const config = { environment: 'staging', firebase: { projectId: identity.projectId }, siteOrigin: identity.origin, articleSiteOrigin: identity.origin };
  validateRuntimeConfig(config, identity);
  for (const patch of [{ environment: 'production' }, { firebase: { projectId: 'production-example' } }, { siteOrigin: 'https://wrong.test' }, { articleSiteOrigin: 'https://wrong.test' }]) {
    assert.throws(() => validateRuntimeConfig({ ...config, ...patch }, identity));
  }
});

test('anonymous HTML corroborates title, real prose and the exact image/alt without inventing release ID proof', () => {
  const result = observations();
  const html = `<h1>A careful &amp; useful journey</h1><p>${result.textSnippet}</p><img src="${result.imagePath}" alt="${result.imageAlt}">`;
  validatePublicHtml(html, result);
  for (const patch of [{ title: 'Another article' }, { textSnippet: 'A different piece of public prose' }, { imagePath: '/content-assets/wrong' }, { imageAlt: 'Wrong alt' }]) {
    assert.throws(() => validatePublicHtml(html, { ...result, ...patch }));
  }
  assert.throws(() => validatePublicHtml(html.replace(`<p>${result.textSnippet}</p>`, `<script>${result.textSnippet}</script>`), result));
  assert.throws(() => validatePublicHtml(html.replace(' src=', ' data-src='), result));
});
