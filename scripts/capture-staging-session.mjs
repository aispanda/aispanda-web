import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { installBlog } from './blog-package.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const approved = JSON.parse(await readFile(resolve(root, 'config/blog-staging.json'), 'utf8'));
const fixture = JSON.parse(await readFile(resolve(root, 'config/blog-staging-test.json'), 'utf8'));
const installed = await installBlog();
const { validateStagingInputs, validateStagingSession } = await import(pathToFileURL(resolve(installed.release, 'runtime/tests/staging-preflight.mjs')));
const target = validateStagingInputs({ origin: approved.siteOrigin, projectId: approved.projectId,
  productionOrigin: approved.productionSiteOrigin, productionProjectId: approved.productionProjectId, ...fixture });
const response = await fetch(target.origin + '/api/content/config', { redirect: 'error' });
if (!response.ok) throw new Error('Staging configuration is unavailable');
const runtime = await response.json();
if (runtime.environment !== 'staging' || runtime.firebase?.projectId !== target.projectId
  || runtime.siteOrigin !== target.origin || runtime.articleSiteOrigin !== target.origin) throw new Error('Staging configuration does not match the approved target');

const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--start-maximized'] });
try {
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();
  await page.goto(target.origin + '/account');
  await page.evaluate(() => { document.title = 'AIspanda release test — sign in here'; });
  console.log('Sign in in the Chrome window titled AIspanda release test. Leave it open; the session saves automatically after successful staging access.');
  await page.waitForURL(url => url.origin === target.origin && url.pathname === '/', { timeout: 900000 });
  await page.goto(target.origin + '/account');
  await expect(page.locator('[data-account-content]')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('[data-account-role]')).toHaveText(/^(Administrator|Publisher)$/);
  const captured = await context.storageState({ indexedDB: true });
  const hostname = new URL(target.origin).hostname;
  const state = { cookies: captured.cookies.filter(cookie => cookie.domain.replace(/^\./, '') === hostname),
    origins: captured.origins.filter(origin => origin.origin === target.origin) };
  await mkdir(resolve(root, '.staging-auth'), { recursive: true });
  const storageState = resolve(root, '.staging-auth/publisher.json');
  await writeFile(storageState, JSON.stringify(state), { mode: 0o600 });
  await validateStagingSession({ ...target, storageState });
  console.log('PASS: isolated staging test session saved; no credentials printed or committed.');
} finally { await browser.close(); }
