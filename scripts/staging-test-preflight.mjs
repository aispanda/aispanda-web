import { loadStagingTestProfile } from './staging-test-profile.mjs';
try {
  const profile = await loadStagingTestProfile();
  console.log(JSON.stringify({ status: 'READY', origin: profile.origin, projectId: profile.projectId,
    draftId: profile.draftId, packageSha256: profile.packageSha256,
    scope: 'Inputs and isolated session are present; the browser journey still verifies current access and publication.' }));
} catch (error) {
  console.error('Staging test setup is incomplete: ' + error.message);
  console.error('Create a separate staging browser session using the instructions in docs/AI_114_STAGING_TEST.md.');
  process.exitCode = 1;
}
