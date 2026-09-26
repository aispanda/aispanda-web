import { readFile, access } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installBlog } from './blog-package.mjs';

export async function loadStagingTestProfile(environment = process.env) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const approved = JSON.parse(await readFile(resolve(root, 'config/blog-staging.json'), 'utf8'));
  const fixture = JSON.parse(await readFile(resolve(root, 'config/blog-staging-test.json'), 'utf8'));
  const origin = environment.PLAYWRIGHT_BASE_URL || environment.TARGET_URL || approved.siteOrigin;
  const projectId = environment.TARGET_PROJECT || approved.projectId;
  if (origin !== approved.siteOrigin || projectId !== approved.projectId) throw new Error('Test target differs from the approved staging profile.');
  const installed = await installBlog();
  const { validateStagingSession } = await import(pathToFileURL(resolve(installed.release, 'runtime/tests/staging-preflight.mjs')));
  const storageState = resolve(root, environment.STAGING_STORAGE_STATE || '.staging-auth/publisher.json');
  const inputs = await validateStagingSession({ origin, projectId, storageState,
    productionOrigin: approved.productionSiteOrigin, productionProjectId: approved.productionProjectId,
    draftId: environment.STAGING_DRAFT_ID || fixture.draftId,
    expectedSlug: environment.STAGING_EXPECTED_SLUG || fixture.expectedSlug });
  const uploadFixture = resolve(root, fixture.uploadFixture);
  if (!uploadFixture.startsWith(root.endsWith(sep) ? root : root + sep)) throw new Error('Upload fixture must stay inside this checkout.');
  await access(uploadFixture);
  return { ...inputs, storageState, uploadFixture, packageSha256: installed.packageSha256, release: installed.release };
}
