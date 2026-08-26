import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import {
  SUPPORTED_AI_PROVIDERS,
  decodeVaultKey,
  decryptVaultConnection,
  encryptVaultConnection,
  generateWithProvider,
  refreshProviderConnection,
  revokeProviderConnection,
  validateVaultConnection,
} from './ai-vault-core.mjs';
import {
  appendPublishedUrlsToSitemap,
  archiveDraft,
  listPublishedArticles,
  loadPublishedArticle,
  previewDraft,
  publishDraft,
  renderPublishedArticle,
  renderPublishedPreview,
  renderPublishedInsightRows,
  restoreDraft,
  unpublishDraft,
  withContentFailureAudit,
} from './content-publishing.mjs';
import { isInternalArticleShellFile } from './static-routing.mjs';
import { buildRuntimePublicConfig, injectRuntimePublicConfig } from './runtime-config.mjs';

const PORT = Number(process.env.PORT) || 8080;
const DIST_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const VAULT_KEY = decodeVaultKey(process.env.AI_VAULT_KEY_B64);
const JSON_LIMIT = 64 * 1024;
const CONTENT_JSON_LIMIT = 600 * 1024;
const SITE_ORIGIN = new URL(process.env.PUBLIC_SITE_ORIGIN ?? 'https://aispanda.com').origin;
const RUNTIME_PUBLIC_CONFIG = buildRuntimePublicConfig(process.env);
const FIREBASE_AUTH_ORIGIN = new URL(`https://${RUNTIME_PUBLIC_CONFIG?.firebase.authDomain ?? 'aispanda.firebaseapp.com'}`);
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 30;
const requestsByUser = new Map();
const contentRequestsByUser = new Map();
let articleShellPromise;
const app = getApps()[0] ?? (RUNTIME_PUBLIC_CONFIG
  ? initializeApp({ projectId: RUNTIME_PUBLIC_CONFIG.firebase.projectId })
  : initializeApp());
const auth = getAuth(app);
// Interim cost decision: use the project's default Firestore database. The
// browser is still denied vault access by rules; the dedicated Cloud Run
// identity is the only server principal intended to access this collection.
const db = getFirestore(app);

const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

const json = (response, status, payload) => {
  const body = status === 204 ? '' : JSON.stringify(payload);
  response.writeHead(status, { ...securityHeaders, 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
  response.end(body);
};

const readJson = async (request, limit = JSON_LIMIT) => {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('Request is too large.'), { statusCode: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('Request body must be valid JSON.'), { statusCode: 400 });
  }
};

const requestOrigin = (request) => {
  const protocol = String(request.headers['x-forwarded-proto'] ?? 'http').split(',')[0].trim();
  const host = String(request.headers['x-forwarded-host'] ?? request.headers.host ?? '').split(',')[0].trim();
  return `${protocol}://${host}`;
};

const requireSameOrigin = (request) => {
  const origin = request.headers.origin;
  if (origin && origin !== requestOrigin(request)) throw Object.assign(new Error('Cross-origin request rejected.'), { statusCode: 403 });
};

const requireUser = async (request) => {
  const authorization = request.headers.authorization ?? '';
  if (!authorization.startsWith('Bearer ')) throw Object.assign(new Error('Sign in to continue.'), { statusCode: 401 });
  try {
    return await auth.verifyIdToken(authorization.slice(7));
  } catch {
    throw Object.assign(new Error('Your sign-in session expired. Sign in again.'), { statusCode: 401 });
  }
};

const enforceRateLimit = (uid) => {
  const now = Date.now();
  const recent = (requestsByUser.get(uid) ?? []).filter((time) => now - time < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) throw Object.assign(new Error('Too many AI requests. Wait briefly and try again.'), { statusCode: 429 });
  recent.push(now);
  requestsByUser.set(uid, recent);
};

const enforceContentRateLimit = (uid) => {
  const now = Date.now();
  const recent = (contentRequestsByUser.get(uid) ?? []).filter((time) => now - time < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) throw Object.assign(new Error('Too many content requests. Wait briefly and try again.'), { statusCode: 429 });
  recent.push(now);
  contentRequestsByUser.set(uid, recent);
};

const rootRef = (uid) => db.collection('aiCredentialVault').doc(uid);
const connectionRef = (uid, provider) => rootRef(uid).collection('connections').doc(provider);
const aad = (uid, provider) => `${uid}:${provider}:v1`;

const storeConnection = async (uid, provider, connection, status) => {
  const encrypted = encryptVaultConnection(connection, VAULT_KEY, aad(uid, provider));
  await connectionRef(uid, provider).set({
    ...encrypted,
    provider,
    status: JSON.parse(JSON.stringify(status)),
    updatedAt: FieldValue.serverTimestamp(),
  });
};

const loadConnection = async (uid, provider) => {
  const snapshot = await connectionRef(uid, provider).get();
  if (!snapshot.exists) throw Object.assign(new Error('Connect this AI provider before using it.'), { statusCode: 404 });
  try {
    return decryptVaultConnection(snapshot.data(), VAULT_KEY, aad(uid, provider));
  } catch {
    throw Object.assign(new Error('This saved AI connection cannot be opened. Disconnect and reconnect it.'), { statusCode: 409 });
  }
};

const listConnections = async (uid) => {
  const [root, connections] = await Promise.all([rootRef(uid).get(), rootRef(uid).collection('connections').get()]);
  return {
    activeProvider: typeof root.data()?.activeProvider === 'string' ? root.data().activeProvider : null,
    connections: connections.docs.flatMap((document) => {
      const data = document.data();
      return SUPPORTED_AI_PROVIDERS.has(document.id) && data.status?.connected === true
        ? [{ provider: document.id, status: data.status }]
        : [];
    }),
  };
};

const providerFromPath = (pathname) => {
  const match = pathname.match(/^\/api\/ai\/connections\/([^/]+)(?:\/(status|generate))?$/);
  if (!match) return null;
  const provider = decodeURIComponent(match[1]);
  return SUPPORTED_AI_PROVIDERS.has(provider) ? { provider, action: match[2] ?? null } : null;
};

const contentRouteFromPath = (pathname) => {
  const match = pathname.match(/^\/api\/content\/drafts\/([^/]+)\/(publish|unpublish|preview|preview-document|archive|restore)$/);
  if (!match) return null;
  try {
    const draftId = decodeURIComponent(match[1]);
    return /^[a-zA-Z0-9-]{1,128}$/.test(draftId) ? { draftId, action: match[2] } : null;
  } catch {
    return null;
  }
};

const handleApi = async (request, response, url) => {
  requireSameOrigin(request);
  const user = await requireUser(request);
  const contentRoute = contentRouteFromPath(url.pathname);
  if (contentRoute) {
    const preflight = async () => {
      if (request.method !== 'POST') throw Object.assign(new Error('Method not allowed.'), { statusCode: 405 });
      enforceContentRateLimit(user.uid);
      return readJson(request, contentRoute.action.startsWith('preview') ? CONTENT_JSON_LIMIT : JSON_LIMIT);
    };
    const body = contentRoute.action.startsWith('preview')
      ? await preflight()
      : await withContentFailureAudit({
        db,
        action: contentRoute.action,
        publisherUid: user.uid,
        draftId: contentRoute.draftId,
        occurredAt: new Date().toISOString(),
      }, preflight);
    const common = { db, draftId: contentRoute.draftId, publisherUid: user.uid };
    if (contentRoute.action === 'preview-document') {
      const [preview, template] = await Promise.all([
        previewDraft({ db, draft: body.draft, publisherUid: user.uid }),
        loadArticleShell(),
      ]);
      const html = renderPublishedPreview(template, { ...preview, draftId: contentRoute.draftId }, SITE_ORIGIN);
      serveText(request, response, html, 'text/html; charset=utf-8', 200, 'no-store');
      return;
    }
    const result = contentRoute.action === 'preview'
      ? await previewDraft({ db, draft: body.draft, publisherUid: user.uid })
      : contentRoute.action === 'archive'
        ? await archiveDraft({ ...common, expectedUpdatedAt: body.expectedUpdatedAt })
        : contentRoute.action === 'restore'
          ? await restoreDraft({ ...common, expectedUpdatedAt: body.expectedUpdatedAt })
        : contentRoute.action === 'publish'
          ? await publishDraft({
            ...common,
            expectedUpdatedAt: body.expectedUpdatedAt,
            idempotencyKey: body.idempotencyKey,
            origin: SITE_ORIGIN,
          })
          : await unpublishDraft({ ...common, expectedUpdatedAt: body.expectedUpdatedAt });
    json(response, 200, result);
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/ai/connections') {
    json(response, 200, await listConnections(user.uid));
    return;
  }
  if (request.method === 'PUT' && url.pathname === '/api/ai/connections/active') {
    const body = await readJson(request);
    const provider = body.provider === null ? null : String(body.provider ?? '');
    if (provider && !SUPPORTED_AI_PROVIDERS.has(provider)) throw Object.assign(new Error('Unsupported AI provider.'), { statusCode: 400 });
    if (provider && !(await connectionRef(user.uid, provider).get()).exists) throw Object.assign(new Error('Connect this provider before making it active.'), { statusCode: 409 });
    await rootRef(user.uid).set({ activeProvider: provider, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    json(response, 204, null);
    return;
  }

  const route = providerFromPath(url.pathname);
  if (!route) throw Object.assign(new Error('API route not found.'), { statusCode: 404 });
  const { provider, action } = route;

  if (request.method === 'PUT' && action === null) {
    const candidate = validateVaultConnection(provider, await readJson(request));
    const { connection, status } = await refreshProviderConnection(provider, candidate);
    await storeConnection(user.uid, provider, connection, status);
    const root = await rootRef(user.uid).get();
    if (!root.data()?.activeProvider) {
      await rootRef(user.uid).set({ activeProvider: provider, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    }
    json(response, 200, { status });
    return;
  }
  if (request.method === 'POST' && action === 'status') {
    const current = await loadConnection(user.uid, provider);
    const { connection, status } = await refreshProviderConnection(provider, current);
    await storeConnection(user.uid, provider, connection, status);
    json(response, 200, { status });
    return;
  }
  if (request.method === 'POST' && action === 'generate') {
    enforceRateLimit(user.uid);
    const current = await loadConnection(user.uid, provider);
    const { connection, result } = await generateWithProvider(provider, current, await readJson(request));
    await storeConnection(user.uid, provider, connection, connection.status);
    json(response, 200, result);
    return;
  }
  if (request.method === 'DELETE' && action === null) {
    const current = await loadConnection(user.uid, provider).catch(() => null);
    if (current) await revokeProviderConnection(provider, current);
    await connectionRef(user.uid, provider).delete();
    const root = await rootRef(user.uid).get();
    if (root.data()?.activeProvider === provider) {
      await rootRef(user.uid).set({ activeProvider: null, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    }
    json(response, 204, null);
    return;
  }
  throw Object.assign(new Error('Method not allowed.'), { statusCode: 405 });
};

const proxyFirebaseAuth = async (request, response, url) => {
  const target = new URL(url.pathname + url.search, FIREBASE_AUTH_ORIGIN);
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined || ['host', 'connection', 'content-length'].includes(name.toLowerCase())) continue;
    headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  headers.set('host', FIREBASE_AUTH_ORIGIN.host);
  const body = ['GET', 'HEAD'].includes(request.method ?? 'GET') ? undefined : Buffer.concat(await Array.fromAsync(request));
  const upstream = await fetch(target, { method: request.method, headers, body, redirect: 'manual' });
  const responseHeaders = Object.fromEntries(upstream.headers.entries());
  response.writeHead(upstream.status, responseHeaders);
  if (request.method === 'HEAD' || !upstream.body) response.end();
  else for await (const chunk of upstream.body) response.write(chunk);
  response.end();
};

const contentTypes = {
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

const resolveStaticFile = async (pathname) => {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  if (decoded.includes('\0')) return null;
  const clean = normalize(decoded).replace(/^([/\\])+/, '');
  const candidates = decoded.endsWith('/')
    ? [join(DIST_ROOT, clean, 'index.html')]
    : [join(DIST_ROOT, clean), join(DIST_ROOT, clean, 'index.html'), join(DIST_ROOT, `${clean}.html`)];
  for (const candidate of candidates) {
    const resolved = resolve(candidate);
    if (resolved !== DIST_ROOT && !resolved.startsWith(`${DIST_ROOT}${sep}`)) continue;
    try { if ((await stat(resolved)).isFile()) return resolved; } catch { /* Try the next candidate. */ }
  }
  return null;
};

const loadArticleShell = () => {
  articleShellPromise ??= readFile(join(DIST_ROOT, 'article-shell-internal', 'index.html'), 'utf8');
  return articleShellPromise;
};

const serveFile = async (request, response, file, status = 200) => {
  if (extname(file).toLowerCase() === '.html') {
    serveText(request, response, await readFile(file, 'utf8'), 'text/html; charset=utf-8', status);
    return;
  }
  const immutable = /\.(?:css|js|png|jpg|jpeg|webp|gif|ico|svg|woff2)$/i.test(file);
  response.writeHead(status, {
    ...securityHeaders,
    'Content-Type': contentTypes[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=2592000, immutable' : 'no-cache',
  });
  if (request.method === 'HEAD') response.end();
  else createReadStream(file).pipe(response);
};

const serveText = (
  request,
  response,
  body,
  contentType,
  status = 200,
  cacheControl = 'public, max-age=0, must-revalidate',
) => {
  const renderedBody = contentType.startsWith('text/html')
    ? injectRuntimePublicConfig(body, RUNTIME_PUBLIC_CONFIG)
    : body;
  response.writeHead(status, {
    ...securityHeaders,
    'Cache-Control': cacheControl,
    'Content-Type': contentType,
  });
  response.end(request.method === 'HEAD' ? '' : renderedBody);
};

const loadPublishedArticlesSafely = async () => {
  try {
    return await listPublishedArticles(db);
  } catch (error) {
    console.error('Published-content discovery is temporarily unavailable.', error);
    return [];
  }
};

const serveStatic = async (request, response, url) => {
  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = await resolveStaticFile(requested);
  const normalizedPath = requested.length > 1 ? requested.replace(/\/$/, '') : requested;
  if (file && normalizedPath === '/insights') {
    const [template, articles] = await Promise.all([readFile(file, 'utf8'), loadPublishedArticlesSafely()]);
    const html = template.replace('<!--@@AISPANDA_DYNAMIC_INSIGHTS@@-->', renderPublishedInsightRows(articles));
    serveText(request, response, html, 'text/html; charset=utf-8');
    return;
  }
  if (file && normalizedPath === '/sitemap-0.xml') {
    const [template, articles] = await Promise.all([readFile(file, 'utf8'), loadPublishedArticlesSafely()]);
    serveText(request, response, appendPublishedUrlsToSitemap(template, articles, SITE_ORIGIN), 'application/xml; charset=utf-8');
    return;
  }
  if (file && !isInternalArticleShellFile(file, DIST_ROOT)) {
    await serveFile(request, response, file);
    return;
  }

  const pathSegments = requested.split('/').filter(Boolean);
  if (pathSegments.length === 1) {
    const article = await loadPublishedArticle(db, pathSegments[0]);
    if (article) {
      const template = await loadArticleShell();
      const html = renderPublishedArticle(template, article, SITE_ORIGIN);
      serveText(request, response, html, 'text/html; charset=utf-8');
      return;
    }
  }

  const notFound = await resolveStaticFile('/404.html');
  if (!notFound) throw Object.assign(new Error('Page not found.'), { statusCode: 404 });
  await serveFile(request, response, notFound, 404);
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', requestOrigin(request));
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(request, response, url);
    else if (url.pathname.startsWith('/__/auth')) await proxyFirebaseAuth(request, response, url);
    else if (request.method === 'GET' || request.method === 'HEAD') await serveStatic(request, response, url);
    else json(response, 405, { error: 'Method not allowed.' });
  } catch (error) {
    const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    if (status >= 500) console.error('Request failed', { path: url.pathname, status, name: error?.name });
    json(response, status, { error: status >= 500 ? 'The service could not complete this request.' : error.message });
  }
});

server.listen(PORT, '0.0.0.0', () => console.log(`AI Spanda listening on ${PORT}`));
