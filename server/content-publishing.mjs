import sanitizeHtml from 'sanitize-html';

const TITLE_LIMIT = 300;
const BODY_LIMIT = 500_000;
const EXCERPT_LIMIT = 2_000;
const TAGS_LIMIT = 1_000;
const SLUG_LIMIT = 90;

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
      'tbody', 'tr', 'th', 'td',
    ],
    allowedAttributes: {
      a: ['href', 'title', 'rel'],
      aside: ['class'],
      th: ['colspan', 'rowspan', 'scope'],
      td: ['colspan', 'rowspan'],
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

export const validateDraftForPublication = (draft) => {
  if (!draft || typeof draft !== 'object') fail('The cloud draft is unavailable.', 404);
  const title = typeof draft.title === 'string' ? draft.title.trim() : '';
  const body = typeof draft.body === 'string' ? draft.body : '';
  const excerpt = typeof draft.excerpt === 'string' ? draft.excerpt.trim() : '';
  const tagsText = typeof draft.tags === 'string' ? draft.tags.trim() : '';
  const slug = normalizeSlug(draft.slug);

  if (!title || title.length > TITLE_LIMIT) fail('Add a valid article title before publishing.');
  if (!body.trim() || body.length > BODY_LIMIT) fail('Add valid article content before publishing.');
  if (excerpt.length > EXCERPT_LIMIT) fail('The article excerpt is too long.');
  if (tagsText.length > TAGS_LIMIT) fail('The article tags are too long.');
  if (!slug || slug !== draft.slug || slug.length > SLUG_LIMIT) fail('Choose a valid URL slug before publishing.');
  if (reservedSlugs.has(slug)) fail('That URL slug is reserved by the site.', 409);
  if (!validIsoDate(draft.updatedAt)) fail('The cloud draft has an invalid revision timestamp.');

  const bodyHtml = sanitizeArticleBody(body, title);
  const bodyText = sanitizeHtml(bodyHtml, { allowedTags: [], allowedAttributes: {} }).trim();
  if (!bodyText) fail('The article does not contain publishable text.');

  return {
    title,
    bodyHtml,
    excerpt,
    slug,
    tags: normalizeTags(tagsText),
    sourceUpdatedAt: draft.updatedAt,
    readMinutes: Math.max(1, Math.ceil((bodyText.match(/\S+/g) ?? []).length / 225)),
  };
};

export const validateDraftForPreview = (draft) => {
  if (!draft || typeof draft !== 'object') fail('The cloud draft is unavailable.', 404);
  const title = typeof draft.title === 'string' ? draft.title.trim() : '';
  const body = typeof draft.body === 'string' ? draft.body : '';
  const excerpt = typeof draft.excerpt === 'string' ? draft.excerpt.trim() : '';
  const tagsText = typeof draft.tags === 'string' ? draft.tags.trim() : '';
  if (title.length > TITLE_LIMIT) fail('The article title is too long.');
  if (body.length > BODY_LIMIT) fail('The article content is too long.');
  if (excerpt.length > EXCERPT_LIMIT) fail('The article excerpt is too long.');
  if (tagsText.length > TAGS_LIMIT) fail('The article tags are too long.');
  if (!validIsoDate(draft.updatedAt)) fail('The cloud draft has an invalid revision timestamp.');

  const previewTitle = title || 'Untitled article';
  const bodyHtml = sanitizeArticleBody(body, previewTitle);
  const bodyText = sanitizeHtml(bodyHtml, { allowedTags: [], allowedAttributes: {} }).trim();
  return {
    title: previewTitle,
    bodyHtml,
    excerpt,
    slug: normalizeSlug(draft.slug) || 'preview',
    tags: normalizeTags(tagsText),
    sourceUpdatedAt: draft.updatedAt,
    readMinutes: Math.max(1, Math.ceil((bodyText.match(/\S+/g) ?? []).length / 225)),
  };
};

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
  if (access.role === 'author' && draft.ownerUid !== uid) fail('You can archive only drafts you own.', 403);
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

export const previewDraft = async ({ db, draft, publisherUid }) => {
  const access = await db.collection('studioAccess').doc(publisherUid).get();
  assertEditor(access.exists ? access.data() : null);
  return validateDraftForPreview(draft);
};

export const publishDraft = async ({
  db,
  draftId,
  expectedUpdatedAt,
  idempotencyKey,
  publisherUid,
  origin,
  now = new Date(),
}) => {
  const publishedAt = now.toISOString();
  return withContentFailureAudit({ db, action: 'publish', publisherUid, draftId, occurredAt: publishedAt }, async () => {
    if (!/^[a-zA-Z0-9_-]{16,128}$/.test(String(idempotencyKey ?? ''))) {
      fail('A valid publication request ID is required.');
    }
    const accessRef = db.collection('studioAccess').doc(publisherUid);
    const draftRef = db.collection('contentDrafts').doc(draftId);
    const indexRef = db.collection('contentPublicationIndex').doc(draftId);
    const requestRef = db.collection('contentPublicationRequests').doc(`${publisherUid}_${idempotencyKey}`);
    const releaseRef = db.collection('contentReleases').doc();
    const auditRef = db.collection('contentAuditEvents').doc();

    return db.runTransaction(async (transaction) => {
    const [access, draft, previousIndex, previousRequest] = await Promise.all([
      transactionDocument(transaction, accessRef),
      transactionDocument(transaction, draftRef),
      transactionDocument(transaction, indexRef),
      transactionDocument(transaction, requestRef),
    ]);
    assertPublisher(access);
    if (previousRequest) {
      if (previousRequest.draftId !== draftId || previousRequest.expectedUpdatedAt !== expectedUpdatedAt) {
        fail('That publication request ID was already used for different content.', 409);
      }
      return previousRequest.result;
    }
    if (!draft) fail('The cloud draft is unavailable.', 404);
    if (draft.archivedAt) fail('Archived drafts must be restored before publication.', 409);
    assertExpectedRevision(draft, expectedUpdatedAt);
    const article = validateDraftForPublication(draft);
    const publicRef = db.collection('publishedContent').doc(article.slug);
    const existingPublic = await transactionDocument(transaction, publicRef);
    if (existingPublic && existingPublic.draftId !== draftId) {
      fail('Another article already uses this URL slug.', 409);
    }

    let previousPublicRef = null;
    if (previousIndex?.slug && previousIndex.slug !== article.slug) {
      previousPublicRef = db.collection('publishedContent').doc(previousIndex.slug);
      const previousPublic = await transactionDocument(transaction, previousPublicRef);
      if (previousPublic && previousPublic.draftId !== draftId) previousPublicRef = null;
    }

    const liveUrl = new URL(`/${article.slug}`, origin).toString();
    const firstPublishedAt = previousIndex?.firstPublishedAt ?? publishedAt;
    const release = {
      id: releaseRef.id,
      draftId,
      ...article,
      publisherUid,
      publishedAt,
      firstPublishedAt,
      liveUrl,
    };

    transaction.create(releaseRef, release);
    transaction.set(publicRef, { ...release, releaseId: releaseRef.id });
    transaction.set(indexRef, {
      draftId,
      slug: article.slug,
      releaseId: releaseRef.id,
      firstPublishedAt,
      publishedAt,
      state: 'published',
    });
    if (previousPublicRef) transaction.delete(previousPublicRef);
    const result = { releaseId: releaseRef.id, liveUrl, slug: article.slug, updatedAt: publishedAt };
    transaction.update(draftRef, {
      publicationStatus: 'published',
      publicationReleaseId: releaseRef.id,
      publicationLiveUrl: liveUrl,
      updatedAt: publishedAt,
    });
    transaction.create(requestRef, {
      draftId,
      expectedUpdatedAt,
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
      slug: article.slug,
      occurredAt: publishedAt,
    });

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
    if (index?.state === 'published') fail('Unpublish this article before archiving its draft.', 409);

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

export const loadPublishedArticle = async (db, slug) => {
  const normalized = normalizeSlug(slug);
  if (!normalized || normalized !== slug || reservedSlugs.has(normalized)) return null;
  const snapshot = await db.collection('publishedContent').doc(normalized).get();
  if (!snapshot.exists) return null;
  const article = snapshot.data();
  return article?.slug === normalized && typeof article.bodyHtml === 'string' ? article : null;
};

export const listPublishedArticles = async (db, limit = 100) => {
  const snapshot = await db.collection('publishedContent').orderBy('publishedAt', 'desc').limit(limit).get();
  return snapshot.docs
    .map((document) => document.data())
    .filter((article) => article
      && typeof article.slug === 'string'
      && normalizeSlug(article.slug) === article.slug
      && !reservedSlugs.has(article.slug)
      && typeof article.title === 'string');
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
