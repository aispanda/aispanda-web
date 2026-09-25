import { defineConfig, devices } from '@playwright/test';
import { readFileSync } from 'node:fs';

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the staging publication gate.`);
  return value;
};

const baseURL = required('PLAYWRIGHT_BASE_URL');
const storageState = required('STAGING_STORAGE_STATE');
let storedOrigins: Array<{ origin?: string; indexedDB?: unknown[]; localStorage?: Array<{ name: string; value: string }> }>;
try {
  storedOrigins = JSON.parse(readFileSync(storageState, 'utf8')).origins ?? [];
} catch {
  throw new Error('STAGING_STORAGE_STATE must be a readable Playwright storage-state JSON file.');
}
const targetOrigin = new URL(baseURL).origin;
const matchingOrigin = storedOrigins.find((entry) => entry.origin === targetOrigin);
const hasLocalAuth = matchingOrigin?.localStorage?.some(entry => entry.name.startsWith('firebase:authUser:') && entry.value.length > 0);
const hasIndexedAuth = Array.isArray(matchingOrigin?.indexedDB) && matchingOrigin.indexedDB.length > 0;
if (!matchingOrigin || (!hasLocalAuth && !hasIndexedAuth)) {
  throw new Error('STAGING_STORAGE_STATE must contain a Firebase Auth session captured on the stable staging origin. The live gate also verifies the signed-in account.');
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
