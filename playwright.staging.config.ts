import { defineConfig, devices } from '@playwright/test';
import { loadStagingTestProfile } from './scripts/staging-test-profile.mjs';

const profile = await loadStagingTestProfile();
export default defineConfig({
  testDir: './tests/staging',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: profile.origin,
    storageState: profile.storageState,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
});
