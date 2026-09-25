import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function loadBlogAdapter({ db, auth, bucket }) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const installRoot = resolve(root, '.blog');
  const pointer = JSON.parse(await readFile(resolve(installRoot, 'current.json'), 'utf8'));
  const release = resolve(installRoot, pointer.release);
  if (!release.startsWith(resolve(installRoot, 'releases') + sep)) throw new Error('Invalid blog release pointer');
  const runtime = resolve(release, 'runtime');
  process.env.BLOG_COLLECTION_PROFILE = resolve(root, 'config/blog-collections.json');
  const { createBlogServer } = await import(pathToFileURL(resolve(runtime, 'server/server.mjs')));
  const { loadStartupConfig } = await import(pathToFileURL(resolve(runtime, 'server/startup-config.mjs')));
  const { loadBuiltProductionProfile } = await import(pathToFileURL(resolve(runtime, 'server/production-profile.mjs')));
  const { loadSiteProfile } = await import(pathToFileURL(resolve(runtime, 'site-profile.mjs')));
  const { mountBlog } = await import(pathToFileURL(resolve(release, 'assets/integrations/node-blog.mjs')));
  const config = loadStartupConfig();
  if (config.articleSiteOrigin !== config.siteOrigin) throw new Error('Native blog article origin must match the host origin');
  const site = config.emulators ? loadSiteProfile({ BLOG_SITE_PROFILE: resolve(root, 'config/blog-site.json') }) : loadBuiltProductionProfile(config.siteOrigin, {
    environment: config.environment,
    projectId: config.firebase.projectId,
    stagingProfilePath: config.environment === 'staging'
      ? resolve(root, 'config/blog-staging.json') : undefined,
  });
  const distRoot = resolve(runtime, 'dist');
  const publicContent = await import(pathToFileURL(resolve(runtime, 'server/content-publishing.mjs')));
  const hostArticles = JSON.parse(await readFile(resolve(root, 'config/blog-articles.json'), 'utf8'));
  return {
    handle: mountBlog({ distRoot, hostDistRoot: resolve(root, 'dist'), server: createBlogServer({ db, auth, bucket, siteOrigin: config.siteOrigin, siteName: site.siteName, runtimeConfig: config, distRoot, hostArticles }) }),
    publicContent,
  };
}
