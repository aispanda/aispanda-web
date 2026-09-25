import { test } from '@playwright/test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadStagingTestProfile } from '../../scripts/staging-test-profile.mjs';

test('designated staging article survives upload, reload, exact publication and anonymous mobile reading', async ({ page }, testInfo) => {
  test.setTimeout(180000);
  const profile = await loadStagingTestProfile();
  const { runHostedPublicationJourney } = await import(pathToFileURL(resolve(profile.release, 'runtime/tests/staging-browser-journey.mjs')).href);
  let evidence: Record<string, unknown> = { draftId: profile.draftId, origin: profile.origin };
  let outcome = 'FAIL';
  try {
    evidence = await runHostedPublicationJourney({ page, ...profile, onEvidence: progress => { evidence = progress; } });
    outcome = 'PASS';
  } finally {
    await testInfo.attach('publication-evidence', { body: JSON.stringify({ ...evidence, outcome, packageSha256: profile.packageSha256 }), contentType: 'application/json' });
  }
});
