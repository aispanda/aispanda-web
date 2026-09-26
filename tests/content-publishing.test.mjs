import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalize, resolve } from 'node:path';
import test from 'node:test';
import {
  appendPublishedUrlsToSitemap,
  archiveDraft,
  assertContentMutationRequest,
  buildPublicationSnapshot,
  loadPublishedArticle,
  migrateLegacyDraft,
  previewDraft,
  publishDraft,
  renderPublishedArticle,
  renderPublishedPreview,
  renderPublishedInsightRows,
  restoreDraft,
  saveCanonicalDraft,
  sanitizeArticleBody,
  SUPPORTED_PUBLICATION_VERSION_TUPLES,
  supportsPublicationVersion,
  unpublishDraft,
  validateDraftForPublication,
  validateDraftForPreview,
  withContentFailureAudit,
} from '../server/content-publishing.mjs';
import { isInternalArticleShellFile } from '../server/static-routing.mjs';
import {
  canonicalContentFields,
  createContentDocument,
  publicStudioContentErrorDetails,
  resolveStoredDraftContent,
  sha256,
} from '../server/studio-content-document.mjs';

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

const contentDocument = (text = 'Useful article.') => createContentDocument({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

const imageAssetId = '11111111-2222-4333-8444-555555555555';
const imageContentDocument = (assetId = imageAssetId) => createContentDocument({
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Useful article.' }] },
    { type: 'image', attrs: { assetId, alt: 'Consulting workflow diagram', decorative: false, caption: 'A governed image' } },
  ],
});

const canonicalDraft = (overrides = {}) => ({
  title: 'Consulting Rewired',
  ...canonicalContentFields(contentDocument()),
  excerpt: 'How AI changes consulting.',
  slug: 'consulting-rewired',
  tags: 'AI, Consulting',
  publicationStatus: 'draft',
  publicationReleaseId: '',
  publicationLiveUrl: '',
  updatedAt: '2026-08-26T14:00:00.000Z',
  revision: 1,
  revisions: [],
  ownerUid: 'author-1',
  ownerEmail: 'author@example.com',
  ...overrides,
});

const canonicalSavePayload = (record, document = contentDocument()) => ({
  title: record.title,
  excerpt: record.excerpt,
  slug: record.slug,
  tags: record.tags,
  ...document,
});

const articleTemplateV1 = '<!doctype html><html><head><title>@@AISPANDA_ARTICLE_TITLE@@</title><link rel="canonical" href="https://aispanda.com/article-shell-internal"></head><body><main><h1>@@AISPANDA_ARTICLE_TITLE@@</h1><p>@@AISPANDA_ARTICLE_DESCRIPTION@@</p><article>@@AISPANDA_ARTICLE_BODY@@</article><small>@@AISPANDA_ARTICLE_READ_TIME@@</small></main></body></html>';
const articleTemplateV2 = articleTemplateV1.replace('<main>', '<main data-template="v2">');

const previewCurrent = ({
  db,
  record,
  draftId = 'draft-1',
  publisherUid = 'publisher-1',
  articleTemplate = articleTemplateV1,
  now = new Date('2026-08-26T14:30:00.000Z'),
}) => previewDraft({
  db,
  draftId,
  expectedUpdatedAt: record.updatedAt,
  expectedRevision: record.revision,
  expectedContentSha256: record.contentSha256,
  publisherUid,
  articleTemplate,
  origin: 'https://aispanda.com',
  now,
});

const publishCurrent = async ({
  db,
  record,
  draftId = 'draft-1',
  publisherUid = 'publisher-1',
  articleTemplate = articleTemplateV1,
  idempotencyKey = 'request-0000000001',
  now = new Date('2026-08-26T15:00:00.000Z'),
}) => {
  const preview = await previewCurrent({
    db,
    record,
    draftId,
    publisherUid,
    articleTemplate,
    now: new Date(now.getTime() - (5 * 60 * 1000)),
  });
  return publishDraft({
    db,
    draftId,
    expectedUpdatedAt: record.updatedAt,
    expectedRevision: record.revision,
    expectedContentSha256: record.contentSha256,
    previewReceiptId: preview.receiptId,
    idempotencyKey,
    publisherUid,
    origin: 'https://aispanda.com',
    articleTemplate,
    now,
  });
};

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

test('production preview enforces the same publication readiness contract', () => {
  const incomplete = canonicalDraft({ title: '', slug: '' });
  assert.throws(() => validateDraftForPreview(incomplete), /article title/);
  assert.throws(() => validateDraftForPublication(incomplete), /article title/);
  assert.throws(() => validateDraftForPreview(canonicalDraft({ slug: 'studio' })), /reserved/);
});

test('the frozen v1 reader remains registered independently of future writer versions', () => {
  const [v1] = SUPPORTED_PUBLICATION_VERSION_TUPLES;
  assert.equal(supportsPublicationVersion(v1), true);
  assert.equal(supportsPublicationVersion({
    snapshotVersion: 'ai-91-publication-v2',
    rendererVersion: 'future-renderer-v2',
    sanitizerVersion: 'future-sanitizer-v2',
    templateVersion: 'future-template-v2',
  }), false);
  assert.equal(Object.isFrozen(SUPPORTED_PUBLICATION_VERSION_TUPLES), true);
  assert.equal(Object.isFrozen(v1), true);
});

test('publication validation produces a stable safe snapshot and rejects reserved slugs', () => {
  const article = validateDraftForPublication(canonicalDraft());
  assert.equal(article.slug, 'consulting-rewired');
  assert.equal(article.bodyHtml, '<p>Useful article.</p>');
  assert.deepEqual(article.tags, ['AI', 'Consulting']);
  assert.equal(validateDraftForPublication(canonicalDraft()).bodyHtml, '<p>Useful article.</p>');
  assert.throws(() => validateDraftForPublication(draft()), /Convert this legacy draft/);
  assert.throws(() => validateDraftForPublication(canonicalDraft({ slug: 'studio' })), /reserved/);
  assert.throws(() => validateDraftForPublication(canonicalDraft({ slug: 'article-shell-internal' })), /reserved/);

  const unhashed = canonicalDraft();
  delete unhashed.contentSha256;
  assert.throws(() => validateDraftForPreview(unhashed), /missing its governed integrity hash/);
  assert.throws(() => validateDraftForPublication(unhashed), /missing its governed integrity hash/);
  const malformedHash = canonicalDraft({ contentSha256: 'not-a-hash' });
  assert.throws(() => validateDraftForPreview(malformedHash), /missing its governed integrity hash/);
  const mismatchedHash = canonicalDraft({ contentSha256: 'f'.repeat(64) });
  assert.throws(() => validateDraftForPublication(mismatchedHash), /hash does not match/);
});

test('mutation request preflight rejects forged top-level fields', () => {
  assert.throws(
    () => assertContentMutationRequest('save', { draft: {}, ownerUid: 'attacker' }),
    /Request field ownerUid is not allowed/,
  );
  assert.throws(
    () => assertContentMutationRequest('migrate', { expectedUpdatedAt: '', legacyHtmlOriginal: '<p>forged</p>' }),
    /Request field legacyHtmlOriginal is not allowed/,
  );
});

test('opening a supported legacy draft is read-only while production preview requires migration', () => {
  const legacy = draft();
  const resolved = resolveStoredDraftContent(legacy);
  assert.equal(resolved.renderedHtml, '<p>Useful <strong>article</strong>.</p>');
  assert.throws(() => validateDraftForPreview(legacy), /Convert this legacy draft/);
});

test('explicit migration atomically replaces legacy body with canonical root fields and exact provenance', async () => {
  const legacy = draft();
  const db = new FakeDb({
    'studioAccess/author-1': { active: true, role: 'author' },
    'contentDrafts/draft-1': legacy,
  });
  const migratedAt = new Date('2026-08-26T15:00:00.000Z');

  const result = await migrateLegacyDraft({
    db,
    draftId: 'draft-1',
    publisherUid: 'author-1',
    expectedUpdatedAt: legacy.updatedAt,
    expectedRevision: 0,
    expectedSourceSha256: sha256(legacy.body),
    now: migratedAt,
  });
  const stored = db.records.get('contentDrafts/draft-1');

  assert.equal(result.status, 'compatible');
  assert.equal(result.originalPreserved, true);
  assert.equal(Object.hasOwn(stored, 'body'), false);
  assert.equal(stored.format, 'tiptap-json');
  assert.equal(stored.schemaVersion, 1);
  assert.equal(stored.registryVersion, 'ai-91-v1');
  assert.equal(stored.contentSha256, result.contentSha256);
  assert.equal(stored.revision, 1);
  assert.equal(stored.updatedAt, migratedAt.toISOString());
  assert.equal(stored.legacyHtmlOriginal, legacy.body);
  assert.equal(stored.legacyHtmlSha256, sha256(legacy.body));
  assert.deepEqual(stored.migrationReport, {
    status: 'compatible',
    schemaVersion: 1,
    registryVersion: 'ai-91-v1',
    sourceSha256: sha256(legacy.body),
    contentSha256: result.contentSha256,
    titleOriginal: legacy.title,
    titleSha256: sha256(legacy.title),
    migratedAt: migratedAt.toISOString(),
    migratedBy: 'author-1',
  });
  assert.equal([...db.records.values()].filter((value) => value?.action === 'migrate').length, 1);
});

test('unsupported migration preserves the draft byte-for-byte and records one actionable failure', async () => {
  const legacy = draft({ body: '<p>Before</p><table><tr><td>Unsupported</td></tr></table>' });
  const db = new FakeDb({
    'studioAccess/author-1': { active: true, role: 'author' },
    'contentDrafts/draft-1': legacy,
  });

  let migrationError;
  try {
    await migrateLegacyDraft({
      db,
      draftId: 'draft-1',
      publisherUid: 'author-1',
      expectedUpdatedAt: legacy.updatedAt,
      expectedRevision: 0,
      expectedSourceSha256: sha256(legacy.body),
      now: new Date('2026-08-26T15:00:00.000Z'),
    });
  } catch (error) {
    migrationError = error;
  }

  assert.match(migrationError?.message ?? '', /Original preserved; nothing saved/);
  assert.deepEqual(publicStudioContentErrorDetails(migrationError), {
    code: 'unsupported-legacy-element',
    element: 'table',
    attribute: '',
    position: 13,
  });
  assert.deepEqual(db.records.get('contentDrafts/draft-1'), legacy);
  const failures = [...db.records.values()].filter((value) => value?.action === 'migrate_failed');
  assert.equal(failures.length, 1);
  assert.match(failures[0].reason, /Original preserved; nothing saved/);
});

test('canonical save updates one word while preserving immutable legacy provenance', async () => {
  const legacy = draft();
  const db = new FakeDb({
    'studioAccess/author-1': { active: true, role: 'author' },
    'contentDrafts/draft-1': legacy,
  });
  await migrateLegacyDraft({
    db,
    draftId: 'draft-1',
    publisherUid: 'author-1',
    expectedUpdatedAt: legacy.updatedAt,
    expectedRevision: 0,
    expectedSourceSha256: sha256(legacy.body),
    now: new Date('2026-08-26T15:00:00.000Z'),
  });
  const migrated = clone(db.records.get('contentDrafts/draft-1'));
  const editedDocument = contentDocument('Useful article improved.');
  const savedAt = new Date('2026-08-26T15:05:00.000Z');

  const result = await saveCanonicalDraft({
    db,
    draftId: 'draft-1',
    publisherUid: 'author-1',
    publisherEmail: 'forged@example.com',
    draft: canonicalSavePayload(migrated, editedDocument),
    expectedUpdatedAt: migrated.updatedAt,
    expectedRevision: migrated.revision,
    expectedContentSha256: migrated.contentSha256,
    now: savedAt,
  });
  const stored = db.records.get('contentDrafts/draft-1');

  assert.equal(result.revision, 2);
  assert.equal(stored.revision, 2);
  assert.equal(stored.updatedAt, savedAt.toISOString());
  assert.equal(stored.content.content[0].content[0].text, 'Useful article improved.');
  assert.equal(stored.contentSha256, canonicalContentFields(editedDocument).contentSha256);
  assert.equal(stored.legacyHtmlOriginal, migrated.legacyHtmlOriginal);
  assert.equal(stored.legacyHtmlSha256, migrated.legacyHtmlSha256);
  assert.deepEqual(stored.migrationReport, migrated.migrationReport);
  assert.equal(stored.ownerEmail, legacy.ownerEmail);
  assert.equal(Object.hasOwn(stored, 'body'), false);

  const secondDocument = contentDocument('Useful article improved again.');
  const secondResult = await saveCanonicalDraft({
    db,
    draftId: 'draft-1',
    publisherUid: 'author-1',
    publisherEmail: legacy.ownerEmail,
    draft: canonicalSavePayload(stored, secondDocument),
    expectedUpdatedAt: stored.updatedAt,
    expectedRevision: stored.revision,
    expectedContentSha256: stored.contentSha256,
    now: new Date('2026-08-26T15:06:00.000Z'),
  });
  const reloaded = db.records.get('contentDrafts/draft-1');
  assert.equal(secondResult.revision, 3);
  assert.equal(reloaded.content.content[0].content[0].text, 'Useful article improved again.');
  assert.deepEqual(reloaded.migrationReport, migrated.migrationReport);
  assert.equal(validateDraftForPreview(reloaded).bodyHtml, '<p>Useful article improved again.</p>');
});

test('canonical draft creation and updates are server-owned, authorized, and concurrency-safe', async () => {
  const creationDb = new FakeDb({
    'studioAccess/author-1': { active: true, role: 'author' },
  });
  const newDocument = contentDocument('First cloud draft.');
  await saveCanonicalDraft({
    db: creationDb,
    draftId: 'new-draft',
    publisherUid: 'author-1',
    publisherEmail: 'author@example.com',
    draft: canonicalSavePayload(draft(), newDocument),
    expectedRevision: 0,
    now: new Date('2026-08-26T15:10:00.000Z'),
  });
  const created = creationDb.records.get('contentDrafts/new-draft');
  assert.equal(created.ownerUid, 'author-1');
  assert.equal(created.ownerEmail, 'author@example.com');
  assert.equal(created.publicationStatus, 'draft');
  assert.equal(created.publicationReleaseId, '');
  assert.equal(created.publicationLiveUrl, '');
  assert.equal(created.revision, 1);
  assert.equal(Object.hasOwn(created, 'body'), false);

  const unchanged = canonicalDraft();
  const rejectionCases = [
    {
      name: 'wrong owner',
      access: { active: true, role: 'author' },
      uid: 'author-2',
      record: unchanged,
      request: {},
      pattern: /only drafts they own/,
      statusCode: 403,
    },
    {
      name: 'wrong role',
      access: { active: true, role: 'viewer' },
      uid: 'viewer-1',
      record: unchanged,
      request: {},
      pattern: /Author, Publisher or Administrator/,
      statusCode: 403,
    },
    {
      name: 'stale revision',
      access: { active: true, role: 'publisher' },
      uid: 'publisher-1',
      record: unchanged,
      request: { expectedRevision: 0 },
      pattern: /revision is stale/,
      statusCode: 409,
    },
    {
      name: 'stale timestamp',
      access: { active: true, role: 'publisher' },
      uid: 'publisher-1',
      record: unchanged,
      request: { expectedUpdatedAt: '2026-08-26T13:59:00.000Z' },
      pattern: /changed in another session/,
      statusCode: 409,
    },
    {
      name: 'stale content hash',
      access: { active: true, role: 'publisher' },
      uid: 'publisher-1',
      record: unchanged,
      request: { expectedContentSha256: '0'.repeat(64) },
      pattern: /content changed in another session/,
      statusCode: 409,
    },
    {
      name: 'archived draft',
      access: { active: true, role: 'publisher' },
      uid: 'publisher-1',
      record: { ...unchanged, archivedAt: '2026-08-26T14:30:00.000Z' },
      request: {},
      pattern: /archived/,
      statusCode: 409,
    },
    {
      name: 'partial legacy provenance',
      access: { active: true, role: 'publisher' },
      uid: 'publisher-1',
      record: { ...unchanged, legacyHtmlSha256: sha256('<p>legacy</p>') },
      request: {},
      pattern: /preserved legacy source is inconsistent/,
      statusCode: 409,
    },
    {
      name: 'forged legacy report',
      access: { active: true, role: 'publisher' },
      uid: 'publisher-1',
      record: {
        ...unchanged,
        legacyHtmlOriginal: '<p>legacy</p>',
        legacyHtmlSha256: sha256('<p>legacy</p>'),
        migrationReport: { forged: true },
      },
      request: {},
      pattern: /migration report is inconsistent/,
      statusCode: 409,
    },
    {
      name: 'forged server field',
      access: { active: true, role: 'publisher' },
      uid: 'publisher-1',
      record: unchanged,
      request: { draft: { ...canonicalSavePayload(unchanged), ownerUid: 'attacker' } },
      pattern: /server-owned/,
      statusCode: 400,
    },
    {
      name: 'stored hash mismatch',
      access: { active: true, role: 'publisher' },
      uid: 'publisher-1',
      record: { ...unchanged, contentSha256: 'f'.repeat(64) },
      request: {},
      pattern: /hash does not match/,
      statusCode: 409,
    },
    {
      name: 'unknown stored field',
      access: { active: true, role: 'publisher' },
      uid: 'publisher-1',
      record: { ...unchanged, ungovernedMetadata: 'must not be erased' },
      request: {},
      pattern: /unknown field ungovernedMetadata/,
      statusCode: 409,
    },
  ];

  for (const rejection of rejectionCases) {
    const db = new FakeDb({
      [`studioAccess/${rejection.uid}`]: rejection.access,
      'contentDrafts/draft-1': rejection.record,
    });
    await assert.rejects(
      saveCanonicalDraft({
        db,
        draftId: 'draft-1',
        publisherUid: rejection.uid,
        publisherEmail: `${rejection.uid}@example.com`,
        draft: canonicalSavePayload(rejection.record),
        expectedUpdatedAt: rejection.record.updatedAt,
        expectedRevision: rejection.record.revision,
        expectedContentSha256: rejection.record.contentSha256,
        now: new Date('2026-08-26T15:15:00.000Z'),
        ...rejection.request,
      }),
      rejection.pattern,
      rejection.name,
    );
    assert.deepEqual(db.records.get('contentDrafts/draft-1'), rejection.record, rejection.name);
    const failures = [...db.records.values()].filter((value) => value?.action === 'save_failed');
    assert.equal(failures.length, 1, rejection.name);
    assert.equal(failures[0].statusCode, rejection.statusCode, rejection.name);
  }
});

test('legacy migration rejects authority, state, source, format, revision, and provenance forgery without mutation', async () => {
  const baseline = draft();
  const cases = [
    {
      name: 'wrong owner', uid: 'author-2', access: { active: true, role: 'author' }, record: baseline,
      request: {}, pattern: /only drafts they own/, statusCode: 403,
    },
    {
      name: 'archived', uid: 'publisher-1', access: { active: true, role: 'publisher' },
      record: { ...baseline, archivedAt: '2026-08-26T14:30:00.000Z' }, request: {}, pattern: /archived/, statusCode: 409,
    },
    {
      name: 'forged source hash', uid: 'publisher-1', access: { active: true, role: 'publisher' }, record: baseline,
      request: { expectedSourceSha256: '0'.repeat(64) }, pattern: /legacy source changed/, statusCode: 409,
    },
    {
      name: 'unknown format', uid: 'publisher-1', access: { active: true, role: 'publisher' },
      record: { ...baseline, format: 'forged' }, request: {}, pattern: /unknown field format/, statusCode: 409,
    },
    {
      name: 'invalid revision', uid: 'publisher-1', access: { active: true, role: 'publisher' },
      record: { ...baseline, revision: -1 }, request: { expectedRevision: -1 }, pattern: /legacy revision is invalid/, statusCode: 409,
    },
    {
      name: 'pre-existing provenance', uid: 'publisher-1', access: { active: true, role: 'publisher' },
      record: { ...baseline, legacyHtmlOriginal: baseline.body }, request: {}, pattern: /unknown field legacyHtmlOriginal/, statusCode: 409,
    },
    {
      name: 'missing owner', uid: 'publisher-1', access: { active: true, role: 'publisher' },
      record: { ...baseline, ownerUid: '' }, request: {}, pattern: /stored draft owner is invalid/, statusCode: 409,
    },
    {
      name: 'unknown stored field', uid: 'publisher-1', access: { active: true, role: 'publisher' },
      record: { ...baseline, ungovernedMetadata: 'must not be erased' }, request: {}, pattern: /unknown field ungovernedMetadata/, statusCode: 409,
    },
  ];

  for (const item of cases) {
    const db = new FakeDb({
      [`studioAccess/${item.uid}`]: item.access,
      'contentDrafts/draft-1': item.record,
    });
    await assert.rejects(
      migrateLegacyDraft({
        db,
        draftId: 'draft-1',
        publisherUid: item.uid,
        expectedUpdatedAt: item.record.updatedAt,
        expectedRevision: item.record.revision ?? 0,
        expectedSourceSha256: sha256(item.record.body),
        now: new Date('2026-08-26T15:20:00.000Z'),
        ...item.request,
      }),
      item.pattern,
      item.name,
    );
    assert.deepEqual(db.records.get('contentDrafts/draft-1'), item.record, item.name);
    const failures = [...db.records.values()].filter((value) => value?.action === 'migrate_failed');
    assert.equal(failures.length, 1, item.name);
    assert.equal(failures[0].statusCode, item.statusCode, item.name);
  }
});

test('canonical save rejects a well-formed but forged immutable migration-output hash', async () => {
  const legacy = draft();
  const db = new FakeDb({
    'studioAccess/author-1': { active: true, role: 'author' },
    'contentDrafts/draft-1': legacy,
  });
  await migrateLegacyDraft({
    db,
    draftId: 'draft-1',
    publisherUid: 'author-1',
    expectedUpdatedAt: legacy.updatedAt,
    expectedRevision: 0,
    expectedSourceSha256: sha256(legacy.body),
    now: new Date('2026-08-26T15:00:00.000Z'),
  });
  const migrated = clone(db.records.get('contentDrafts/draft-1'));
  const forged = {
    ...migrated,
    migrationReport: { ...migrated.migrationReport, contentSha256: 'f'.repeat(64) },
  };
  db.records.set('contentDrafts/draft-1', clone(forged));

  await assert.rejects(
    saveCanonicalDraft({
      db,
      draftId: 'draft-1',
      publisherUid: 'author-1',
      publisherEmail: legacy.ownerEmail,
      draft: canonicalSavePayload(forged, contentDocument('Changed.')),
      expectedUpdatedAt: forged.updatedAt,
      expectedRevision: forged.revision,
      expectedContentSha256: forged.contentSha256,
      now: new Date('2026-08-26T15:10:00.000Z'),
    }),
    /migration output hash is inconsistent/,
  );
  assert.deepEqual(db.records.get('contentDrafts/draft-1'), forged);
});

test('publisher creates an immutable release, live snapshot, index, audit event and live URL', async () => {
  const record = canonicalDraft();
  const db = new FakeDb({
    'studioAccess/publisher-1': { active: true, role: 'publisher' },
    'contentDrafts/draft-1': record,
  });
  const preview = await previewCurrent({ db, record });
  const publishArgs = {
    db,
    draftId: 'draft-1',
    expectedUpdatedAt: record.updatedAt,
    expectedRevision: record.revision,
    expectedContentSha256: record.contentSha256,
    previewReceiptId: preview.receiptId,
    idempotencyKey: 'request-0000000001',
    publisherUid: 'publisher-1',
    origin: 'https://aispanda.com',
    articleTemplate: articleTemplateV1,
    now: new Date('2026-08-26T15:00:00.000Z'),
  };
  const result = await publishDraft(publishArgs);

  assert.equal(result.liveUrl, 'https://aispanda.com/consulting-rewired');
  assert.equal(db.records.get('publishedContent/consulting-rewired').releaseId, result.releaseId);
  const manifest = db.records.get(`contentReleases/${result.releaseId}`);
  assert.equal(manifest.snapshotSha256, preview.snapshotSha256);
  assert.equal(manifest.renderedPageSha256, preview.renderedPageSha256);
  assert.equal(manifest.bodyHtml, undefined);
  assert.equal(db.records.get(`contentReleasePayloads/${result.releaseId}_body`).bodyHtml, '<p>Useful article.</p>');
  assert.equal(db.records.get(`contentReleasePayloads/${result.releaseId}_page`).renderedPageHtml, preview.html);
  assert.deepEqual(db.records.get(`contentReleasePayloads/${result.releaseId}_source`).sourceJson, contentDocument());
  assert.equal(db.records.get('contentPublicationIndex/draft-1').state, 'published');
  assert.equal(db.records.get('contentDrafts/draft-1').publicationStatus, 'published');
  assert.equal([...db.records.values()].some((value) => value?.action === 'publish'), true);
  const retry = await publishDraft({ ...publishArgs, now: new Date('2026-08-26T15:01:00.000Z') });
  assert.deepEqual(retry, result);
  assert.equal([...db.records.keys()].filter((key) => key.startsWith('contentReleases/')).length, 1);
});

test('Administrator completes the cloud draft lifecycle without exposing unpublished edits or losing release history', async () => {
  const publisherUid = 'administrator-1';
  const draftId = 'admin-lifecycle';
  const db = new FakeDb({
    [`studioAccess/${publisherUid}`]: { active: true, role: 'administrator' },
    'studioAccess/viewer-1': { active: true, role: 'viewer' },
  });
  const readDraft = async () => (await db.collection('contentDrafts').doc(draftId).get()).data();
  const save = async (text, slug, timestamp) => {
    const current = await readDraft();
    await saveCanonicalDraft({
      db, draftId, publisherUid, publisherEmail: 'administrator@example.test',
      draft: canonicalSavePayload({ ...(current ?? draft()), slug }, contentDocument(text)),
      expectedUpdatedAt: current?.updatedAt,
      expectedRevision: current?.revision ?? 0,
      expectedContentSha256: current?.contentSha256,
      checkpoint: true,
      now: new Date(timestamp),
    });
    return readDraft();
  };
  const publish = async (key, timestamp) => publishCurrent({
    db, draftId, publisherUid, record: await readDraft(),
    idempotencyKey: key, now: new Date(timestamp),
  });

  const created = await save('First published version.', 'admin-lifecycle', '2026-09-05T10:00:00.000Z');
  assert.equal(created.ownerUid, publisherUid);
  assert.equal(created.publicationStatus, 'draft');
  assert.deepEqual(created.content, contentDocument('First published version.').content);
  assert.equal(await loadPublishedArticle(db, 'admin-lifecycle'), null);

  const first = await publish('admin-lifecycle-release-1', '2026-09-05T10:10:00.000Z');
  const firstPublic = await loadPublishedArticle(db, 'admin-lifecycle');
  assert.match(firstPublic.renderedPageHtml, /First published version\./);

  const changedBody = await save('Second published version.', 'admin-lifecycle', '2026-09-05T10:20:00.000Z');
  assert.equal(changedBody.publicationStatus, 'published-with-changes');
  assert.equal(changedBody.publicationReleaseId, first.releaseId);
  assert.deepEqual(await loadPublishedArticle(db, 'admin-lifecycle'), firstPublic);
  const second = await publish('admin-lifecycle-release-2', '2026-09-05T10:30:00.000Z');
  assert.notEqual(second.releaseId, first.releaseId);
  assert.equal(second.liveUrl, first.liveUrl);
  const secondPublic = await loadPublishedArticle(db, 'admin-lifecycle');
  assert.match(secondPublic.renderedPageHtml, /Second published version\./);
  assert.doesNotMatch(secondPublic.renderedPageHtml, /First published version\./);

  const changedSlug = await save('Third published version.', 'admin-lifecycle-renamed', '2026-09-05T10:40:00.000Z');
  assert.equal(changedSlug.publicationStatus, 'published-with-changes');
  assert.equal(changedSlug.publicationLiveUrl, first.liveUrl);
  assert.deepEqual(await loadPublishedArticle(db, 'admin-lifecycle'), secondPublic);
  assert.equal(await loadPublishedArticle(db, 'admin-lifecycle-renamed'), null);
  const third = await publish('admin-lifecycle-release-3', '2026-09-05T10:50:00.000Z');
  assert.equal(third.liveUrl, 'https://aispanda.com/admin-lifecycle-renamed');
  assert.notEqual(third.releaseId, second.releaseId);
  assert.equal(await loadPublishedArticle(db, 'admin-lifecycle'), null);
  const thirdPublic = await loadPublishedArticle(db, 'admin-lifecycle-renamed');
  assert.match(thirdPublic.renderedPageHtml, /Third published version\./);

  const liveDraft = await readDraft();
  await assert.rejects(archiveDraft({
    db, draftId, publisherUid, expectedUpdatedAt: liveDraft.updatedAt,
  }), /Unpublish this article/);
  await assert.rejects(saveCanonicalDraft({
    db, draftId, publisherUid: 'viewer-1', publisherEmail: 'viewer@example.test',
    draft: canonicalSavePayload(liveDraft, contentDocument('Unauthorized replacement.')),
    expectedUpdatedAt: liveDraft.updatedAt,
    expectedRevision: liveDraft.revision,
    expectedContentSha256: liveDraft.contentSha256,
  }), (error) => error.statusCode === 403);
  await assert.rejects(unpublishDraft({
    db, draftId, publisherUid: 'viewer-1', expectedUpdatedAt: liveDraft.updatedAt,
  }), (error) => error.statusCode === 403);
  assert.deepEqual(await readDraft(), liveDraft);
  assert.deepEqual(await loadPublishedArticle(db, 'admin-lifecycle-renamed'), thirdPublic);

  const unpublished = await unpublishDraft({
    db, draftId, publisherUid, expectedUpdatedAt: liveDraft.updatedAt,
    now: new Date('2026-09-05T11:00:00.000Z'),
  });
  assert.equal(await loadPublishedArticle(db, 'admin-lifecycle-renamed'), null);
  assert.equal((await readDraft()).publicationStatus, 'unpublished');
  assert.deepEqual((await readDraft()).content, liveDraft.content);
  const archived = await archiveDraft({
    db, draftId, publisherUid, expectedUpdatedAt: unpublished.updatedAt,
    now: new Date('2026-09-05T11:10:00.000Z'),
  });
  assert.equal((await readDraft()).archivedAt, archived.archivedAt);
  await restoreDraft({
    db, draftId, publisherUid, expectedUpdatedAt: archived.archivedAt,
    now: new Date('2026-09-05T11:20:00.000Z'),
  });
  const restored = await readDraft();
  assert.equal(restored.archivedAt, undefined);
  assert.equal(restored.publicationStatus, 'unpublished');
  assert.deepEqual(restored.content, liveDraft.content);
  assert.equal(await loadPublishedArticle(db, 'admin-lifecycle-renamed'), null);

  for (const [release, published] of [[first, firstPublic], [second, secondPublic], [third, thirdPublic]]) {
    assert.equal(db.records.get(`contentReleasePayloads/${release.releaseId}_page`).renderedPageHtml, published.renderedPageHtml);
    assert.equal(db.records.get(`contentReleases/${release.releaseId}`).draftId, draftId);
  }
  const auditActions = new Set([...db.records.entries()]
    .filter(([path, event]) => path.startsWith('contentAuditEvents/') && event.actorUid === publisherUid && event.draftId === draftId)
    .map(([, event]) => event.action));
  for (const action of ['save', 'publish', 'unpublish', 'archive', 'restore']) {
    assert.equal(auditActions.has(action), true, `${action} must retain an Administrator audit event`);
  }
});

test('trash refuses a draft marked live even when its publication index is missing', async () => {
  for (const publicationStatus of ['published', 'published-with-changes']) {
    const record = canonicalDraft({ publicationStatus });
    const db = new FakeDb({
      'studioAccess/administrator-1': { active: true, role: 'administrator' },
      'contentDrafts/draft-1': record,
    });
    await assert.rejects(archiveDraft({
      db, draftId: 'draft-1', publisherUid: 'administrator-1', expectedUpdatedAt: record.updatedAt,
    }), (error) => error.statusCode === 409);
    assert.deepEqual(db.records.get('contentDrafts/draft-1'), record);
  }
});

test('publish rejects a preview receipt after a checkpoint save or template output change', async () => {
  const record = canonicalDraft();
  const db = new FakeDb({
    'studioAccess/publisher-1': { active: true, role: 'publisher' },
    'contentDrafts/draft-1': record,
  });
  const preview = await previewCurrent({ db, record, articleTemplate: articleTemplateV1 });
  await assert.rejects(publishDraft({
    db,
    draftId: 'draft-1',
    expectedUpdatedAt: record.updatedAt,
    expectedRevision: record.revision,
    expectedContentSha256: record.contentSha256,
    previewReceiptId: preview.receiptId,
    idempotencyKey: 'request-template-v2',
    publisherUid: 'publisher-1',
    origin: 'https://aispanda.com',
    articleTemplate: articleTemplateV2,
    now: new Date('2026-08-26T15:00:00.000Z'),
  }), /Preview is out of date/);
  assert.equal([...db.records.keys()].some((key) => key.startsWith('contentReleases/')), false);

  const checkpointDb = new FakeDb({
    'studioAccess/publisher-1': { active: true, role: 'publisher' },
    'contentDrafts/draft-1': record,
  });
  const checkpointPreview = await previewCurrent({ db: checkpointDb, record });
  await saveCanonicalDraft({
    db: checkpointDb,
    draftId: 'draft-1',
    publisherUid: 'publisher-1',
    publisherEmail: 'publisher@example.com',
    draft: canonicalSavePayload(record),
    expectedUpdatedAt: record.updatedAt,
    expectedRevision: record.revision,
    expectedContentSha256: record.contentSha256,
    checkpoint: true,
    now: new Date('2026-08-26T14:45:00.000Z'),
  });
  const checkpointed = checkpointDb.records.get('contentDrafts/draft-1');
  await assert.rejects(publishDraft({
    db: checkpointDb,
    draftId: 'draft-1',
    expectedUpdatedAt: checkpointed.updatedAt,
    expectedRevision: checkpointed.revision,
    expectedContentSha256: checkpointed.contentSha256,
    previewReceiptId: checkpointPreview.receiptId,
    idempotencyKey: 'request-checkpoint-save',
    publisherUid: 'publisher-1',
    origin: 'https://aispanda.com',
    articleTemplate: articleTemplateV1,
    now: new Date('2026-08-26T15:00:00.000Z'),
  }), /Preview is out of date/);
  assert.equal([...checkpointDb.records.keys()].some((key) => key.startsWith('contentReleases/')), false);
});

test('live pages serve validated frozen bytes and slug-changing republish creates a distinct release', async () => {
  const record = canonicalDraft();
  const db = new FakeDb({
    'studioAccess/publisher-1': { active: true, role: 'publisher' },
    'contentDrafts/draft-1': record,
  });
  const first = await publishCurrent({ db, record, articleTemplate: articleTemplateV1 });
  const firstPage = db.records.get(`contentReleasePayloads/${first.releaseId}_page`).renderedPageHtml;
  assert.equal((await loadPublishedArticle(db, 'consulting-rewired')).renderedPageHtml, firstPage);

  const publishedDraft = db.records.get('contentDrafts/draft-1');
  await saveCanonicalDraft({
    db,
    draftId: 'draft-1',
    publisherUid: 'publisher-1',
    publisherEmail: 'publisher@example.com',
    draft: canonicalSavePayload({ ...publishedDraft, slug: 'consulting-rewired-v2' }),
    expectedUpdatedAt: publishedDraft.updatedAt,
    expectedRevision: publishedDraft.revision,
    expectedContentSha256: publishedDraft.contentSha256,
    now: new Date('2026-08-26T15:30:00.000Z'),
  });
  const revised = db.records.get('contentDrafts/draft-1');
  const second = await publishCurrent({
    db,
    record: revised,
    articleTemplate: articleTemplateV2,
    idempotencyKey: 'request-0000000002',
    now: new Date('2026-08-26T16:00:00.000Z'),
  });
  assert.notEqual(second.releaseId, first.releaseId);
  assert.equal(second.liveUrl, 'https://aispanda.com/consulting-rewired-v2');
  assert.equal(await loadPublishedArticle(db, 'consulting-rewired'), null);
  assert.match((await loadPublishedArticle(db, 'consulting-rewired-v2')).renderedPageHtml, /data-template="v2"/);
  assert.equal(db.records.get(`contentReleasePayloads/${first.releaseId}_page`).renderedPageHtml, firstPage);

  db.records.get(`contentReleasePayloads/${second.releaseId}_page`).renderedPageHtml += '<script>tampered()</script>';
  assert.equal(await loadPublishedArticle(db, 'consulting-rewired-v2'), null);
});

test('image assets are draft-bound, published atomically, and made private again on unpublish', async () => {
  const document = imageContentDocument();
  const record = canonicalDraft({ ...canonicalContentFields(document) });
  const db = new FakeDb({
    'studioAccess/publisher-1': { active: true, role: 'publisher' },
    'contentDrafts/draft-1': record,
    [`contentAssets/${imageAssetId}`]: {
      id: imageAssetId,
      draftId: 'draft-1',
      ownerUid: 'author-1',
      status: 'ready',
      objectPath: `studio-content/draft-1/${imageAssetId}.png`,
      generation: '7',
      contentType: 'image/png',
      size: 100,
      width: 640,
      height: 360,
    },
  });
  const published = await publishCurrent({ db, record, idempotencyKey: 'request-image-00001' });

  assert.match(db.records.get(`contentReleasePayloads/${published.releaseId}_body`).bodyHtml, new RegExp(`/content-assets/${imageAssetId}`));
  assert.deepEqual(db.records.get('contentPublicationIndex/draft-1').assetIds, [imageAssetId]);
  assert.equal(db.records.get(`contentAssetPublicRefs/${imageAssetId}`).active, true);
  assert.equal(db.records.get(`contentAssetPublicRefs/${imageAssetId}`).releaseId, published.releaseId);

  await unpublishDraft({
    db,
    draftId: 'draft-1',
    expectedUpdatedAt: published.updatedAt,
    publisherUid: 'publisher-1',
    now: new Date('2026-08-26T16:00:00.000Z'),
  });
  assert.equal(db.records.get(`contentAssetPublicRefs/${imageAssetId}`).active, false);
  assert.equal(db.records.has(`contentAssets/${imageAssetId}`), true);
});

test('save rejects missing, unready, or cross-draft image references without mutation', async () => {
  const record = canonicalDraft();
  for (const assetRecord of [
    undefined,
    { id: imageAssetId, draftId: 'draft-1', status: 'uploading' },
    { id: imageAssetId, draftId: 'other-draft', status: 'ready' },
  ]) {
    const initial = {
      'studioAccess/author-1': { active: true, role: 'author' },
      'contentDrafts/draft-1': record,
      ...(assetRecord ? { [`contentAssets/${imageAssetId}`]: assetRecord } : {}),
    };
    const db = new FakeDb(initial);
    await assert.rejects(saveCanonicalDraft({
      db,
      draftId: 'draft-1',
      publisherUid: 'author-1',
      publisherEmail: record.ownerEmail,
      draft: canonicalSavePayload(record, imageContentDocument()),
      expectedUpdatedAt: record.updatedAt,
      expectedRevision: record.revision,
      expectedContentSha256: record.contentSha256,
    }), /unavailable or does not belong/);
    assert.deepEqual(db.records.get('contentDrafts/draft-1'), record);
  }
});

test('publication rejects unauthorized, stale and duplicate-slug requests without changing the draft', async () => {
  const initialDraft = canonicalDraft();
  const unauthorizedDb = new FakeDb({
    'studioAccess/author-1': { active: true, role: 'author' },
    'contentDrafts/draft-1': initialDraft,
  });
  const authorPreview = await previewCurrent({ db: unauthorizedDb, record: initialDraft, publisherUid: 'author-1' });
  await assert.rejects(
    publishDraft({
      db: unauthorizedDb,
      draftId: 'draft-1',
      expectedUpdatedAt: initialDraft.updatedAt,
      expectedRevision: initialDraft.revision,
      expectedContentSha256: initialDraft.contentSha256,
      previewReceiptId: authorPreview.receiptId,
      idempotencyKey: 'request-unauthorized',
      publisherUid: 'author-1',
      origin: 'https://aispanda.com',
      articleTemplate: articleTemplateV1,
    }),
    /Publisher or Administrator/,
  );

  const staleDb = new FakeDb({
    'studioAccess/publisher-1': { active: true, role: 'publisher' },
    'contentDrafts/draft-1': initialDraft,
  });
  const stalePreview = await previewCurrent({ db: staleDb, record: initialDraft });
  await assert.rejects(
    publishDraft({
      db: staleDb,
      draftId: 'draft-1',
      expectedUpdatedAt: '2026-08-26T13:00:00.000Z',
      expectedRevision: initialDraft.revision,
      expectedContentSha256: initialDraft.contentSha256,
      previewReceiptId: stalePreview.receiptId,
      idempotencyKey: 'request-stale-0001',
      publisherUid: 'publisher-1',
      origin: 'https://aispanda.com',
      articleTemplate: articleTemplateV1,
    }),
    /Preview is out of date/,
  );

  const duplicateDb = new FakeDb({
    'studioAccess/publisher-1': { active: true, role: 'publisher' },
    'contentDrafts/draft-1': initialDraft,
    'publishedContent/consulting-rewired': { draftId: 'another-draft', slug: 'consulting-rewired' },
  });
  await assert.rejects(
    previewCurrent({ db: duplicateDb, record: initialDraft }),
    /already uses/,
  );
  for (const database of [unauthorizedDb, staleDb, duplicateDb]) {
    assert.deepEqual(database.records.get('contentDrafts/draft-1'), initialDraft);
    assert.equal([...database.records.keys()].some((key) => key.startsWith('contentReleases/')), false);
  }

  const receiptDb = new FakeDb({
    'studioAccess/publisher-1': { active: true, role: 'publisher' },
    'contentDrafts/draft-1': initialDraft,
  });
  const validReceipt = await previewCurrent({ db: receiptDb, record: initialDraft });
  const unavailableDb = new FakeDb();
  unavailableDb.runTransaction = async () => { throw new Error('database details must not enter the audit record'); };
  await assert.rejects(
    publishDraft({
      db: unavailableDb,
      draftId: 'draft-1',
      expectedUpdatedAt: initialDraft.updatedAt,
      expectedRevision: initialDraft.revision,
      expectedContentSha256: initialDraft.contentSha256,
      previewReceiptId: validReceipt.receiptId,
      idempotencyKey: 'request-internal-001',
      publisherUid: 'publisher-1',
      origin: 'https://aispanda.com',
      articleTemplate: articleTemplateV1,
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

test('preview is authoritative and archiving cannot orphan a live article', async () => {
  const previewRecord = canonicalDraft();
  const previewDb = new FakeDb({
    'studioAccess/author-1': { active: true, role: 'author' },
    'contentDrafts/draft-1': previewRecord,
  });
  const preview = await previewCurrent({ db: previewDb, record: previewRecord, publisherUid: 'author-1' });
  assert.equal(preview.mode, 'preview');
  assert.match(preview.html, /<article><p>Useful article\.<\/p><\/article>/);
  assert.equal(preview.snapshotSha256.length, 64);
  assert.equal([...previewDb.records.values()].some((value) => value?.snapshotSha256 === preview.snapshotSha256), true);

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

  const editableRecord = canonicalDraft();
  const draftDb = new FakeDb({
    'studioAccess/author-1': { active: true, role: 'author' },
    'studioAccess/publisher-1': { active: true, role: 'publisher' },
    'contentDrafts/draft-1': editableRecord,
  });
  const preArchivePreview = await previewCurrent({ db: draftDb, record: editableRecord, publisherUid: 'publisher-1' });
  const archived = await archiveDraft({
    db: draftDb,
    draftId: 'draft-1',
    expectedUpdatedAt: editableRecord.updatedAt,
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
      expectedRevision: editableRecord.revision,
      expectedContentSha256: editableRecord.contentSha256,
      previewReceiptId: preArchivePreview.receiptId,
      idempotencyKey: 'request-archived-001',
      publisherUid: 'publisher-1',
      origin: 'https://aispanda.com',
      articleTemplate: articleTemplateV1,
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
    ...validateDraftForPublication(canonicalDraft({ title: 'Consulting & AI' })),
    draftId: 'draft-1',
    liveUrl: 'https://attacker.example/consulting-rewired',
  }, 'https://aispanda.com');
  assert.match(html, /<title>Consulting &amp; AI<\/title>/);
  assert.match(html, /href="https:\/\/aispanda.com\/consulting-rewired"/);
  assert.match(html, /<main><p>Useful article\.<\/p><\/main>/);
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

test('Studio cloud contract prevents local article storage and all direct browser draft mutations', async () => {
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
  assert.equal(backend.includes('runTransaction'), false);
  assert.equal(backend.includes('generateJSON'), false);
  assert.equal(backend.includes('generateHTML'), false);
  assert.match(backend, /previewDraft:/);
  assert.match(backend, /contentRequest<\{ updatedAt: string; revision: number; contentSha256: string \}>\(id, 'save'/);
  assert.match(backend, /contentRequest<\{ updatedAt: string; revision: number; contentSha256: string \}>\(id, 'migrate'/);
  assert.match(studio, /data-filter="archived"/);
  assert.match(studio, /studioBackend\.restoreDraft\(item\.id, state\.updatedAt\)/);
  assert.match(studio, /This draft is in trash\. Restore it before editing\./);
  assert.match(studio, /class="studio-mobile-nav"/);
  assert.match(backend, /querySelectorAll<HTMLButtonElement>\('\[data-studio-signout\]'\)/);
  assert.match(studio, /studioBackend\.previewDocument\(draftId\)/);
  assert.match(studio, /title="Production-style article preview" sandbox referrerpolicy/);
  assert.match(studio, /role="status" data-publish-readiness/);
  assert.match(studio, /role="alert" tabindex="-1" data-publish-error/);
  assert.match(studio, /publicationPreviewReceiptId/);
  assert.match(server, /contentRoute\.action === 'preview-document'/);
  assert.match(server, /contentRoute\.action === 'save' \|\| contentRoute\.action === 'migrate'/);
  assert.match(server, /readJson\(request, usesContentPayload \? CONTENT_JSON_LIMIT : JSON_LIMIT\)/);
  assert.match(studio, /\['https:', 'http:', 'mailto:'\]/);
  assert.match(studio, /In trash · restore to edit/);
  assert.match(rules, /match \/contentDrafts\/\{draftId\}[\s\S]*allow create, update, delete: if false;/);
  assert.match(studio, /data-migrate-draft/);
  assert.match(studio, /Legacy draft · convert before editing/);
  assert.match(studio, /new Editor\(\{/);
  assert.match(studio, /tiptapEditor\?\.getJSON\(\)/);
  assert.match(studio, /readDocumentState\(item\)\?\.contentFormat !== 'legacy'/);
  assert.match(studio, /Convert this legacy draft before duplicating it/);
  assert.equal(studio.includes('initialSeedHtml'), false);
  assert.match(studio, /if \(isLibraryLanding\) \{/);
  assert.match(server, /SITE_ORIGIN/);
  assert.match(insights, /AISPANDA_DYNAMIC_INSIGHTS/);
});

test('production image packages and verifies the shared Studio schema', async () => {
  const dockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');
  const schemaCopy = 'COPY --from=build /app/src/scripts/studio-tiptap-schema.mjs ./src/scripts/studio-tiptap-schema.mjs';
  const importCheck = 'RUN node --input-type=module --eval "await import(\'./server/studio-content-document.mjs\')"';

  assert.equal(dockerfile.includes(schemaCopy), true);
  assert.equal(dockerfile.includes(importCheck), true);
  assert.ok(dockerfile.indexOf(schemaCopy) < dockerfile.indexOf(importCheck));
});
