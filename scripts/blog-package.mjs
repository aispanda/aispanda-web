// Consumer adapter only. The installer/runtime remain hash-pinned reusable artifacts.
import { readFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
export async function installBlog() {
  const lock = JSON.parse(await readFile(resolve(root, 'vendor/blog/lock.json'), 'utf8'));
  const installer = resolve(root, 'vendor/blog/package.mjs');
  const bytes = await readFile(installer);
  if (createHash('sha256').update(bytes).digest('hex') !== lock.installerSha256) throw new Error('Blog installer integrity mismatch');
  const { installPackage, activateRelease } = await import(pathToFileURL(installer));
  const archive = resolve(root, 'vendor/blog', lock.archive);
  if (dirname(archive) !== resolve(root, 'vendor/blog')) throw new Error('Invalid archive path');
  const installRoot = resolve(root, '.blog');
  await mkdir(installRoot, { recursive: true });
  const result = await installPackage(archive, lock.packageSha256, installRoot);
  await activateRelease(installRoot, result.release, archive, lock.packageSha256);
  return result;
}
async function main() {
  const mode = process.argv[2];
  if (!['install', 'build', 'test'].includes(mode)) throw new Error('Usage: node scripts/blog-package.mjs install|build|test');
  const result = await installBlog();
  if (mode !== 'install') {
    const runtime = resolve(result.release, 'runtime');
    const env = { ...process.env, BLOG_SITE_PROFILE: resolve(root, 'config/blog-site.json'), BLOG_COLLECTION_PROFILE: resolve(root, 'config/blog-collections.json') };
    if (mode === 'build') {
      env.PUBLIC_SITE_ORIGIN = JSON.parse(await readFile(env.BLOG_SITE_PROFILE, 'utf8')).siteOrigin;
      env.BLOG_PRODUCTION_PROJECT_ID = 'aispanda';
      const profile = spawnSync(process.execPath, [resolve(runtime, 'server/production-profile.mjs')], { cwd: runtime, env, stdio: 'inherit' });
      if (profile.status !== 0) throw new Error('Production profile verification failed');
    }
    // Explicit argv; install separately using the locked runtime package manager.
    const args = mode === 'build' ? [resolve(runtime, 'node_modules/astro/bin/astro.mjs'), 'build'] : ['--test', 'tests/editorial-workflow.test.mjs'];
    const run = spawnSync(process.execPath, args, { cwd: runtime, env, stdio: 'inherit' });
    if (run.status !== 0) throw new Error('Blog ' + mode + ' failed; confirm locked dependencies and emulator prerequisites');
  }
  console.log(JSON.stringify({ stage: mode, ...result }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
