import { test, expect } from '@playwright/test';

test('visitor can use the homepage primary action to reach the Principles page', async ({ page }) => {
  await page.goto('/');

  const primaryAction = page.getByRole('link', { name: 'See how the work is judged' });
  await expect(primaryAction).toBeVisible();
  await expect(primaryAction).toHaveAttribute('href', '/principles');

  await primaryAction.click();

  await expect(page).toHaveURL(/\/principles\/?$/);
  await expect(page.getByRole('heading', { name: 'The 10 principles of building with AI' })).toBeVisible();
});
