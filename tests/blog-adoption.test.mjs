import { installBlog } from '../scripts/blog-package.mjs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
// Integrated host browser test. Never uses an owner's browser or a live Firebase project.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { setTimeout as delay } from 'node:timers/promises';

test('installed package preserves host and editorial UI across desktop/mobile roles', { timeout: 180000 }, async () => {
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9099');
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8089');
  assert.ok(!process.env.GOOGLE_APPLICATION_CREDENTIALS, 'No live credential files in emulator verification');
  process.env.METADATA_SERVER_DETECTION = 'none';
  const projectId = 'demo-blog-community';
  const origin = 'http://127.0.0.1:18771';
  let host;
  let catalogueApp;
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
    catalogueApp = initializeApp({ projectId }, 'host-catalogue-test');
    const registry = getFirestore(catalogueApp).collection('contentCollections').doc('registry');
    const before = await registry.get();
    assert.equal(before.exists, false, 'Host catalogue test requires a clean disposable registry');
    try {
      await registry.set({ revision: 0, collections: [
        { id: 'building-with-ai', title: 'Building with AI', type: 'practice', order: 10 },
        { id: 'ai-access-independence', title: 'AI Access & Independence', type: 'theme', order: 20 },
      ] });
      for (const [collection, path, cover] of [['building-with-ai', '/principles', 'principles-visual'], ['ai-access-independence', '/open-the-ai', 'shared-track-visual']]) {
        const page = await fetch(origin + '/topics/' + collection);
        assert.equal(page.status, 200);
        const html = await page.text();
        assert.ok(html.includes(`href="${path}"`), 'Use the original host article URL');
        assert.ok(html.includes(`/images/articles/${cover}.webp`), 'Collection card shows the article cover');
        const article = await fetch(origin + path);
        assert.equal(article.status, 200, 'Original host route remains served');
        const articleHtml = await article.text();
        assert.ok(articleHtml.includes(`/images/articles/${cover}.webp`), 'Article includes the matching visual');
        assert.ok(articleHtml.includes(`<meta property="og:image" content="https://aispanda.com/images/articles/${cover}.png"`), 'Social preview uses article-specific artwork');
        const image = await fetch(origin + `/images/articles/${cover}.webp`);
        assert.equal(image.status, 200);
        assert.match(image.headers.get('content-type'), /^image\/webp/);
        assert.ok((await image.arrayBuffer()).byteLength < 250000, 'Article cover stays within the lightweight image budget');
      }
      const publicArticles = (await (await fetch(origin + '/api/content/articles')).json()).articles;
      assert.deepEqual(publicArticles.filter(row => row.source === 'host').map(row => row.path).sort(), ['/open-the-ai', '/principles']);
      assert.ok(publicArticles.filter(row => row.source === 'host').every(row => row.art?.src && row.art.alt), 'Public API preserves cover and description');
      for (const image of ['building-with-ai', 'ai-access-independence']) {
        const response = await fetch(origin + '/images/collections/' + image + '.png');
        assert.equal(response.status, 200);
        assert.match(response.headers.get('content-type'), /^image\/png/);
      }
    } finally { await registry.delete(); }
    const installed = await installBlog();
    const { runEditorialBrowserJourney } = await import(pathToFileURL(resolve(installed.release, 'runtime/tests/editorial-browser-journey.mjs')));
    const report = await runEditorialBrowserJourney({ origin, packageSha256: installed.packageSha256, artifactDirectory: resolve('.release-evidence/local-browser') });
    console.log(JSON.stringify({ ...report, hostRoutes: 'PASS' }));
  } finally {
    if (catalogueApp) await deleteApp(catalogueApp);
    if (host && host.exitCode === null) { host.kill(); await new Promise(resolve => host.once('exit', resolve)); }
  }
});
