import sanitizeHtml from 'sanitize-html';

import {
  StudioContentError,
  assertContentDocument,
  canonicalContentFields,
  contentAssetIds,
  migrateLegacyHtml,
  resolveStoredDraftContent,
  sha256,
  stableJson,
} from './studio-content-document.mjs';
import { assertDraftAssetsReady } from './studio-content-assets.mjs';

const TITLE_LIMIT = 300;
const EXCERPT_LIMIT = 2_000;
const TAGS_LIMIT = 1_000;
const SLUG_LIMIT = 90;
const RELEASE_PAYLOAD_LIMIT = 900_000;

const PUBLICATION_VERSION_V1 = Object.freeze({
  snapshotVersion: 'ai-91-publication-v1',
  rendererVersion: 'tiptap-html-3.30.3-ai-91-v1',
  sanitizerVersion: 'sanitize-html-2.17.7-ai-91-v1',
  templateVersion: 'article-shell-ai-91-v1',
});

// New writers add a tuple and become active; prior readers remain registered so
// immutable releases do not disappear when the editor or renderer evolves.
export const SUPPORTED_PUBLICATION_VERSION_TUPLES = Object.freeze([PUBLICATION_VERSION_V1]);
const ACTIVE_PUBLICATION_VERSION = PUBLICATION_VERSION_V1;
export const PUBLICATION_SNAPSHOT_VERSION = ACTIVE_PUBLICATION_VERSION.snapshotVersion;
export const PUBLICATION_RENDERER_VERSION = ACTIVE_PUBLICATION_VERSION.rendererVersion;
export const PUBLICATION_SANITIZER_VERSION = ACTIVE_PUBLICATION_VERSION.sanitizerVersion;
export const PUBLICATION_TEMPLATE_VERSION = ACTIVE_PUBLICATION_VERSION.templateVersion;

const reservedSlugs = new Set([
  '404', 'about', 'account', 'ai', 'api', 'assets', 'contact', 'insights',
  'article-shell-internal', 'labs', 'open-the-ai', 'principles', 'privacy', 'sitemap', 'studio',
  'support-form-demo', 'support-workspace',
]);

const fail = (message, statusCode = 400) => {
  throw Object.assign(new Error(message), { statusCode });
};

export const escapeHtml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

export const normalizeSlug = (value) => String(value ?? '')
  .toLowerCase()
  .trim()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, SLUG_LIMIT);

const stripLeadingDuplicateTitle = (body, title) => body.replace(
  /^\s*<h1(?:\s[^>]*)?>([\s\S]*?)<\/h1>/i,
  (match, inner) => {
    const heading = sanitizeHtml(inner, { allowedTags: [], allowedAttributes: {} }).trim();
    return heading === title.trim() ? '' : `<h2>${inner}</h2>`;
  },
);

export const sanitizeArticleBody = (body, title = '') => sanitizeHtml(
  stripLeadingDuplicateTitle(String(body ?? ''), String(title ?? '')),
  {
    allowedTags: [
      'p', 'h2', 'h3', 'strong', 'em', 'ul', 'ol', 'li', 'blockquote',
      'hr', 'br', 'a', 'code', 'pre', 'aside', 'table', 'caption', 'thead',
      'tbody', 'tr', 'th', 'td', 'figure', 'img', 'figcaption',
    ],
    allowedAttributes: {
      a: ['href', 'title', 'rel'],
      aside: ['class'],
      th: ['colspan', 'rowspan', 'scope'],
      td: ['colspan', 'rowspan'],
      figure: ['data-studio-image', 'data-asset-id', 'data-decorative'],
      img: ['src', 'alt', 'loading', 'decoding'],
    },
    allowedClasses: {
      aside: ['studio-callout'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false,
    transformTags: {
      a: (_tagName, attributes) => ({
        tagName: 'a',
        attribs: {
          ...(attributes.href ? { href: attributes.href } : {}),
          ...(attributes.title ? { title: attributes.title } : {}),
          rel: 'nofollow noopener noreferrer',
        },
      }),
      img: (_tagName, attributes) => /^\/content-assets\/[a-f0-9-]{36}$/.test(String(attributes.src ?? ''))
        ? {
          tagName: 'img',
          attribs: {
            src: attributes.src,
            alt: String(attributes.alt ?? ''),
            loading: 'lazy',
            decoding: 'async',
          },
        }
        : { tagName: 'span', attribs: {} },
    },
  },
).trim();

const validIsoDate = (value) => typeof value === 'string'
  && value.length <= 40
  && Number.isFinite(Date.parse(value));

const normalizeTags = (value) => String(value ?? '')
  .split(',')
  .map((tag) => tag.trim())
  .filter(Boolean)
  .slice(0, 30);

const CANONICAL_SAVE_KEYS = new Set([
  'title', 'excerpt', 'slug', 'tags',
  'format', 'schemaVersion', 'registryVersion', 'content',
]);

const CONTENT_MUTATION_REQUEST_KEYS = {
  save: new Set(['draft', 'expectedUpdatedAt', 'expectedRevision', 'expectedContentSha256', 'checkpoint']),
  migrate: new Set(['expectedUpdatedAt', 'expectedRevision', 'expectedSourceSha256']),
};

export const assertContentMutationRequest = (action, body) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('A JSON request object is required.');
  const allowed = CONTENT_MUTATION_REQUEST_KEYS[action];
  if (!allowed) fail('Unsupported content mutation request.');
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) fail(`Request field ${key} is not allowed.`);
  }
  return body;
};

const normalizeCanonicalSaveInput = (input) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('A governed draft payload is required.');
  for (const key of Object.keys(input)) {
    if (!CANONICAL_SAVE_KEYS.has(key)) fail(`Draft field ${key} is server-owned and cannot be supplied.`);
  }
  for (const key of CANONICAL_SAVE_KEYS) {
    if (!(key in input)) fail(`Draft field ${key} is required.`);
  }
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const excerpt = typeof input.excerpt === 'string' ? input.excerpt.trim() : '';
  const tags = typeof input.tags === 'string' ? input.tags.trim() : '';
  const slug = typeof input.slug === 'string' ? input.slug : '';
  if (title.length > TITLE_LIMIT) fail('The article title is too long.');
  if (excerpt.length > EXCERPT_LIMIT) fail('The article excerpt is too long.');
  if (tags.length > TAGS_LIMIT) fail('The article tags are too long.');
  if (slug.length > SLUG_LIMIT || (slug && normalizeSlug(slug) !== slug)) fail('Choose a valid URL slug.');
  let document;
  try {
    document = assertContentDocument({
      format: input.format,
      schemaVersion: input.schemaVersion,
      registryVersion: input.registryVersion,
      content: input.content,
    });
  } catch (error) {
    fail(error instanceof StudioContentError ? error.message : 'The article body is not valid governed content.');
  }
  return { title, excerpt, slug, tags, document };
};

const validateCanonicalDraftForPublication = (draft) => {
  if (!draft || typeof draft !== 'object') fail('The cloud draft is unavailable.', 404);
  const title = typeof draft.title === 'string' ? draft.title.trim() : '';
  const excerpt = typeof draft.excerpt === 'string' ? draft.excerpt.trim() : '';
  const tagsText = typeof draft.tags === 'string' ? draft.tags.trim() : '';
  const slug = normalizeSlug(draft.slug);

  if (!title || title.length > TITLE_LIMIT) fail('Add a valid article title before publishing.');
  if (excerpt.length > EXCERPT_LIMIT) fail('The article excerpt is too long.');
  if (tagsText.length > TAGS_LIMIT) fail('The article tags are too long.');
  if (!slug || slug !== draft.slug || slug.length > SLUG_LIMIT) fail('Choose a valid URL slug before publishing.');
  if (reservedSlugs.has(slug)) fail('That URL slug is reserved by the site.', 409);
  if (!validIsoDate(draft.updatedAt)) fail('The cloud draft has an invalid revision timestamp.');

  if (draft.format !== 'tiptap-json') {
    fail('Convert this legacy draft to the professional editor before previewing or publishing.', 409);
  }
  let bodyHtml;
  let assetIds;
  let sourceDocument;
  let contentSha256;
  try {
    const resolved = resolveStoredDraftContent(draft);
    bodyHtml = sanitizeArticleBody(resolved.renderedHtml, title);
    assetIds = contentAssetIds(resolved.document);
    sourceDocument = resolved.document;
    contentSha256 = resolved.contentSha256;
  } catch (error) {
    fail(error instanceof StudioContentError ? error.message : 'Add valid governed article content before publishing.');
  }
  const bodyText = sanitizeHtml(bodyHtml, { allowedTags: [], allowedAttributes: {} }).trim();
  if (!bodyText) fail('The article does not contain publishable text.');

  return {
    title,
    bodyHtml,
    excerpt,
    slug,
    tags: normalizeTags(tagsText),
    sourceUpdatedAt: draft.updatedAt,
    sourceRevision: draft.revision,
    sourceDocument,
    contentSha256,
    assetIds,
    readMinutes: Math.max(1, Math.ceil((bodyText.match(/\S+/g) ?? []).length / 225)),
  };
};

export const validateDraftForPublication = (draft) => validateCanonicalDraftForPublication(draft);
export const validateDraftForPreview = (draft) => validateCanonicalDraftForPublication(draft);

const assertExpectedRevision = (draft, expectedUpdatedAt) => {
  if (!validIsoDate(expectedUpdatedAt) || draft.updatedAt !== expectedUpdatedAt) {
    fail('This draft changed after the publication review opened. Reload it and review the latest version.', 409);
  }
};

const assertPublisher = (access) => {
  if (!access || access.active !== true || !['administrator', 'publisher'].includes(access.role)) {
    fail('Publisher or Administrator access is required.', 403);
  }
};

const assertEditor = (access) => {
  if (!access || access.active !== true || !['administrator', 'publisher', 'author'].includes(access.role)) {
    fail('Author, Publisher or Administrator access is required.', 403);
  }
};

const assertDraftEditor = (access, draft, uid) => {
  assertEditor(access);
  if (access.role === 'author' && draft.ownerUid !== uid) fail('Authors can edit only drafts they own.', 403);
};

const transactionDocument = async (transaction, reference) => {
  const snapshot = await transaction.get(reference);
  return snapshot.exists ? snapshot.data() : null;
};

const recordMutationFailure = async ({ db, action, publisherUid, draftId, occurredAt, error }) => {
  const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
  const reason = statusCode === 500
    ? 'Internal content mutation error.'
    : String(error?.message ?? 'Content mutation rejected.').slice(0, 300);
  const event = {
    action: `${action}_failed`,
    actorUid: publisherUid,
    draftId,
    statusCode,
    reason,
    occurredAt,
  };
  try {
    await db.collection('contentAuditEvents').doc().set(event);
  } catch {
    console.error('Failed content mutation could not be persisted to the audit collection.', {
      action: event.action,
      actorUid: publisherUid,
      draftId,
      statusCode,
      occurredAt,
    });
  }
};

export const withContentFailureAudit = async (details, operation) => {
  try {
    return await operation();
  } catch (error) {
    await recordMutationFailure({ ...details, error });
    throw error;
  }
};

const assertCanonicalStaleEvidence = ({ current, expectedUpdatedAt, expectedRevision, expectedContentSha256 }) => {
  if (!validIsoDate(expectedUpdatedAt) || current.updatedAt !== expectedUpdatedAt) {
    fail('This draft changed in another session. Reload before saving.', 409);
  }
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1 || current.revision !== expectedRevision) {
    fail('This draft revision is stale. Reload before saving.', 409);
  }
  if (!/^[a-f0-9]{64}$/.test(String(expectedContentSha256 ?? '')) || current.contentSha256 !== expectedContentSha256) {
    fail('This draft content changed in another session. Reload before saving.', 409);
  }
};

const owns = (value, key) => value != null && Object.prototype.hasOwnProperty.call(value, key);
const LEGACY_PROVENANCE_FIELDS = ['legacyHtmlOriginal', 'legacyHtmlSha256', 'migrationReport'];
const MIGRATION_REPORT_KEYS = new Set([
  'status', 'schemaVersion', 'registryVersion', 'sourceSha256', 'contentSha256',
  'titleOriginal', 'titleSha256', 'migratedAt', 'migratedBy',
]);
const LEGACY_STORED_KEYS = new Set([
  'title', 'body', 'excerpt', 'slug', 'tags', 'publicationStatus', 'updatedAt',
  'revision', 'revisions', 'ownerUid', 'ownerEmail', 'publicationReleaseId',
  'publicationLiveUrl', 'archivedAt', 'archivedBy',
]);
const CANONICAL_STORED_KEYS = new Set([
  'title', 'format', 'schemaVersion', 'registryVersion', 'content', 'contentSha256',
  'excerpt', 'slug', 'tags', 'publicationStatus', 'updatedAt', 'revision', 'revisions',
  'ownerUid', 'ownerEmail', 'publicationReleaseId', 'publicationLiveUrl',
  'legacyHtmlOriginal', 'legacyHtmlSha256', 'migrationReport', 'archivedAt', 'archivedBy',
]);

const assertStoredDraftEnvelope = (draft, { canonical }) => {
  const allowedKeys = canonical ? CANONICAL_STORED_KEYS : LEGACY_STORED_KEYS;
  const unknownKey = Object.keys(draft).find((key) => !allowedKeys.has(key));
  if (unknownKey) fail(`The stored draft contains unknown field ${unknownKey} and requires Administrator review.`, 409);
  if (typeof draft.title !== 'string' || draft.title.length > TITLE_LIMIT) fail('The stored draft title is invalid.', 409);
  if (typeof draft.excerpt !== 'string' || draft.excerpt.length > EXCERPT_LIMIT) fail('The stored draft excerpt is invalid.', 409);
  if (typeof draft.slug !== 'string' || draft.slug.length > SLUG_LIMIT) fail('The stored draft slug is invalid.', 409);
  if (typeof draft.tags !== 'string' || draft.tags.length > TAGS_LIMIT) fail('The stored draft tags are invalid.', 409);
  if (!validIsoDate(draft.updatedAt)) fail('The stored draft revision timestamp is invalid.', 409);
  if (typeof draft.ownerUid !== 'string' || !draft.ownerUid || draft.ownerUid.length > 128) fail('The stored draft owner is invalid.', 409);
  if (typeof draft.ownerEmail !== 'string' || !draft.ownerEmail || draft.ownerEmail.length > 320) fail('The stored draft owner email is invalid.', 409);
  if (!['draft', 'published', 'published-with-changes', 'unpublished'].includes(draft.publicationStatus)) {
    fail('The stored publication status is invalid.', 409);
  }
  if (
    !Array.isArray(draft.revisions)
    || draft.revisions.length > 20
    || draft.revisions.some((revision) => (
      !revision
      || typeof revision !== 'object'
      || Array.isArray(revision)
      || Object.keys(revision).some((key) => !['savedAt', 'title'].includes(key))
      || !validIsoDate(revision.savedAt)
      || typeof revision.title !== 'string'
      || revision.title.length > TITLE_LIMIT
    ))
  ) fail('The stored checkpoint history is invalid.', 409);
  if (draft.publicationReleaseId !== undefined && typeof draft.publicationReleaseId !== 'string') fail('The stored release pointer is invalid.', 409);
  if (draft.publicationLiveUrl !== undefined && typeof draft.publicationLiveUrl !== 'string') fail('The stored publication URL is invalid.', 409);
  if (canonical) {
    if (owns(draft, 'body')) fail('The stored draft mixes canonical and legacy content.', 409);
    if (!Number.isInteger(draft.revision) || draft.revision < 1) fail('The stored canonical revision is invalid.', 409);
  } else if (draft.revision !== undefined && (!Number.isInteger(draft.revision) || draft.revision < 0)) {
    fail('The stored legacy revision is invalid.', 409);
  }
};

const assertLegacyDraftRecord = (draft) => {
  assertStoredDraftEnvelope(draft, { canonical: false });
  if (owns(draft, 'format') || owns(draft, 'schemaVersion') || owns(draft, 'registryVersion') || owns(draft, 'content') || owns(draft, 'contentSha256')) {
    fail('This draft has an unknown or mixed content format and requires Administrator review.', 409);
  }
  if (LEGACY_PROVENANCE_FIELDS.some((field) => owns(draft, field))) {
    fail('This legacy draft already contains provenance metadata and requires Administrator review.', 409);
  }
  if (typeof draft.body !== 'string') fail('This legacy draft has no recoverable HTML source.', 409);
};

const preservedMigrationFields = (draft) => {
  const present = LEGACY_PROVENANCE_FIELDS.filter((field) => owns(draft, field));
  if (!present.length) return {};
  if (
    present.length !== LEGACY_PROVENANCE_FIELDS.length
    || typeof draft.legacyHtmlOriginal !== 'string'
    || !/^[a-f0-9]{64}$/.test(String(draft.legacyHtmlSha256 ?? ''))
    || sha256(draft.legacyHtmlOriginal) !== draft.legacyHtmlSha256
    || !draft.migrationReport
    || typeof draft.migrationReport !== 'object'
    || Array.isArray(draft.migrationReport)
  ) {
    fail('The preserved legacy source is inconsistent and requires Administrator review.', 409);
  }
  const report = draft.migrationReport;
  if (
    Object.keys(report).some((key) => !MIGRATION_REPORT_KEYS.has(key))
    || [...MIGRATION_REPORT_KEYS].some((key) => !owns(report, key))
    || report.status !== 'compatible'
    || report.schemaVersion !== draft.schemaVersion
    || report.registryVersion !== draft.registryVersion
    || report.sourceSha256 !== draft.legacyHtmlSha256
    || !/^[a-f0-9]{64}$/.test(String(report.contentSha256 ?? ''))
    || typeof report.titleOriginal !== 'string'
    || report.titleOriginal.length > TITLE_LIMIT
    || !/^[a-f0-9]{64}$/.test(String(report.titleSha256 ?? ''))
    || sha256(report.titleOriginal) !== report.titleSha256
    || !validIsoDate(report.migratedAt)
    || typeof report.migratedBy !== 'string'
    || !report.migratedBy
    || report.migratedBy.length > 128
  ) {
    fail('The preserved legacy migration report is inconsistent and requires Administrator review.', 409);
  }
  let migrationOutputSha256;
  try {
    migrationOutputSha256 = canonicalContentFields(migrateLegacyHtml({
      html: draft.legacyHtmlOriginal,
      title: report.titleOriginal,
    }).document).contentSha256;
  } catch {
    fail('The preserved legacy migration evidence cannot be reproduced and requires Administrator review.', 409);
  }
  if (migrationOutputSha256 !== report.contentSha256) {
    fail('The preserved legacy migration output hash is inconsistent and requires Administrator review.', 409);
  }
  return {
    legacyHtmlOriginal: draft.legacyHtmlOriginal,
    legacyHtmlSha256: draft.legacyHtmlSha256,
    migrationReport: draft.migrationReport,
  };
};

const baseServerOwnedDraft = ({ current, publisherUid, publisherEmail }) => ({
  ownerUid: current ? current.ownerUid : publisherUid,
  ownerEmail: current ? current.ownerEmail : String(publisherEmail ?? ''),
  publicationStatus: current?.publicationStatus ?? 'draft',
  publicationReleaseId: current?.publicationReleaseId ?? '',
  publicationLiveUrl: current?.publicationLiveUrl ?? '',
  revisions: Array.isArray(current?.revisions) ? current.revisions.slice(-20) : [],
});

export const saveCanonicalDraft = async ({
  db,
  draftId,
  publisherUid,
  publisherEmail,
  draft: requestedDraft,
  expectedUpdatedAt,
  expectedRevision,
  expectedContentSha256,
  checkpoint = false,
  now = new Date(),
}) => {
  const occurredAt = now.toISOString();
  return withContentFailureAudit({ db, action: 'save', publisherUid, draftId, occurredAt }, async () => {
    if (checkpoint !== false && checkpoint !== true) fail('Checkpoint must be true or false.');
    const input = normalizeCanonicalSaveInput(requestedDraft);
    const requestedAssetIds = contentAssetIds(input.document);
    const accessRef = db.collection('studioAccess').doc(publisherUid);
    const draftRef = db.collection('contentDrafts').doc(draftId);
    const auditRef = db.collection('contentAuditEvents').doc();

    return db.runTransaction(async (transaction) => {
      const [access, current] = await Promise.all([
        transactionDocument(transaction, accessRef),
        transactionDocument(transaction, draftRef),
      ]);
      assertEditor(access);
      if (current) {
        assertDraftEditor(access, current, publisherUid);
        if (current.archivedAt) fail('This draft is archived and must be restored before editing.', 409);
        if (current.format !== 'tiptap-json') fail('Migrate this legacy draft before saving structured edits.', 409);
        assertStoredDraftEnvelope(current, { canonical: true });
        try {
          resolveStoredDraftContent(current);
        } catch (error) {
          fail(error instanceof StudioContentError ? error.message : 'The governed draft content is inconsistent.', 409);
        }
        assertCanonicalStaleEvidence({ current, expectedUpdatedAt, expectedRevision, expectedContentSha256 });
      } else if (
        expectedUpdatedAt !== undefined
        || expectedRevision !== 0
        || !['', undefined].includes(expectedContentSha256)
      ) {
        fail('New drafts must start from revision zero without stale draft metadata.', 409);
      }
      if (!current && !String(publisherEmail ?? '').trim()) {
        fail('A verified account email is required to create a draft.', 403);
      }
      await assertDraftAssetsReady({ db, transaction, draftId, assetIds: requestedAssetIds });

      const canonical = canonicalContentFields(input.document);
      const revision = (current?.revision ?? 0) + 1;
      const serverOwned = baseServerOwnedDraft({ current, publisherUid, publisherEmail });
      const changed = !current
        || current.contentSha256 !== canonical.contentSha256
        || current.title !== input.title
        || current.excerpt !== input.excerpt
        || current.slug !== input.slug
        || current.tags !== input.tags;
      const publicationStatus = changed && serverOwned.publicationStatus === 'published'
        ? 'published-with-changes'
        : serverOwned.publicationStatus;
      const revisions = checkpoint
        ? [...serverOwned.revisions, { savedAt: occurredAt, title: input.title || 'Untitled article' }].slice(-20)
        : serverOwned.revisions;
      const stored = {
        title: input.title,
        ...canonical,
        excerpt: input.excerpt,
        slug: input.slug,
        tags: input.tags,
        publicationStatus,
        updatedAt: occurredAt,
        revision,
        revisions,
        ownerUid: serverOwned.ownerUid,
        ownerEmail: serverOwned.ownerEmail,
        publicationReleaseId: serverOwned.publicationReleaseId,
        publicationLiveUrl: serverOwned.publicationLiveUrl,
        ...preservedMigrationFields(current),
      };
      if (current) transaction.set(draftRef, stored);
      else transaction.create(draftRef, stored);
      transaction.create(auditRef, {
        action: 'save', actorUid: publisherUid, draftId, revision, checkpoint, occurredAt,
      });
      return { updatedAt: occurredAt, revision, contentSha256: canonical.contentSha256 };
    });
  });
};

export const migrateLegacyDraft = async ({
  db,
  draftId,
  publisherUid,
  expectedUpdatedAt,
  expectedRevision,
  expectedSourceSha256,
  now = new Date(),
}) => {
  const occurredAt = now.toISOString();
  return withContentFailureAudit({ db, action: 'migrate', publisherUid, draftId, occurredAt }, async () => {
    const accessRef = db.collection('studioAccess').doc(publisherUid);
    const draftRef = db.collection('contentDrafts').doc(draftId);
    const auditRef = db.collection('contentAuditEvents').doc();
    return db.runTransaction(async (transaction) => {
      const [access, current] = await Promise.all([
        transactionDocument(transaction, accessRef),
        transactionDocument(transaction, draftRef),
      ]);
      if (!current) fail('The cloud draft is unavailable.', 404);
      assertDraftEditor(access, current, publisherUid);
      if (current.archivedAt) fail('This draft is archived and must be restored before migration.', 409);
      if (current.format === 'tiptap-json') fail('This draft is already using the governed editor format.', 409);
      assertLegacyDraftRecord(current);
      if (!validIsoDate(expectedUpdatedAt) || current.updatedAt !== expectedUpdatedAt) {
        fail('This draft changed in another session. Reload before migration.', 409);
      }
      const currentRevision = Number.isInteger(current.revision) ? current.revision : 0;
      if (expectedRevision !== currentRevision) fail('This draft revision is stale. Reload before migration.', 409);
      const sourceSha256 = sha256(current.body);
      if (!/^[a-f0-9]{64}$/.test(String(expectedSourceSha256 ?? '')) || sourceSha256 !== expectedSourceSha256) {
        fail('The legacy source changed. Reload before migration.', 409);
      }

      let migrated;
      try {
        migrated = migrateLegacyHtml({ html: current.body, title: current.title });
      } catch (error) {
        if (error instanceof StudioContentError) {
          error.statusCode = 409;
          error.message = `${error.message} Original preserved; nothing saved.`;
        }
        throw error;
      }
      const canonical = canonicalContentFields(migrated.document);
      const revision = currentRevision + 1;
      const serverOwned = baseServerOwnedDraft({ current, publisherUid, publisherEmail: current.ownerEmail });
      const stored = {
        title: typeof current.title === 'string' ? current.title : '',
        ...canonical,
        excerpt: typeof current.excerpt === 'string' ? current.excerpt : '',
        slug: typeof current.slug === 'string' ? current.slug : '',
        tags: typeof current.tags === 'string' ? current.tags : '',
        publicationStatus: serverOwned.publicationStatus,
        updatedAt: occurredAt,
        revision,
        revisions: serverOwned.revisions,
        ownerUid: serverOwned.ownerUid,
        ownerEmail: serverOwned.ownerEmail,
        publicationReleaseId: serverOwned.publicationReleaseId,
        publicationLiveUrl: serverOwned.publicationLiveUrl,
        legacyHtmlOriginal: current.body,
        legacyHtmlSha256: sourceSha256,
        migrationReport: {
          status: 'compatible',
          schemaVersion: migrated.report.schemaVersion,
          registryVersion: migrated.report.registryVersion,
          sourceSha256,
          contentSha256: canonical.contentSha256,
          titleOriginal: current.title,
          titleSha256: sha256(current.title),
          migratedAt: occurredAt,
          migratedBy: publisherUid,
        },
      };
      transaction.set(draftRef, stored);
      transaction.create(auditRef, {
        action: 'migrate', actorUid: publisherUid, draftId, revision,
        sourceSha256, contentSha256: canonical.contentSha256, occurredAt,
      });
      return {
        status: 'compatible',
        originalPreserved: true,
        updatedAt: occurredAt,
        revision,
        sourceSha256,
        contentSha256: canonical.contentSha256,
      };
    });
  });
};

const utf8Size = (value) => Buffer.byteLength(String(value), 'utf8');

const assertReleasePayloadSize = (value, label) => {
  const size = utf8Size(value);
  if (size > RELEASE_PAYLOAD_LIMIT) fail(`The ${label} is too large for an immutable release.`, 413);
  return size;
};

const publicationSnapshotHashInput = (snapshot) => ({
  snapshotVersion: snapshot.snapshotVersion,
  rendererVersion: snapshot.rendererVersion,
  sanitizerVersion: snapshot.sanitizerVersion,
  templateVersion: snapshot.templateVersion,
  templateSha256: snapshot.templateSha256,
  draftId: snapshot.draftId,
  title: snapshot.title,
  excerpt: snapshot.excerpt,
  slug: snapshot.slug,
  tags: snapshot.tags,
  readMinutes: snapshot.readMinutes,
  sourceUpdatedAt: snapshot.sourceUpdatedAt,
  sourceRevision: snapshot.sourceRevision,
  sourceJson: snapshot.sourceJson,
  contentSha256: snapshot.contentSha256,
  bodyHtml: snapshot.bodyHtml,
  bodyHtmlSha256: snapshot.bodyHtmlSha256,
  renderedPageSha256: snapshot.renderedPageSha256,
  assetIds: snapshot.assetIds,
});

export const buildPublicationSnapshot = ({ draft, draftId, articleTemplate, origin }) => {
  if (typeof articleTemplate !== 'string' || !articleTemplate.includes('@@AISPANDA_ARTICLE_BODY@@')) {
    fail('The governed article template is unavailable.', 503);
  }
  const article = validateCanonicalDraftForPublication(draft);
  if (!Number.isInteger(article.sourceRevision) || article.sourceRevision < 1) {
    fail('The cloud draft has an invalid revision number.', 409);
  }
  const sourceJson = structuredClone(article.sourceDocument);
  const templateSha256 = sha256(articleTemplate);
  const bodyHtmlSha256 = sha256(article.bodyHtml);
  const renderedPageHtml = renderPublishedArticle(articleTemplate, { ...article, draftId }, origin);
  const renderedPageSha256 = sha256(renderedPageHtml);
  const snapshot = {
    snapshotVersion: PUBLICATION_SNAPSHOT_VERSION,
    rendererVersion: PUBLICATION_RENDERER_VERSION,
    sanitizerVersion: PUBLICATION_SANITIZER_VERSION,
    templateVersion: PUBLICATION_TEMPLATE_VERSION,
    templateSha256,
    draftId,
    title: article.title,
    excerpt: article.excerpt,
    slug: article.slug,
    tags: article.tags,
    readMinutes: article.readMinutes,
    sourceUpdatedAt: article.sourceUpdatedAt,
    sourceRevision: article.sourceRevision,
    sourceJson,
    contentSha256: article.contentSha256,
    bodyHtml: article.bodyHtml,
    bodyHtmlSha256,
    renderedPageHtml,
    renderedPageSha256,
    assetIds: article.assetIds,
  };
  snapshot.sourceBytes = assertReleasePayloadSize(stableJson(sourceJson), 'structured article source');
  snapshot.bodyHtmlBytes = assertReleasePayloadSize(snapshot.bodyHtml, 'sanitized article body');
  snapshot.renderedPageBytes = assertReleasePayloadSize(snapshot.renderedPageHtml, 'rendered article page');
  snapshot.snapshotSha256 = sha256(stableJson(publicationSnapshotHashInput(snapshot)));
  return snapshot;
};

const assertPublicationRevision = ({ draft, expectedUpdatedAt, expectedRevision, expectedContentSha256 }) => {
  if (
    !validIsoDate(expectedUpdatedAt)
    || draft.updatedAt !== expectedUpdatedAt
    || !Number.isInteger(expectedRevision)
    || draft.revision !== expectedRevision
    || !/^[a-f0-9]{64}$/.test(String(expectedContentSha256 ?? ''))
    || draft.contentSha256 !== expectedContentSha256
  ) fail('Preview is out of date — save and preview the latest article again.', 409);
};

const receiptIdFor = (publisherUid, draftId) => sha256(`${publisherUid}\u0000${draftId}`);

export const previewDraft = async ({
  db,
  draftId,
  expectedUpdatedAt,
  expectedRevision,
  expectedContentSha256,
  publisherUid,
  articleTemplate,
  origin,
  now = new Date(),
}) => db.runTransaction(async (transaction) => {
  const accessRef = db.collection('studioAccess').doc(publisherUid);
  const draftRef = db.collection('contentDrafts').doc(draftId);
  const receiptRef = db.collection('contentPreviewReceipts').doc(receiptIdFor(publisherUid, draftId));
  const [access, draft] = await Promise.all([
    transactionDocument(transaction, accessRef),
    transactionDocument(transaction, draftRef),
  ]);
  if (!draft) fail('The cloud draft is unavailable.', 404);
  assertDraftEditor(access, draft, publisherUid);
  if (draft.archivedAt) fail('Restore this draft before previewing it.', 409);
  assertPublicationRevision({ draft, expectedUpdatedAt, expectedRevision, expectedContentSha256 });
  const snapshot = buildPublicationSnapshot({ draft, draftId, articleTemplate, origin });
  await assertDraftAssetsReady({ db, transaction, draftId, assetIds: snapshot.assetIds });
  const existingPublic = await transactionDocument(transaction, db.collection('publishedContent').doc(snapshot.slug));
  if (existingPublic && existingPublic.draftId !== draftId) fail('Another article already uses this URL slug.', 409);
  const previewedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + 30 * 60 * 1000).toISOString();
  const receipt = {
    id: receiptRef.id,
    draftId,
    publisherUid,
    sourceUpdatedAt: snapshot.sourceUpdatedAt,
    sourceRevision: snapshot.sourceRevision,
    contentSha256: snapshot.contentSha256,
    snapshotSha256: snapshot.snapshotSha256,
    templateSha256: snapshot.templateSha256,
    renderedPageSha256: snapshot.renderedPageSha256,
    assetIds: snapshot.assetIds,
    previewedAt,
    expiresAt,
  };
  transaction.set(receiptRef, receipt);
  return {
    mode: 'preview',
    receiptId: receiptRef.id,
    snapshotSha256: snapshot.snapshotSha256,
    renderedPageSha256: snapshot.renderedPageSha256,
    html: snapshot.renderedPageHtml,
    article: {
      title: snapshot.title,
      slug: snapshot.slug,
      sourceUpdatedAt: snapshot.sourceUpdatedAt,
      sourceRevision: snapshot.sourceRevision,
      contentSha256: snapshot.contentSha256,
    },
  };
});

export const publishDraft = async ({
  db,
  draftId,
  expectedUpdatedAt,
  expectedRevision,
  expectedContentSha256,
  previewReceiptId,
  idempotencyKey,
  publisherUid,
  origin,
  articleTemplate,
  now = new Date(),
}) => {
  const publishedAt = now.toISOString();
  return withContentFailureAudit({ db, action: 'publish', publisherUid, draftId, occurredAt: publishedAt }, async () => {
    if (!/^[a-zA-Z0-9_-]{16,128}$/.test(String(idempotencyKey ?? ''))) {
      fail('A valid publication request ID is required.');
    }
    if (previewReceiptId !== receiptIdFor(publisherUid, draftId)) {
      fail('Preview the latest article before publishing.', 409);
    }
    const accessRef = db.collection('studioAccess').doc(publisherUid);
    const draftRef = db.collection('contentDrafts').doc(draftId);
    const indexRef = db.collection('contentPublicationIndex').doc(draftId);
    const requestRef = db.collection('contentPublicationRequests').doc(`${publisherUid}_${idempotencyKey}`);
    const receiptRef = db.collection('contentPreviewReceipts').doc(previewReceiptId);
    const releaseRef = db.collection('contentReleases').doc();
    const sourcePayloadRef = db.collection('contentReleasePayloads').doc(`${releaseRef.id}_source`);
    const bodyPayloadRef = db.collection('contentReleasePayloads').doc(`${releaseRef.id}_body`);
    const pagePayloadRef = db.collection('contentReleasePayloads').doc(`${releaseRef.id}_page`);
    const auditRef = db.collection('contentAuditEvents').doc();

    return db.runTransaction(async (transaction) => {
    const [access, draft, previousIndex, previousRequest, receipt] = await Promise.all([
      transactionDocument(transaction, accessRef),
      transactionDocument(transaction, draftRef),
      transactionDocument(transaction, indexRef),
      transactionDocument(transaction, requestRef),
      transactionDocument(transaction, receiptRef),
    ]);
    assertPublisher(access);
    if (previousRequest) {
      if (
        previousRequest.draftId !== draftId
        || previousRequest.expectedUpdatedAt !== expectedUpdatedAt
        || previousRequest.previewReceiptId !== previewReceiptId
      ) {
        fail('That publication request ID was already used for different content.', 409);
      }
      return previousRequest.result;
    }
    if (!draft) fail('The cloud draft is unavailable.', 404);
    if (draft.archivedAt) fail('Archived drafts must be restored before publication.', 409);
    assertPublicationRevision({ draft, expectedUpdatedAt, expectedRevision, expectedContentSha256 });
    const snapshot = buildPublicationSnapshot({ draft, draftId, articleTemplate, origin });
    await assertDraftAssetsReady({ db, transaction, draftId, assetIds: snapshot.assetIds });
    if (
      !receipt
      || receipt.draftId !== draftId
      || receipt.publisherUid !== publisherUid
      || receipt.sourceUpdatedAt !== snapshot.sourceUpdatedAt
      || receipt.sourceRevision !== snapshot.sourceRevision
      || receipt.contentSha256 !== snapshot.contentSha256
      || receipt.snapshotSha256 !== snapshot.snapshotSha256
      || receipt.templateSha256 !== snapshot.templateSha256
      || receipt.renderedPageSha256 !== snapshot.renderedPageSha256
      || stableJson(receipt.assetIds) !== stableJson(snapshot.assetIds)
      || !validIsoDate(receipt.expiresAt)
      || Date.parse(receipt.expiresAt) < now.getTime()
      || receipt.consumedAt
    ) fail('Preview is out of date — preview the latest article again.', 409);

    const publicRef = db.collection('publishedContent').doc(snapshot.slug);
    const existingPublic = await transactionDocument(transaction, publicRef);
    if (existingPublic && existingPublic.draftId !== draftId) {
      fail('Another article already uses this URL slug.', 409);
    }

    let previousPublicRef = null;
    if (previousIndex?.slug && previousIndex.slug !== snapshot.slug) {
      previousPublicRef = db.collection('publishedContent').doc(previousIndex.slug);
      const previousPublic = await transactionDocument(transaction, previousPublicRef);
      if (previousPublic && previousPublic.draftId !== draftId) previousPublicRef = null;
    }

    const liveUrl = new URL(`/${snapshot.slug}`, origin).toString();
    const firstPublishedAt = previousIndex?.firstPublishedAt ?? publishedAt;
    const manifestBase = {
      id: releaseRef.id,
      releaseId: releaseRef.id,
      draftId,
      title: snapshot.title,
      excerpt: snapshot.excerpt,
      slug: snapshot.slug,
      tags: snapshot.tags,
      readMinutes: snapshot.readMinutes,
      sourceUpdatedAt: snapshot.sourceUpdatedAt,
      sourceRevision: snapshot.sourceRevision,
      assetIds: snapshot.assetIds,
      snapshotVersion: snapshot.snapshotVersion,
      rendererVersion: snapshot.rendererVersion,
      sanitizerVersion: snapshot.sanitizerVersion,
      templateVersion: snapshot.templateVersion,
      templateSha256: snapshot.templateSha256,
      contentSha256: snapshot.contentSha256,
      bodyHtmlSha256: snapshot.bodyHtmlSha256,
      renderedPageSha256: snapshot.renderedPageSha256,
      snapshotSha256: snapshot.snapshotSha256,
      sourceBytes: snapshot.sourceBytes,
      bodyHtmlBytes: snapshot.bodyHtmlBytes,
      renderedPageBytes: snapshot.renderedPageBytes,
      sourcePayloadId: sourcePayloadRef.id,
      bodyPayloadId: bodyPayloadRef.id,
      pagePayloadId: pagePayloadRef.id,
      publisherUid,
      publishedAt,
      firstPublishedAt,
      liveUrl,
    };
    const release = { ...manifestBase, manifestSha256: sha256(stableJson(manifestBase)) };

    transaction.create(sourcePayloadRef, {
      releaseId: releaseRef.id,
      kind: 'source',
      sourceJson: snapshot.sourceJson,
      sha256: snapshot.contentSha256,
      bytes: snapshot.sourceBytes,
    });
    transaction.create(bodyPayloadRef, {
      releaseId: releaseRef.id,
      kind: 'body',
      bodyHtml: snapshot.bodyHtml,
      sha256: snapshot.bodyHtmlSha256,
      bytes: snapshot.bodyHtmlBytes,
    });
    transaction.create(pagePayloadRef, {
      releaseId: releaseRef.id,
      kind: 'page',
      renderedPageHtml: snapshot.renderedPageHtml,
      sha256: snapshot.renderedPageSha256,
      bytes: snapshot.renderedPageBytes,
    });
    transaction.create(releaseRef, release);
    transaction.set(publicRef, release);
    transaction.set(indexRef, {
      draftId,
      slug: snapshot.slug,
      releaseId: releaseRef.id,
      assetIds: snapshot.assetIds,
      firstPublishedAt,
      publishedAt,
      state: 'published',
    });
    for (const assetId of snapshot.assetIds) {
      transaction.set(db.collection('contentAssetPublicRefs').doc(assetId), {
        assetId,
        draftId,
        releaseId: releaseRef.id,
        slug: snapshot.slug,
        active: true,
        updatedAt: publishedAt,
      });
    }
    for (const assetId of previousIndex?.assetIds ?? []) {
      if (snapshot.assetIds.includes(assetId)) continue;
      transaction.set(db.collection('contentAssetPublicRefs').doc(assetId), {
        assetId,
        draftId,
        releaseId: previousIndex.releaseId,
        slug: previousIndex.slug,
        active: false,
        updatedAt: publishedAt,
      });
    }
    if (previousPublicRef) transaction.delete(previousPublicRef);
    const result = {
      releaseId: releaseRef.id,
      liveUrl,
      slug: snapshot.slug,
      updatedAt: publishedAt,
      revision: snapshot.sourceRevision,
      contentSha256: snapshot.contentSha256,
      snapshotSha256: snapshot.snapshotSha256,
      renderedPageSha256: snapshot.renderedPageSha256,
    };
    transaction.update(draftRef, {
      publicationStatus: 'published',
      publicationReleaseId: releaseRef.id,
      publicationLiveUrl: liveUrl,
      updatedAt: publishedAt,
    });
    transaction.create(requestRef, {
      draftId,
      expectedUpdatedAt,
      expectedRevision,
      expectedContentSha256,
      previewReceiptId,
      idempotencyKey,
      publisherUid,
      occurredAt: publishedAt,
      result,
    });
    transaction.create(auditRef, {
      action: 'publish',
      actorUid: publisherUid,
      draftId,
      releaseId: releaseRef.id,
      slug: snapshot.slug,
      snapshotSha256: snapshot.snapshotSha256,
      occurredAt: publishedAt,
    });
    transaction.update(receiptRef, { consumedAt: publishedAt, releaseId: releaseRef.id });

    return result;
    });
  });
};

export const unpublishDraft = async ({ db, draftId, expectedUpdatedAt, publisherUid, now = new Date() }) => {
  const occurredAt = now.toISOString();
  return withContentFailureAudit({ db, action: 'unpublish', publisherUid, draftId, occurredAt }, async () => {
    const accessRef = db.collection('studioAccess').doc(publisherUid);
    const draftRef = db.collection('contentDrafts').doc(draftId);
    const indexRef = db.collection('contentPublicationIndex').doc(draftId);
    const auditRef = db.collection('contentAuditEvents').doc();

    return db.runTransaction(async (transaction) => {
    const [access, draft, index] = await Promise.all([
      transactionDocument(transaction, accessRef),
      transactionDocument(transaction, draftRef),
      transactionDocument(transaction, indexRef),
    ]);
    assertPublisher(access);
    if (!draft) fail('The cloud draft is unavailable.', 404);
    assertExpectedRevision(draft, expectedUpdatedAt);
    if (!index?.slug || index.state !== 'published') fail('This article is not currently published.', 409);

    const publicRef = db.collection('publishedContent').doc(index.slug);
    const currentPublic = await transactionDocument(transaction, publicRef);
    if (currentPublic?.draftId === draftId) transaction.delete(publicRef);
    transaction.set(indexRef, { ...index, state: 'unpublished', unpublishedAt: occurredAt });
    for (const assetId of index.assetIds ?? []) {
      transaction.set(db.collection('contentAssetPublicRefs').doc(assetId), {
        assetId,
        draftId,
        releaseId: index.releaseId,
        slug: index.slug,
        active: false,
        updatedAt: occurredAt,
      });
    }
    transaction.update(draftRef, {
      publicationStatus: 'unpublished',
      publicationReleaseId: index.releaseId,
      publicationLiveUrl: currentPublic?.liveUrl ?? '',
      updatedAt: occurredAt,
    });
    transaction.create(auditRef, {
      action: 'unpublish',
      actorUid: publisherUid,
      draftId,
      releaseId: index.releaseId,
      slug: index.slug,
      occurredAt,
    });
    return { slug: index.slug, updatedAt: occurredAt };
    });
  });
};

export const archiveDraft = async ({ db, draftId, expectedUpdatedAt, publisherUid, now = new Date() }) => {
  const occurredAt = now.toISOString();
  return withContentFailureAudit({ db, action: 'archive', publisherUid, draftId, occurredAt }, async () => {
    const accessRef = db.collection('studioAccess').doc(publisherUid);
    const draftRef = db.collection('contentDrafts').doc(draftId);
    const indexRef = db.collection('contentPublicationIndex').doc(draftId);
    const auditRef = db.collection('contentAuditEvents').doc();

    return db.runTransaction(async (transaction) => {
    const [access, draft, index] = await Promise.all([
      transactionDocument(transaction, accessRef),
      transactionDocument(transaction, draftRef),
      transactionDocument(transaction, indexRef),
    ]);
    if (!draft) fail('The cloud draft is unavailable.', 404);
    assertDraftEditor(access, draft, publisherUid);
    assertExpectedRevision(draft, expectedUpdatedAt);
    if (index?.state === 'published' || ['published', 'published-with-changes'].includes(draft.publicationStatus)) {
      fail('Unpublish this article before moving its draft to trash.', 409);
    }

    transaction.update(draftRef, { archivedAt: occurredAt, updatedAt: occurredAt });
    transaction.create(auditRef, {
      action: 'archive',
      actorUid: publisherUid,
      draftId,
      releaseId: index?.releaseId ?? '',
      slug: index?.slug ?? draft.slug ?? '',
      occurredAt,
    });
    return { archivedAt: occurredAt };
    });
  });
};

export const restoreDraft = async ({ db, draftId, expectedUpdatedAt, publisherUid, now = new Date() }) => {
  const occurredAt = now.toISOString();
  return withContentFailureAudit({ db, action: 'restore', publisherUid, draftId, occurredAt }, async () => {
    const accessRef = db.collection('studioAccess').doc(publisherUid);
    const draftRef = db.collection('contentDrafts').doc(draftId);
    const indexRef = db.collection('contentPublicationIndex').doc(draftId);
    const auditRef = db.collection('contentAuditEvents').doc();

    return db.runTransaction(async (transaction) => {
      const [access, draft, index] = await Promise.all([
        transactionDocument(transaction, accessRef),
        transactionDocument(transaction, draftRef),
        transactionDocument(transaction, indexRef),
      ]);
      if (!draft) fail('The archived cloud draft is unavailable.', 404);
      assertDraftEditor(access, draft, publisherUid);
      assertExpectedRevision(draft, expectedUpdatedAt);
      if (!draft.archivedAt) fail('This draft is not archived.', 409);
      if (index?.state === 'published') fail('A live article cannot be restored from archive.', 409);

      const { archivedAt: _archivedAt, archivedBy: _archivedBy, ...restoredDraft } = draft;
      transaction.set(draftRef, { ...restoredDraft, updatedAt: occurredAt });
      transaction.create(auditRef, {
        action: 'restore',
        actorUid: publisherUid,
        draftId,
        releaseId: index?.releaseId ?? '',
        slug: index?.slug ?? draft.slug ?? '',
        occurredAt,
      });
      return { restoredAt: occurredAt, updatedAt: occurredAt };
    });
  });
};

const publicationVersionKey = (value) => stableJson({
  snapshotVersion: value?.snapshotVersion,
  rendererVersion: value?.rendererVersion,
  sanitizerVersion: value?.sanitizerVersion,
  templateVersion: value?.templateVersion,
});

const PUBLICATION_READERS = new Map([
  [publicationVersionKey(PUBLICATION_VERSION_V1), Object.freeze({
    readSource(value) {
      const parsed = JSON.parse(stableJson(value));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid frozen source payload.');
      return parsed;
    },
    readBody(value) {
      if (typeof value !== 'string' || value.length === 0) throw new Error('Invalid frozen body payload.');
      return value;
    },
  })],
]);

export const supportsPublicationVersion = (value) => PUBLICATION_READERS.has(publicationVersionKey(value));

const validReleaseManifest = (manifest, expectedSlug) => {
  if (!manifest || typeof manifest !== 'object') return null;
  const { manifestSha256, ...manifestBase } = manifest;
  if (
    !/^[a-f0-9]{64}$/.test(String(manifestSha256 ?? ''))
    || sha256(stableJson(manifestBase)) !== manifestSha256
    || !supportsPublicationVersion(manifest)
    || manifest.slug !== expectedSlug
    || normalizeSlug(manifest.slug) !== manifest.slug
    || reservedSlugs.has(manifest.slug)
    || manifest.releaseId !== manifest.id
    || manifest.sourcePayloadId !== `${manifest.releaseId}_source`
    || manifest.bodyPayloadId !== `${manifest.releaseId}_body`
    || manifest.pagePayloadId !== `${manifest.releaseId}_page`
    || !Number.isInteger(manifest.sourceBytes) || manifest.sourceBytes < 1 || manifest.sourceBytes > RELEASE_PAYLOAD_LIMIT
    || !Number.isInteger(manifest.bodyHtmlBytes) || manifest.bodyHtmlBytes < 1 || manifest.bodyHtmlBytes > RELEASE_PAYLOAD_LIMIT
    || !Number.isInteger(manifest.renderedPageBytes) || manifest.renderedPageBytes < 1 || manifest.renderedPageBytes > RELEASE_PAYLOAD_LIMIT
  ) return null;
  return manifest;
};

const validReleaseBundle = (manifest, sourcePayload, bodyPayload, pagePayload) => {
  try {
    const reader = PUBLICATION_READERS.get(publicationVersionKey(manifest));
    if (!reader) return null;
    if (
      sourcePayload?.releaseId !== manifest.releaseId || sourcePayload.kind !== 'source'
      || bodyPayload?.releaseId !== manifest.releaseId || bodyPayload.kind !== 'body'
      || pagePayload?.releaseId !== manifest.releaseId || pagePayload.kind !== 'page'
      || sourcePayload.sha256 !== manifest.contentSha256
      || bodyPayload.sha256 !== manifest.bodyHtmlSha256
      || pagePayload.sha256 !== manifest.renderedPageSha256
      || sourcePayload.bytes !== manifest.sourceBytes
      || bodyPayload.bytes !== manifest.bodyHtmlBytes
      || pagePayload.bytes !== manifest.renderedPageBytes
    ) return null;
    const sourceJson = reader.readSource(sourcePayload.sourceJson);
    const bodyHtml = reader.readBody(bodyPayload.bodyHtml);
    if (typeof pagePayload.renderedPageHtml !== 'string' || pagePayload.renderedPageHtml.length === 0) return null;
    const renderedPageHtml = pagePayload.renderedPageHtml;
    if (
      utf8Size(stableJson(sourceJson)) !== manifest.sourceBytes
      || utf8Size(bodyHtml) !== manifest.bodyHtmlBytes
      || utf8Size(renderedPageHtml) !== manifest.renderedPageBytes
      || sha256(stableJson(sourceJson)) !== manifest.contentSha256
      || sha256(bodyHtml) !== manifest.bodyHtmlSha256
      || sha256(renderedPageHtml) !== manifest.renderedPageSha256
    ) return null;
    const snapshotForHash = {
      ...manifest,
      sourceJson,
      bodyHtml,
    };
    if (sha256(stableJson(publicationSnapshotHashInput(snapshotForHash))) !== manifest.snapshotSha256) return null;
    return { ...manifest, sourceJson, bodyHtml, renderedPageHtml };
  } catch {
    return null;
  }
};

export const loadPublishedArticle = async (db, slug) => {
  const normalized = normalizeSlug(slug);
  if (!normalized || normalized !== slug || reservedSlugs.has(normalized)) return null;
  const snapshot = await db.collection('publishedContent').doc(normalized).get();
  if (!snapshot.exists) return null;
  const manifest = validReleaseManifest(snapshot.data(), normalized);
  if (!manifest) return null;
  const [source, body, page] = await Promise.all([
    db.collection('contentReleasePayloads').doc(manifest.sourcePayloadId).get(),
    db.collection('contentReleasePayloads').doc(manifest.bodyPayloadId).get(),
    db.collection('contentReleasePayloads').doc(manifest.pagePayloadId).get(),
  ]);
  if (!source.exists || !body.exists || !page.exists) return null;
  return validReleaseBundle(manifest, source.data(), body.data(), page.data());
};

export const listPublishedArticles = async (db, limit = 100) => {
  const snapshot = await db.collection('publishedContent').orderBy('publishedAt', 'desc').limit(limit).get();
  return snapshot.docs
    .map((document) => document.data())
    .map((article) => validReleaseManifest(article, article?.slug))
    .filter((article) => article && typeof article.title === 'string');
};

export const renderPublishedInsightRows = (articles) => articles.map((article) => {
  const eyebrow = Array.isArray(article.tags) && article.tags[0] ? article.tags[0] : 'Insight';
  const readMinutes = Math.max(1, Number(article.readMinutes) || 1);
  return `<a class="insight-row" href="/${escapeHtml(article.slug)}"><small>${escapeHtml(eyebrow)}</small><div><h3>${escapeHtml(article.title)}</h3><p>${escapeHtml(article.excerpt ?? '')}</p></div><span>${readMinutes} min read →</span></a>`;
}).join('');

export const appendPublishedUrlsToSitemap = (xml, articles, origin) => {
  const urls = articles.map((article) => {
    const location = new URL(`/${article.slug}`, origin).toString();
    const lastModified = validIsoDate(article.publishedAt) ? `<lastmod>${escapeHtml(article.publishedAt)}</lastmod>` : '';
    return `<url><loc>${escapeHtml(location)}</loc>${lastModified}</url>`;
  }).join('');
  return xml.includes('</urlset>') ? xml.replace('</urlset>', `${urls}</urlset>`) : xml;
};

export const renderPublishedArticle = (template, article, origin) => {
  const liveUrl = new URL(`/${article.slug}`, origin).toString();
  const replacements = new Map([
    ['@@AISPANDA_ARTICLE_TITLE@@', escapeHtml(article.title)],
    ['@@AISPANDA_ARTICLE_DESCRIPTION@@', escapeHtml(article.excerpt)],
    ['@@AISPANDA_ARTICLE_SLUG@@', escapeHtml(article.slug)],
    ['@@AISPANDA_ARTICLE_DRAFT_ID@@', escapeHtml(article.draftId)],
    ['@@AISPANDA_ARTICLE_BODY@@', article.bodyHtml],
    ['@@AISPANDA_ARTICLE_READ_TIME@@', `${Number(article.readMinutes) || 1} min read`],
    ['@@AISPANDA_ARTICLE_URL@@', escapeHtml(liveUrl)],
  ]);
  let output = template;
  for (const [token, value] of replacements) output = output.replaceAll(token, value);
  return output.replaceAll('https://aispanda.com/article-shell-internal', escapeHtml(liveUrl));
};

export const renderPublishedPreview = (template, article, origin) => renderPublishedArticle(template, article, origin)
  .replace(/<!--@@AISPANDA_INTERACTIVE_START@@-->[\s\S]*?<!--@@AISPANDA_INTERACTIVE_END@@-->/g, '');
