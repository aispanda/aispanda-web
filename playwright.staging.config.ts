import { defineConfig, devices } from '@playwright/test';
import { readFileSync } from 'node:fs';

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the staging publication gate.`);
  return value;
};

const baseURL = required('PLAYWRIGHT_BASE_URL');
const storageState = required('STAGING_STORAGE_STATE');
let storedOrigins: Array<{ origin?: string; indexedDB?: unknown[] }>;
try {
  storedOrigins = JSON.parse(readFileSync(storageState, 'utf8')).origins ?? [];
} catch {
  throw new Error('STAGING_STORAGE_STATE must be a readable Playwright storage-state JSON file.');
}
const targetOrigin = new URL(baseURL).origin;
const matchingOrigin = storedOrigins.find((entry) => entry.origin === targetOrigin);
if (!matchingOrigin || !Array.isArray(matchingOrigin.indexedDB) || matchingOrigin.indexedDB.length === 0) {
  throw new Error('STAGING_STORAGE_STATE must contain Firebase Auth IndexedDB captured on the stable staging origin.');
}

export default defineConfig({
  testDir: './tests/staging',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    ...devices['Desktop Chrome'],
    baseURL,
    storageState,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
});
