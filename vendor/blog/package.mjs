// Offline package/install/activation only. Never installs dependencies or changes a cloud service.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const MAX = 24 * 1024 * 1024;
const excluded = new Set(['node_modules', 'dist', '.astro', '.git', '__pycache__', 'test-results', 'playwright-report']);
const required = ['SKILL.md', 'CAPABILITY.md', 'runtime/package.json', 'runtime/pnpm-lock.yaml', 'runtime/pnpm-workspace.yaml', 'runtime/server/start.mjs', 'runtime/firestore.rules'];
const roots = new Set(['agents', 'assets', 'references', 'scripts', 'runtime']);
const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
function safeName(name) {
  if (typeof name !== 'string' || name.length > 400 || name.includes('\\') || name.startsWith('/') || name.split('/').some(p => !p || p === '.' || p === '..' || /[:\x00-\x1f]/.test(p) || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p))) throw new Error('Unsafe package path');
  return name;
}
async function plainDirectory(directory) {
  const absolute = path.resolve(directory);
  if ((await fs.lstat(absolute)).isSymbolicLink()) throw new Error('Symlink/junction installation roots are not supported');
  const real = await fs.realpath(absolute);
  if (!samePath(real, absolute)) throw new Error('Symlink/junction installation roots are not supported');
  if (!(await fs.stat(real)).isDirectory()) throw new Error('Directory required');
  return real;
}
export async function collect(root) {
  const allowlist = JSON.parse(await fs.readFile(path.join(root, 'assets/package-files.json'), 'utf8'));
  if (!Array.isArray(allowlist) || !allowlist.includes('assets/package-files.json') || new Set(allowlist).size !== allowlist.length) throw new Error('Explicit package allowlist required');
  const allowed = new Set(allowlist.map(safeName));
  const files = [];
  async function visit(relative = '') {
    for (const item of (await fs.readdir(path.join(root, relative), { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
      const name = relative ? relative + '/' + item.name : item.name;
      if (excluded.has(item.name) || /(?:\.log|\.tgz|\.gz|\.zip|\.tmp|\.pyc)$/.test(item.name) || item.name === '.env' || item.name.startsWith('.env.') && item.name !== '.env.example') continue;
      if (!relative && !roots.has(item.name) && !['SKILL.md', 'CAPABILITY.md'].includes(item.name)) throw new Error('Unclassified root file: ' + name);
      safeName(name);
      if (item.isSymbolicLink()) throw new Error('Symlink forbidden: ' + name);
      if (item.isDirectory()) await visit(name);
      else if (item.isFile()) {
        if (!allowed.has(name) || /(?:^|\/)(?:\.auth|private|credentials|service[-_]account|firebase-export)(?:[/.\-_]|$)/i.test(name)) throw new Error('Unclassified/private file: ' + name);
        const bytes = await fs.readFile(path.join(root, name));
        if (bytes.length > 4 * 1024 * 1024) throw new Error('Oversized source: ' + name);
        const text = bytes.toString('utf8');
        if (/-----BEGIN [A-Z ]*PRIVATE KEY-----|"private_key"\s*:/u.test(text)) throw new Error('Credential material forbidden: ' + name);
        files.push({ path: name, size: bytes.length, sha256: sha(bytes), data: bytes.toString('base64') });
      } else throw new Error('Non-file package entry');
    }
  }
  await visit();
  if (files.length !== allowed.size) throw new Error('Allowlisted file missing or excluded');
  return files;
}
function verifyPayload(payload) {
  if (payload?.format !== 'blog-capability/1' || !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(payload.version) || payload.releaseScope !== 'local-integration-candidate' || !Array.isArray(payload.files) || payload.files.length > 1000) throw new Error('Invalid package manifest');
  const names = new Set();
  let size = 0;
  for (const file of payload.files) {
    const name = safeName(file.path);
    const key = name.toLowerCase();
    if (names.has(key)) throw new Error('Duplicate package path');
    names.add(key);
    if (typeof file.data !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.data)) throw new Error('Invalid base64');
    const bytes = Buffer.from(file.data, 'base64');
    size += bytes.length;
    if (size > MAX || file.size !== bytes.length || sha(bytes) !== file.sha256) throw new Error('File integrity mismatch');
  }
  for (const name of required) if (!names.has(name.toLowerCase())) throw new Error('Missing runtime file: ' + name);
  const manifest = JSON.parse(Buffer.from(payload.files.find(f => f.path === 'runtime/package.json').data, 'base64'));
  if (manifest.version !== payload.version || manifest.private !== true) throw new Error('Runtime version/private boundary mismatch');
  return payload;
}
export async function buildPackage(root, outputDirectory) {
  root = await plainDirectory(root);
  const files = await collect(root);
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'runtime/package.json'), 'utf8'));
  const payload = verifyPayload({ format: 'blog-capability/1', version: manifest.version, releaseScope: 'local-integration-candidate', files });
  const bytes = gzipSync(Buffer.from(JSON.stringify(payload)), { level: 9 });
  if (bytes.length > MAX) throw new Error('Package too large');
  const packageSha256 = sha(bytes);
  await fs.mkdir(outputDirectory, { recursive: true });
  const output = await plainDirectory(outputDirectory);
  if (output === root || output.startsWith(root + path.sep)) throw new Error('Package output must be outside reusable source');
  const packagePath = path.join(output, `blog-community-${manifest.version}-${packageSha256.slice(0,12)}.blog.json.gz`);
  try { await fs.writeFile(packagePath, bytes, { flag: 'wx' }); }
  catch (error) { if (error.code !== 'EEXIST' || sha(await fs.readFile(packagePath)) !== packageSha256) throw error; }
  return { packageVersion: manifest.version, packagePath, packageSha256, fileCount: files.length, bytes: bytes.length, releaseScope: payload.releaseScope };
}
export async function readPackage(filename, expectedHash) {
  if (!/^[a-f0-9]{64}$/.test(expectedHash ?? '')) throw new Error('Explicit SHA-256 required');
  const stat = await fs.lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX) throw new Error('Invalid archive');
  const bytes = await fs.readFile(filename);
  if (sha(bytes) !== expectedHash) throw new Error('Archive SHA-256 mismatch');
  return verifyPayload(JSON.parse(gunzipSync(bytes, { maxOutputLength: MAX * 2 }).toString('utf8')));
}
async function verifyInstalled(release, receipt) {
  await plainDirectory(release);
  for (const file of receipt.files) {
    safeName(file.path);
    const target = path.join(release, file.path);
    if ((await fs.lstat(target)).isSymbolicLink() || !samePath(await fs.realpath(target), target) || sha(await fs.readFile(target)) !== file.sha256) throw new Error('Installed source changed: ' + file.path);
  }
}
async function destinationAbsent(release) {
  try { await fs.lstat(release); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw Object.assign(new Error('Installation destination already exists; it was not changed'), { code: 'INSTALL_DESTINATION_EXISTS' });
}
// Retry only transient rename failures. Never copy into, merge or remove the final
// destination. The caller holds a lock for cooperating installers; an untrusted
// process with write access to this directory is outside that lock's protection.
export async function commitInstallDirectory(temporary, release, operations = {}) {
  const rename = operations.rename ?? fs.rename;
  const wait = operations.delay ?? delay;
  const delays = [100, 200, 400, 800, 1600];
  let attempts = 0;
  for (;;) {
    let renameAttempted = false;
    try {
      await destinationAbsent(release);
      attempts++;
      renameAttempted = true;
      await rename(temporary, release);
      return attempts;
    } catch (error) {
      if (renameAttempted && ['EPERM', 'EBUSY'].includes(error.code) && attempts <= delays.length) {
        await wait(delays[attempts - 1]);
        continue;
      }
      error.installation = { phase: 'commit', code: error.code ?? 'INSTALL_COMMIT_FAILED', attempts, retainedPath: temporary, release };
      throw error;
    }
  }
}
export async function installPackage(filename, expectedHash, installRoot, operations = {}) {
  const payload = await readPackage(filename, expectedHash);
  await fs.mkdir(installRoot, { recursive: true });
  const root = await plainDirectory(installRoot);
  const releases = path.join(root, 'releases');
  await fs.mkdir(releases, { recursive: true });
  await plainDirectory(releases);
  const release = path.join(releases, `${payload.version}-${expectedHash.slice(0,12)}`);
  const receipt = { format: 'blog-install/1', version: payload.version, packageSha256: expectedHash, files: payload.files.map(({path,size,sha256}) => ({path,size,sha256})) };
  const lock = release + '.install-lock';
  try {
    await fs.mkdir(lock);
  } catch (error) {
    if (error.code === 'EEXIST') throw Object.assign(new Error('Installation lock exists; another install or an interrupted run requires inspection'), { code: 'INSTALL_BUSY', installation: { phase: 'lock', code: 'INSTALL_BUSY', lock, release } });
    throw error;
  }
  let retainedPath;
  let phase = 'inspect';
  let failure;
  let completedResult;
  try {
    try {
      const previous = JSON.parse(await fs.readFile(path.join(release, 'installation-receipt.json'), 'utf8'));
      if (JSON.stringify(previous) !== JSON.stringify(receipt)) throw new Error('Existing installation receipt mismatch');
      await verifyInstalled(release, payload);
      return completedResult = { status: 'ALREADY_INSTALLED', release, version: payload.version, packageSha256: expectedHash };
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await destinationAbsent(release);
    const temporary = path.join(releases, '.install-' + randomUUID());
    await fs.mkdir(temporary);
    retainedPath = temporary;
    phase = 'extract';
    for (const file of payload.files) {
      const target = path.join(temporary, file.path);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, Buffer.from(file.data, 'base64'), { flag: 'wx' });
    }
    await fs.writeFile(path.join(temporary, 'installation-receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
    const commitAttempts = await commitInstallDirectory(temporary, release, operations);
    retainedPath = release;
    phase = 'verify';
    await verifyInstalled(release, payload);
    return completedResult = { status: 'INSTALLED', release, version: payload.version, packageSha256: expectedHash, commitAttempts };
  } catch (error) {
    error.installation ??= { phase, code: error.code ?? 'INSTALL_FAILED', retainedPath, release };
    failure = error;
    throw error;
  } finally {
    // Only our empty lock is removed. Never auto-clear another process's lock or
    // remove retained extraction directories after a failure.
    try { await (operations.removeLock ?? fs.rmdir)(lock); }
    catch (error) {
      const lockCleanup = { code: error.code ?? 'LOCK_CLEANUP_FAILED', lock };
      if (failure) failure.installation.lockCleanup = lockCleanup;
      else throw Object.assign(new Error('Installation verified, but its lock could not be removed; inspect the retained lock before retrying'), {
        code: 'INSTALL_LOCK_CLEANUP_FAILED',
        installation: { phase: 'lock-cleanup', completed: true, result: completedResult, lockCleanup }
      });
    }
  }
}
export async function activateRelease(installRoot, releasePath, archivePath, expectedHash) {
  const payload = await readPackage(archivePath, expectedHash);
  const root = await plainDirectory(installRoot);
  const release = await plainDirectory(releasePath);
  if (path.dirname(release) !== path.join(root, 'releases') || path.basename(release) !== `${payload.version}-${expectedHash.slice(0,12)}`) throw new Error('Release is not owned by installation');
  // The mutable installation receipt is never an integrity authority. Revalidate
  // all installed source against the caller's exact hash-pinned original archive.
  await verifyInstalled(release, payload);
  const pointer = { format: 'blog-activation/1', release: path.relative(root, release).replaceAll('\\','/'), version: payload.version, packageSha256: expectedHash, scope: 'local-code-only' };
  const temporary = path.join(root, '.current-' + randomUUID() + '.json');
  await fs.writeFile(temporary, JSON.stringify(pointer, null, 2) + '\n', { flag: 'wx' });
  await fs.rename(temporary, path.join(root, 'current.json'));
  return pointer;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, ...args] = process.argv.slice(2);
  try {
    let result;
    if (mode === 'pack' && args.length === 2) result = await buildPackage(...args);
    else if (mode === 'install' && args.length === 3) result = await installPackage(...args);
    else if ((mode === 'activate' || mode === 'rollback') && args.length === 4) result = await activateRelease(...args);
    else throw new Error('Usage: package.mjs pack SOURCE OUTPUT | install ARCHIVE SHA256 INSTALL_ROOT | activate|rollback INSTALL_ROOT RELEASE ARCHIVE SHA256');
    console.log(JSON.stringify(result));
  } catch (error) { console.error(JSON.stringify({ status: 'BLOCKED', error: error.message, installation: error.installation })); process.exitCode = 1; }
}
