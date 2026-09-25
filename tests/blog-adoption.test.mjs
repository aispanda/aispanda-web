import { installBlog } from '../scripts/blog-package.mjs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
// Integrated host browser test. Never uses an owner's browser or a live Firebase project.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

test('installed package preserves host and editorial UI across desktop/mobile roles', { timeout: 180000 }, async () => {
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9099');
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8089');
  assert.ok(!process.env.GOOGLE_APPLICATION_CREDENTIALS, 'No live credential files in emulator verification');
  process.env.METADATA_SERVER_DETECTION = 'none';
  const projectId = 'demo-blog-community';
  const origin = 'http://127.0.0.1:18771';
  let host;
  try {
    const env = { ...process.env, AI_VAULT_KEY_B64: randomBytes(32).toString('base64'), METADATA_SERVER_DETECTION: 'none', BLOG_CAPABILITY_ENABLED: 'true', BLOG_EMULATOR_MODE: 'true',
      PUBLIC_SITE_ORIGIN: origin, ARTICLE_SITE_ORIGIN: origin, PORT: '18771', RUNTIME_ENVIRONMENT: 'staging', GOOGLE_CLOUD_PROJECT: projectId,
      RUNTIME_FIREBASE_PROJECT_ID: projectId, RUNTIME_FIREBASE_API_KEY: 'demo-key', RUNTIME_FIREBASE_AUTH_DOMAIN: projectId + '.firebaseapp.com',
      RUNTIME_FIREBASE_STORAGE_BUCKET: projectId + '.appspot.com', RUNTIME_FIREBASE_MESSAGING_SENDER_ID: '123456789',
      RUNTIME_FIREBASE_APP_ID: '1:123456789:web:demo', RUNTIME_GOOGLE_CLIENT_ID: 'demo.apps.googleusercontent.com' };
    delete env.BLOG_APPROVED_STAGING_PROFILE;
    host = spawn(process.execPath, ['server/server.mjs'], { cwd: new URL('../', import.meta.url), env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let serverOutput = '';
    for (const stream of [host.stdout, host.stderr]) stream.on('data', bytes => { serverOutput = (serverOutput + bytes.toString()).slice(-4000); });
    let ready = false;
    for (let i = 0; i < 60; i++) {
      if (host.exitCode !== null) throw new Error('Host startup failed: ' + serverOutput);
      try { ready = (await fetch(origin + '/account')).status === 200; } catch {}
      if (ready) break;
      await delay(250);
    }
    assert.ok(ready, 'Host must become ready');
    for (const path of ['/', '/ai', '/assets', '/account', '/my-articles', '/manage/users', '/manage/collections', '/topics', '/stories']) {
      assert.equal((await fetch(origin + path)).status, 200, path);
    }
    const installed = await installBlog();
    const { runEditorialBrowserJourney } = await import(pathToFileURL(resolve(installed.release, 'runtime/tests/editorial-browser-journey.mjs')));
    const report = await runEditorialBrowserJourney({ origin, packageSha256: installed.packageSha256, artifactDirectory: resolve('.release-evidence/local-browser') });
    console.log(JSON.stringify({ ...report, hostRoutes: 'PASS' }));
  } finally {
    if (host && host.exitCode === null) { host.kill(); await new Promise(resolve => host.once('exit', resolve)); }
  }
});
