import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalize, resolve } from 'node:path';
import test from 'node:test';
import {
  appendPublishedUrlsToSitemap,
  archiveDraft,
  previewDraft,
  publishDraft,
  renderPublishedArticle,
  renderPublishedPreview,
  renderPublishedInsightRows,
  restoreDraft,
  sanitizeArticleBody,
  unpublishDraft,
  validateDraftForPublication,
  validateDraftForPreview,
  withContentFailureAudit,
} from '../server/content-publishing.mjs';
import { isInternalArticleShellFile } from '../server/static-routing.mjs';

test('encoded URLs cannot expose the internal article shell', () => {
  const distRoot = resolve('dist');
  const encodedPath = '/%61rticle-shell-internal';
  const clean = normalize(decodeURIComponent(encodedPath)).replace(/^([/\\])+/, '');
  const resolvedFile = resolve(distRoot, clean, 'index.html');

  assert.equal(isInternalArticleShellFile(resolvedFile, distRoot), true);
  assert.equal(isInternalArticleShellFile(resolve(distRoot, 'index.html'), distRoot), false);
});

const clone = (value) => value === undefined ? undefined : structuredClone(value);

class FakeSnapshot {
  constructor(value) {
    this.value = value;
    this.exists = value !== undefined;
  }

  data() {
    return clone(this.value);
  }
}

class FakeDb {
  constructor(initial = {}) {
    this.records = new Map(Object.entries(initial).map(([key, value]) => [key, clone(value)]));
    this.sequence = 0;
  }

  collection(name) {
    const database = this;
    return {
      doc: (id = `generated-${++this.sequence}`) => ({
        id,
        path: `${name}/${id}`,
        get: async () => new FakeSnapshot(database.records.get(`${name}/${id}`)),
        set: async (value) => database.records.set(`${name}/${id}`, clone(value)),
      }),
    };
  }

  async runTransaction(callback) {
    const operations = [];
    const transaction = {
      get: async (reference) => new FakeSnapshot(this.records.get(reference.path)),
      create: (reference, value) => operations.push({ type: 'create', reference, value }),
      set: (reference, value) => operations.push({ type: 'set', reference, value }),
      update: (reference, value) => operations.push({ type: 'update', reference, value }),
      delete: (reference) => operations.push({ type: 'delete', reference }),
    };
    const result = await callback(transaction);
    for (const operation of operations) {
      const current = this.records.get(operation.reference.path);
      if (operation.type === 'create' && current !== undefined) throw new Error('Document already exists');
      if (operation.type === 'delete') this.records.delete(operation.reference.path);
      if (operation.type === 'create' || operation.type === 'set') {
        this.records.set(operation.reference.path, clone(operation.value));
      }
      if (operation.type === 'update') {
        if (current === undefined) throw new Error('Document does not exist');
        this.records.set(operation.reference.path, { ...clone(current), ...clone(operation.value) });
      }
    }
    return result;
  }
}

const draft = (overrides = {}) => ({
  title: 'Consulting Rewired',
  body: '<h1>Consulting Rewired</h1><p>Useful <strong>article</strong>.</p>',
  excerpt: 'How AI changes consulting.',
  slug: 'consulting-rewired',
  tags: 'AI, Consulting',
  publicationStatus: 'draft',
  updatedAt: '2026-08-26T14:00:00.000Z',
  revisions: [],
  ownerUid: 'author-1',
  ownerEmail: 'author@example.com',
  ...overrides,
});

test('server sanitization removes executable markup and unsafe attributes', () => {
  const html = sanitizeArticleBody(
    '<p onclick="alert(1)">Safe<script>alert(1)</script><a href="javascript:alert(1)" style="color:red">unsafe</a><a href="https://example.com">safe</a></p>',
    'Title',
  );
  assert.equal(html.includes('script'), false);
  assert.equal(html.includes('onclick'), false);
  assert.equal(html.includes('javascript:'), false);
  assert.equal(html.includes('style='), false);
  assert.match(html, /rel="nofollow noopener noreferrer"/);
  assert.match(html, /href="https:\/\/example.com"/);
});

test('safe preview permits incomplete drafts without relaxing publication validation', () => {
  const incomplete = draft({ title: '', slug: '', body: '<p>Work in progress<script>alert(1)</script></p>' });
  const preview = validateDraftForPreview(incomplete);
  assert.equal(preview.title, 'Untitled article');
  assert.equal(preview.slug, 'preview');
  assert.equal(preview.bodyHtml.includes('<script'), false);
  assert.throws(() => validateDraftForPublication(incomplete), /article title/);
});

test('publication validation produces a stable safe snapshot and rejects reserved slugs', () => {
  const article = validateDraftForPublication(draft());
  assert.equal(article.slug, 'consulting-rewired');
  assert.equal(article.bodyHtml, '<p>Useful <strong>article</strong>.</p>');
  assert.deepEqual(article.tags, ['AI', 'Consulting']);
  assert.match(validateDraftForPublication(draft({
    body: '<table><thead><tr><th scope="col">Area</th></tr></thead><tbody><tr><td>Advisory</td></tr></tbody></table>',
  })).bodyHtml, /<table><thead><tr><th scope="col">Area<\/th><\/tr><\/thead><tbody><tr><td>Advisory<\/td><\/tr><\/tbody><\/table>/);
  assert.throws(() => validateDraftForPublication(draft({ slug: 'studio' })), /reserved/);
  assert.throws(() => validateDraftForPublication(draft({ slug: 'article-shell-internal' })), /reserved/);
});

test('publisher creates an immutable release, live snapshot, index, audit event and live URL', async () => {
  const db = new FakeDb({
    'studioAccess/publisher-1': { active: true, role: 'publisher' },
    'contentDrafts/draft-1': draft(),
  });
  const result = await publishDraft({
    db,
    draftId: 'draft-1',
    expectedUpdatedAt: '2026-08-26T14:00:00.000Z',
    idempotencyKey: 'request-0000000001',
    publisherUid: 'publisher-1',
    origin: 'https://aispanda.com',
    now: new Date('2026-08-26T15:00:00.000Z'),
  });

  assert.equal(result.liveUrl, 'https://aispanda.com/consulting-rewired');
  assert.equal(db.records.get('publishedContent/consulting-rewired').releaseId, result.releaseId);
  assert.equal(db.records.get(`contentReleases/${result.releaseId}`).bodyHtml.includes('<h1>'), false);
  assert.equal(db.records.get('contentPublicationIndex/draft-1').state, 'published');
  assert.equal(db.records.get('contentDrafts/draft-1').publicationStatus, 'published');
  assert.equal([...db.records.values()].some((value) => value?.action === 'publish'), true);
  const retry = await publishDraft({
    db,
    draftId: 'draft-1',
    expectedUpdatedAt: '2026-08-26T14:00:00.000Z',
    idempotencyKey: 'request-0000000001',
    publisherUid: 'publisher-1',
    origin: 'https://aispanda.com',
    now: new Date('2026-08-26T15:01:00.000Z'),
  });
  assert.deepEqual(retry, result);
  assert.equal([...db.records.keys()].filter((key) => key.startsWith('contentReleases/')).length, 1);
});

test('publication rejects unauthorized, stale and duplicate-slug requests without changing the draft', async () => {
  const initialDraft = draft();
  const db = new FakeDb({
    'studioAccess/author-1': { active: true, role: 'author' },
    'studioAccess/publisher-1': { active: true, role: 'publisher' },
    'contentDrafts/draft-1': initialDraft,
    'publishedContent/consulting-rewired': { draftId: 'another-draft', slug: 'consulting-rewired', bodyHtml: '<p>Existing</p>' },
  });
  await assert.rejects(
    publishDraft({ db, draftId: 'draft-1', expectedUpdatedAt: initialDraft.updatedAt, idempotencyKey: 'request-unauthorized', publisherUid: 'author-1', origin: 'https://aispanda.com' }),
    /Publisher or Administrator/,
  );
  await assert.rejects(
    publishDraft({ db, draftId: 'draft-1', expectedUpdatedAt: '2026-08-26T13:00:00.000Z', idempotencyKey: 'request-stale-0001', publisherUid: 'publisher-1', origin: 'https://aispanda.com' }),
    /changed after/,
  );
  await assert.rejects(
    publishDraft({ db, draftId: 'draft-1', expectedUpdatedAt: initialDraft.updatedAt, idempotencyKey: 'request-duplicate01', publisherUid: 'publisher-1', origin: 'https://aispanda.com' }),
    /already uses/,
  );
  assert.deepEqual(db.records.get('contentDrafts/draft-1'), initialDraft);
  const rejectedAudits = [...db.records.values()].filter((value) => value?.action === 'publish_failed');
  assert.deepEqual(rejectedAudits.map((event) => event.statusCode), [403, 409, 409]);

  const unavailableDb = new FakeDb();
  unavailableDb.runTransaction = async () => { throw new Error('database details must not enter the audit record'); };
  await assert.rejects(
    publishDraft({
      db: unavailableDb,
      draftId: 'draft-1',
      expectedUpdatedAt: initialDraft.updatedAt,
      idempotencyKey: 'request-internal-001',
      publisherUid: 'publisher-1',
      origin: 'https://aispanda.com',
    }),
    /database details/,
  );
  const internalAudit = [...unavailableDb.records.values()].find((value) => value?.action === 'publish_failed');
  assert.equal(internalAudit.statusCode, 500);
  assert.equal(internalAudit.reason, 'Internal content mutation error.');
});

test('content mutation preflight failures produce one sanitized audit event', async () => {
  const database = new FakeDb();
  const error = Object.assign(new Error('Request body must be valid JSON.'), { statusCode: 400 });
  await assert.rejects(
    withContentFailureAudit({
      db: database,
      action: 'publish',
      publisherUid: 'publisher-1',
      draftId: 'draft-1',
      occurredAt: '2026-08-26T19:00:00.000Z',
    }, async () => { throw error; }),
    /valid JSON/,
  );
  const events = [...database.records.values()].filter((value) => value?.action === 'publish_failed');
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    action: 'publish_failed',
    actorUid: 'publisher-1',
    draftId: 'draft-1',
    statusCode: 400,
    reason: 'Request body must be valid JSON.',
    occurredAt: '2026-08-26T19:00:00.000Z',
  });
});

test('unpublish removes the public snapshot while preserving draft and release history', async () => {
  const db = new FakeDb({
    'studioAccess/publisher-1': { active: true, role: 'publisher' },
    'contentDrafts/draft-1': draft({ publicationStatus: 'published' }),
    'contentPublicationIndex/draft-1': {
      draftId: 'draft-1', slug: 'consulting-rewired', releaseId: 'release-1', state: 'published', firstPublishedAt: '2026-08-26T14:30:00.000Z',
    },
    'publishedContent/consulting-rewired': { draftId: 'draft-1', slug: 'consulting-rewired', releaseId: 'release-1', bodyHtml: '<p>Published</p>' },
    'contentReleases/release-1': { id: 'release-1', draftId: 'draft-1' },
  });
  await unpublishDraft({
    db,
    draftId: 'draft-1',
    expectedUpdatedAt: '2026-08-26T14:00:00.000Z',
    publisherUid: 'publisher-1',
    now: new Date('2026-08-26T16:00:00.000Z'),
  });
  assert.equal(db.records.has('publishedContent/consulting-rewired'), false);
  assert.equal(db.records.get('contentDrafts/draft-1').publicationStatus, 'unpublished');
  assert.equal(db.records.get('contentPublicationIndex/draft-1').state, 'unpublished');
  assert.equal(db.records.has('contentReleases/release-1'), true);
  assert.equal([...db.records.values()].some((value) => value?.action === 'unpublish'), true);
});

test('preview uses publication sanitization and archiving cannot orphan a live article', async () => {
  const previewDb = new FakeDb({
    'studioAccess/author-1': { active: true, role: 'author' },
  });
  const preview = await previewDraft({
    db: previewDb,
    publisherUid: 'author-1',
    draft: draft({ body: '<p onclick="bad()">Safe<script>bad()</script></p>' }),
  });
  assert.equal(preview.bodyHtml, '<p>Safe</p>');

  const publishedDb = new FakeDb({
    'studioAccess/publisher-1': { active: true, role: 'publisher' },
    'contentDrafts/draft-1': draft({ publicationStatus: 'published' }),
    'contentPublicationIndex/draft-1': { state: 'published', slug: 'consulting-rewired', releaseId: 'release-1' },
  });
  await assert.rejects(
    archiveDraft({
      db: publishedDb,
      draftId: 'draft-1',
      expectedUpdatedAt: draft().updatedAt,
      publisherUid: 'publisher-1',
    }),
    /Unpublish this article/,
  );
  assert.equal(publishedDb.records.get('contentDrafts/draft-1').archivedAt, undefined);

  const draftDb = new FakeDb({
    'studioAccess/author-1': { active: true, role: 'author' },
    'studioAccess/publisher-1': { active: true, role: 'publisher' },
    'contentDrafts/draft-1': draft(),
  });
  const archived = await archiveDraft({
    db: draftDb,
    draftId: 'draft-1',
    expectedUpdatedAt: draft().updatedAt,
    publisherUid: 'author-1',
    now: new Date('2026-08-26T16:30:00.000Z'),
  });
  assert.equal(draftDb.records.get('contentDrafts/draft-1').archivedAt, archived.archivedAt);
  assert.equal([...draftDb.records.values()].some((value) => value?.action === 'archive'), true);
  await assert.rejects(
    publishDraft({
      db: draftDb,
      draftId: 'draft-1',
      expectedUpdatedAt: archived.archivedAt,
      idempotencyKey: 'request-archived-001',
      publisherUid: 'publisher-1',
      origin: 'https://aispanda.com',
    }),
    /must be restored/,
  );
  assert.equal(draftDb.records.has('publishedContent/consulting-rewired'), false);

  const restored = await restoreDraft({
    db: draftDb,
    draftId: 'draft-1',
    expectedUpdatedAt: archived.archivedAt,
    publisherUid: 'publisher-1',
    now: new Date('2026-08-26T18:00:00.000Z'),
  });
  assert.equal(restored.updatedAt, '2026-08-26T18:00:00.000Z');
  assert.equal(draftDb.records.get('contentDrafts/draft-1').archivedAt, undefined);
  assert.equal([...draftDb.records.values()].some((value) => value?.action === 'restore'), true);
});

test('published discovery renderers escape content and use the configured canonical origin', () => {
  const articles = [{
    slug: 'consulting-rewired',
    title: 'Consulting & <AI>',
    excerpt: 'Useful <notes>',
    tags: ['Consulting'],
    readMinutes: 4,
    publishedAt: '2026-08-26T15:00:00.000Z',
  }];
  const rows = renderPublishedInsightRows(articles);
  assert.match(rows, /Consulting &amp; &lt;AI&gt;/);
  assert.equal(rows.includes('<notes>'), false);
  const sitemap = appendPublishedUrlsToSitemap('<urlset></urlset>', articles, 'https://aispanda.com');
  assert.match(sitemap, /<loc>https:\/\/aispanda.com\/consulting-rewired<\/loc>/);
});

test('rendered page receives escaped metadata, safe body and the public canonical URL', () => {
  const template = '<title>@@AISPANDA_ARTICLE_TITLE@@</title><link rel="canonical" href="https://aispanda.com/article-shell-internal"><main>@@AISPANDA_ARTICLE_BODY@@</main>';
  const html = renderPublishedArticle(template, {
    ...validateDraftForPublication(draft({ title: 'Consulting & AI' })),
    draftId: 'draft-1',
    liveUrl: 'https://attacker.example/consulting-rewired',
  }, 'https://aispanda.com');
  assert.match(html, /<title>Consulting &amp; AI<\/title>/);
  assert.match(html, /href="https:\/\/aispanda.com\/consulting-rewired"/);
  assert.match(html, /<main><h2>Consulting Rewired<\/h2><p>Useful <strong>article<\/strong>\.<\/p><\/main>/);
  assert.equal(html.includes('@@AISPANDA_'), false);
});

test('production-style preview keeps the real shell but removes interactive discussion', () => {
  const template = '<main>@@AISPANDA_ARTICLE_TITLE@@<!--@@AISPANDA_INTERACTIVE_START@@--><form>Comment</form><!--@@AISPANDA_INTERACTIVE_END@@-->@@AISPANDA_ARTICLE_BODY@@</main>';
  const html = renderPublishedPreview(template, {
    title: 'Preview', excerpt: '', slug: 'preview', draftId: 'draft-1', bodyHtml: '<p>Body</p>', readMinutes: 1,
  }, 'https://aispanda.com');
  assert.match(html, /<main>Preview<p>Body<\/p><\/main>/);
  assert.equal(html.includes('Comment'), false);
});

test('Studio cloud contract prevents local article storage and direct draft deletion', async () => {
  const [studio, backend, rules, server, insights] = await Promise.all([
    readFile(new URL('../src/pages/studio/index.astro', import.meta.url), 'utf8'),
    readFile(new URL('../src/scripts/studio-firebase.ts', import.meta.url), 'utf8'),
    readFile(new URL('../firestore.rules', import.meta.url), 'utf8'),
    readFile(new URL('../server/server.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/insights/index.astro', import.meta.url), 'utf8'),
  ]);
  assert.equal(studio.includes('aispanda-studio-prototype'), false);
  assert.equal(studio.includes('localStorage.setItem'), false);
  assert.equal(backend.includes('deleteDoc('), false);
  assert.match(backend, /previewDraft:/);
  assert.match(backend, /currentData\?\.archivedAt/);
  assert.match(studio, /data-filter="archived"/);
  assert.match(studio, /studioBackend\.restoreDraft\(item\.id, state\.updatedAt\)/);
  assert.match(studio, /This draft is archived\. Restore it before editing\./);
  assert.match(studio, /class="studio-mobile-nav"/);
  assert.match(backend, /querySelectorAll<HTMLButtonElement>\('\[data-studio-signout\]'\)/);
  assert.match(studio, /studioBackend\.previewDocument\(draftId, getState\(\)\)/);
  assert.match(studio, /sandbox="allow-scripts allow-same-origin"/);
  assert.match(server, /contentRoute\.action === 'preview-document'/);
  assert.match(studio, /\['https:', 'http:', 'mailto:'\]/);
  assert.match(studio, /Archived · restore to edit/);
  assert.match(rules, /match \/contentDrafts\/\{draftId\}[\s\S]*allow delete: if false;/);
  assert.match(rules, /allow update: if validDraft\(\)[\s\S]*resource\.data\.get\('archivedAt', ''\) == ''/);
  assert.match(rules, /request\.resource\.data\.publicationStatus == 'draft'/);
  assert.match(rules, /resource\.data\.publicationStatus == 'published'[\s\S]*request\.resource\.data\.publicationStatus == 'published-with-changes'/);
  assert.match(server, /SITE_ORIGIN/);
  assert.match(insights, /AISPANDA_DYNAMIC_INSIGHTS/);
});
