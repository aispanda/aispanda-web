import { expect, test } from '@playwright/test';

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the staging publication gate.`);
  return value;
};

const draftId = required('STAGING_DRAFT_ID');
const expectedSlug = required('STAGING_EXPECTED_SLUG');
const expectedProject = required('TARGET_PROJECT');

test('the governed article publishes from the exact staging candidate and remains public', async ({ page }) => {
  await page.goto(`/studio?draft=${encodeURIComponent(draftId)}`);
  await expect(page.locator('[data-studio]')).toBeVisible({ timeout: 30_000 });

  const runtime = await page.evaluate(() => (
    globalThis as typeof globalThis & {
      __AISPANDA_RUNTIME_CONFIG__?: { environment?: string; firebase?: { projectId?: string } };
    }
  ).__AISPANDA_RUNTIME_CONFIG__);
  expect(runtime?.environment).toBe('staging');
  expect(runtime?.firebase?.projectId).toBe(expectedProject);

  const title = page.locator('[data-title]');
  await expect(title).not.toHaveValue('');
  await expect(page.locator('[data-slug]')).toHaveValue(expectedSlug);
  const expectedTitle = await title.inputValue();

  await page.locator('[data-save-menu] summary').click();
  await page.locator('[data-open-publish]').click();
  await expect(page.locator('[data-publish-dialog]')).toBeVisible();
  await page.locator('[data-publish]').click();

  const receipt = page.locator('[data-publication-receipt]');
  await expect(receipt).toBeVisible({ timeout: 30_000 });
  const livePath = new URL(await page.locator('[data-publication-live]').getAttribute('href') ?? '').pathname;
  expect(livePath).toBe(`/${expectedSlug}`);

  const candidatePublicUrl = new URL(livePath, page.url());
  const response = await page.request.get(candidatePublicUrl.href);
  expect(response.status()).toBe(200);
  expect(await response.text()).toContain(expectedTitle);
});
