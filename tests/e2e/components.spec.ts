import { test, expect } from '@playwright/test';

// Component-level checks for the shared Astro components on real pages.

test('asset card exposes maturity, proof, topics and a named explore link', async ({ page }) => {
  await page.goto('/');
  const card = page.locator('article.asset-card').first();
  const name = (await card.getByRole('heading', { level: 3 }).textContent())?.trim() ?? '';
  expect(name).not.toBe('');

  const badge = card.locator('.status-badge');
  await expect(badge).not.toHaveAttribute('aria-label');
  await expect(badge).toContainText('Maturity:');

  await expect(card.getByRole('group', { name: 'Proof' })).toBeVisible();
  await expect(card.getByRole('group', { name: 'Proof' }).getByRole('heading', { level: 4, name: 'Proof' })).toBeVisible();
  await expect(card.locator('time')).toHaveAttribute('datetime', /^\d{4}-\d{2}-\d{2}$/);

  const topics = card.getByRole('list', { name: 'Asset topics' });
  await expect(topics.getByRole('listitem').first()).toBeVisible();

  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await expect(card.getByRole('link', { name: new RegExp(`^Explore asset\\s*:\\s*${escaped}$`) })).toBeVisible();
});

test('proof blocks are not page landmarks', async ({ page }) => {
  await page.goto('/assets');
  await expect(page.getByRole('region', { name: 'Proof' })).toHaveCount(0);
  expect(await page.getByRole('group', { name: 'Proof' }).count()).toBeGreaterThan(1);
});

test('principle cards name their number in the heading', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 3, name: /^Principle 01: / })).toBeVisible();
  await expect(page.locator('.principle-card')).toHaveCount(4);
});

test('about page audience cards follow the page heading order', async ({ page }) => {
  await page.goto('/about');
  const levels = await page.locator('main h1, main h2, main h3').evaluateAll((els) => els.map((el) => Number(el.tagName[1])));
  expect(levels[0]).toBe(1);
  for (let i = 1; i < levels.length; i++) expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
  await expect(page.getByRole('heading', { level: 2, name: 'See the path to value.' })).toBeVisible();
});

test('asset detail topics render as styled chips', async ({ page }) => {
  await page.goto('/assets/model-routing');
  const item = page.getByRole('list', { name: 'Asset topics' }).getByRole('listitem').first();
  await expect(item).toBeVisible();
  const style = await item.evaluate((el) => ({ radius: getComputedStyle(el).borderTopLeftRadius, marker: getComputedStyle(el).listStyleType }));
  expect(style.radius).not.toBe('0px');
  expect(style.marker).toBe('none');
});

test('mobile menu closes with Escape and returns focus to the button', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const button = page.getByRole('banner').getByRole('button', { name: 'Menu' });
  await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeHidden();
  await expect(button).toBeFocused();
});
