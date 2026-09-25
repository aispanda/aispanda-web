// Consumer adapter for agent-operated IAB evidence. RA-002 owns release receipts.
import { readFile, writeFile, mkdir, rename, stat } from 'node:fs/promises';
import { resolve, basename, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const requireThat = (condition, message) => { if (!condition) throw new Error(message); };
export const requiredChecks = Object.freeze(['roleVerified', 'articleListVerified', 'uploadVerified',
  'savedAndReloaded', 'previewVerified', 'publishedAndReloaded', 'mobileVerified']);
const boundFields = ['nonce', 'origin', 'projectId', 'commit', 'digest', 'packageSha256', 'draftId', 'expectedSlug'];
const safeText = (value, max) => typeof value === 'string' && value.trim().length > 0
  && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);

export function validateReleaseIdentity(profile, environment, head) {
  requireThat(environment.TARGET_URL === profile.origin && environment.TARGET_PROJECT === profile.projectId, 'Controller target differs from approved staging.');
  requireThat(/^[a-f0-9]{40}$/.test(environment.RELEASE_COMMIT || '') && environment.RELEASE_COMMIT === head, 'Controller commit must equal current HEAD.');
  requireThat(/^sha256:[a-f0-9]{64}$/.test(environment.IMAGE_DIGEST || ''), 'Controller image digest is required.');
  requireThat(/^[a-f0-9]{64}$/.test(profile.packageSha256 || ''), 'Current package hash is required.');
  return { origin: profile.origin, projectId: profile.projectId, commit: head, digest: environment.IMAGE_DIGEST,
    packageSha256: profile.packageSha256, draftId: profile.draftId, expectedSlug: profile.expectedSlug };
}

export function validateObservations(request, result, now = Date.now()) {
  for (const field of boundFields) requireThat(result?.[field] === request[field], `Observation ${field} differs from the current challenge.`);
  const started = Date.parse(request.issuedAt), expires = Date.parse(request.expiresAt), completed = Date.parse(result.completedAt);
  requireThat(Number.isFinite(started) && expires > started && expires - started <= 900000
    && now >= started && now <= expires && completed >= started && completed <= now, 'Observation challenge is expired or has invalid timestamps.');
  requireThat(result.mode === 'agent-operated-inapp', 'Evidence must identify the actual in-app verification mode.');
  requireThat(['published', 'reverified'].includes(result.action), 'Specify published or reverified observations.');
  requireThat(request.requiredAction !== 'published' || result.action === 'published', 'First verification of this candidate must exercise upload, save and publication.');
  requireThat(['Administrator', 'Publisher'].includes(result.role), 'Observed editorial role is required.');
  for (const check of requiredChecks) requireThat(result.checks?.[check] === true, `Missing observed step: ${check}.`);
  requireThat(safeText(result.title, 200) && safeText(result.textSnippet, 1000) && result.textSnippet.trim().length >= 20, 'Observed public title and meaningful text snippet are required.');
  requireThat(safeText(result.imageAlt, 500), 'Observed image alternative text is required.');
  requireThat(typeof result.imagePath === 'string' && result.imagePath.length <= 400
    && /^\/content-assets\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+(?:\.(?:png|jpe?g|webp))?$/.test(result.imagePath), 'Only a same-site uploaded content image path is allowed.');
  requireThat(typeof result.releaseId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(result.releaseId), 'Persisted release ID must be observed in the editor.');
  return { ...Object.fromEntries([...boundFields, 'mode', 'action', 'role', 'completedAt', 'title', 'textSnippet', 'imagePath', 'imageAlt', 'releaseId'].map(field => [field, result[field]])),
    checks: Object.fromEntries(requiredChecks.map(check => [check, true])) };
}

export function validateRuntimeConfig(config, expected) {
  requireThat(config?.environment === 'staging' && config.firebase?.projectId === expected.projectId
    && config.siteOrigin === expected.origin && config.articleSiteOrigin === expected.origin, 'Hosted configuration is not the approved staging environment.');
}

const decode = text => text.replace(/&#(x[\da-f]+|\d+);/gi, (_, value) => {
  const number = value[0].toLowerCase() === 'x' ? parseInt(value.slice(1), 16) : Number(value);
  return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : '';
}).replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, name) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[name]);
const normalize = text => decode(text).replace(/\s+/g, ' ').trim();
const attribute = (tag, name) => decode(tag.match(new RegExp(`\\s${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'))?.[2] || '');
export function validatePublicHtml(html, result) {
  const headings = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map(match => normalize(match[1].replace(/<[^>]*>/g, ' ')));
  requireThat(headings.includes(normalize(result.title)), 'Anonymous article title differs from observed publication.');
  const text = normalize(html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<[^>]*>/g, ' '));
  requireThat(text.includes(normalize(result.textSnippet)), 'Anonymous article prose differs from observed publication.');
  const images = [...html.matchAll(/<img\b[^>]*>/gi)].map(match => match[0]);
  requireThat(images.some(tag => attribute(tag, 'src') === result.imagePath && attribute(tag, 'alt') === result.imageAlt), 'Anonymous article image/alt differs from observed publication.');
  // Release IDs are not embedded in public HTML. The persisted editor receipt
  // is observed in IAB; anonymous checks corroborate its content, not that ID.
}

export async function loadApprovedProfile() {
  const approved = JSON.parse(await readFile(resolve(root, 'config/blog-staging.json'), 'utf8'));
  const fixture = JSON.parse(await readFile(resolve(root, 'config/blog-staging-test.json'), 'utf8'));
  const lock = JSON.parse(await readFile(resolve(root, 'vendor/blog/lock.json'), 'utf8'));
  requireThat(typeof lock.archive === 'string' && basename(lock.archive) === lock.archive
    && /^[a-f0-9]{64}$/.test(lock.packageSha256 || '')
    && /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(lock.packageVersion || ''), 'Invalid current vendor lock.');
  requireThat(hash(await readFile(resolve(root, 'vendor/blog', lock.archive))) === lock.packageSha256, 'Locked package archive integrity mismatch.');
  const release = resolve(root, '.blog/releases', `${lock.packageVersion}-${lock.packageSha256.slice(0, 12)}`);
  const { validateStagingInputs } = await import(pathToFileURL(resolve(release, 'runtime/tests/staging-preflight.mjs')).href);
  const profile = validateStagingInputs({ origin: approved.siteOrigin, projectId: approved.projectId,
    productionOrigin: approved.productionSiteOrigin, productionProjectId: approved.productionProjectId,
    draftId: fixture.draftId, expectedSlug: fixture.expectedSlug });
  const uploadFixture = resolve(root, fixture.uploadFixture);
  requireThat(uploadFixture.startsWith(root.endsWith(sep) ? root : root + sep), 'Upload fixture must remain inside the consumer checkout.');
  const info = await stat(uploadFixture);
  requireThat(info.isFile() && info.size > 0 && info.size <= 5 * 1024 * 1024 && /\.(png|jpe?g|webp)$/i.test(uploadFixture), 'Upload fixture must be a supported image below 5 MB.');
  return { ...profile, packageSha256: lock.packageSha256, uploadFixture };
}

async function fetchBytes(origin, path, max = 6 * 1024 * 1024) {
  const url = new URL(path, origin);
  requireThat(url.origin === origin, 'Public corroboration must stay on approved staging.');
  const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(30000), headers: { 'Cache-Control': 'no-cache' } });
  requireThat(response.status === 200 && !response.redirected, 'Staging corroboration must return HTTP 200 without redirects.');
  const chunks = []; let length = 0;
  for await (const chunk of response.body) { length += chunk.length; requireThat(length <= max, 'Corroboration response exceeds size limit.'); chunks.push(chunk); }
  return { bytes: Buffer.concat(chunks), contentType: response.headers.get('content-type') || '' };
}

async function verifyConfig(profile) {
  const config = await fetchBytes(profile.origin, '/api/content/config', 65536);
  requireThat(config.contentType.includes('application/json'), 'Staging configuration must be JSON.');
  validateRuntimeConfig(JSON.parse(config.bytes.toString('utf8')), profile);
}

async function atomicJson(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  await rename(temporary, path);
}

async function main() {
  requireThat(process.argv.length === 2 || (process.argv.length === 3 && process.argv[2] === '--check'), 'Usage: node scripts/inapp-release-verification.mjs [--check]');
  const profile = await loadApprovedProfile();
  if (process.argv[2] === '--check') { console.log('In-app staging inputs: PASS (no session inspected).'); return; }
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const identity = validateReleaseIdentity(profile, process.env, head);
  await verifyConfig(profile);
  const directory = resolve(root, '.release-evidence'); await mkdir(directory, { recursive: true });
  const nonce = randomUUID(), issuedAt = new Date().toISOString(), expiresAt = new Date(Date.now() + 900000).toISOString();
  const resultPath = resolve(directory, `inapp-result-${nonce}.json`);
  let previous;
  try { previous = JSON.parse(await readFile(resolve(directory, 'inapp-last-verified.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('Previous in-app evidence is invalid.'); }
  const previouslyVerified = previous && Object.keys(identity).every(key => previous[key] === identity[key])
    && previous.deploymentReceipt === false && /^[a-f0-9]{64}$/.test(previous.articleSha256 || '')
    && Date.now() - Date.parse(previous.corroboratedAt) >= 0 && Date.now() - Date.parse(previous.corroboratedAt) <= 72 * 3600000;
  const request = { ...identity, nonce, issuedAt, expiresAt, resultPath, requiredAction: previouslyVerified ? 'published-or-reverified' : 'published', uploadFixture: profile.uploadFixture,
    requiredChecks, instructions: 'Perform actual authenticated IAB role/list/editor/image/reload/preview/persisted-publication/mobile checks after this challenge. First run must exercise upload, save and publish. Later runs may reverify the unchanged retained image/release. Record observed outcomes, never copy a prior PASS. Write matching result JSON atomically at resultPath. No tokens or session state.' };
  await atomicJson(resolve(directory, `inapp-request-${nonce}.json`), request);
  await atomicJson(resolve(directory, 'inapp-request.json'), request);
  console.log(`INAPP VERIFICATION REQUIRED: ${resolve(directory, 'inapp-request.json')}`);
  let result;
  while (Date.now() <= Date.parse(expiresAt)) {
    try { result = JSON.parse(await readFile(resultPath, 'utf8')); break; }
    catch (error) { if (error.code !== 'ENOENT') throw new Error('Invalid in-app observations file.'); }
    await sleep(1000);
  }
  requireThat(result, 'In-app verification timed out; no release evidence accepted.');
  const observations = validateObservations(request, result);
  const current = await loadApprovedProfile();
  requireThat(current.packageSha256 === identity.packageSha256, 'Package changed during in-app verification.');
  validateReleaseIdentity(current, process.env, execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim());
  await verifyConfig(profile);
  const article = await fetchBytes(profile.origin, `/stories/${profile.expectedSlug}`);
  requireThat(article.contentType.includes('text/html'), 'Published article must be HTML.');
  validatePublicHtml(article.bytes.toString('utf8'), observations);
  const image = await fetchBytes(profile.origin, observations.imagePath);
  requireThat(/^image\/(png|jpeg|webp)(?:;|$)/i.test(image.contentType) && image.bytes.length > 0, 'Uploaded image must return supported nonempty image bytes.');
  validateObservations(request, result); // Corroboration must also finish before expiry.
  const verified = { ...observations,
    corroboratedAt: new Date().toISOString(), articleSha256: hash(article.bytes), imageSha256: hash(image.bytes),
    releaseIdEvidence: 'Persisted editor receipt observed through IAB; public HTML has no release-ID marker.',
    deploymentReceipt: false };
  await atomicJson(resolve(directory, `inapp-verified-${nonce}.json`), verified);
  await atomicJson(resolve(directory, 'inapp-last-verified.json'), verified);
  console.log(`In-app staging journey: PASS; challenge ${nonce}; action ${observations.action}; retained release ${observations.releaseId}. RA-002 performs revision revalidation and receipt creation.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
