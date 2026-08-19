import { test, expect } from '@playwright/test';

test('visitor can submit a fictional support request and view the returned case', async ({ page }) => {
  const subject = 'Playwright MVP confirmation';
  const message = 'This fictional request verifies the first deterministic browser journey.';
  const caseNumber = `CASE-AI50-${Date.now()}`;

  await page.route('**/test-supportzero-intake', async (route) => {
    expect(route.request().method()).toBe('POST');
    expect(route.request().postDataJSON()).toMatchObject({
      name: 'AI-50 Test Visitor',
      email: 'ai50-test@example.invalid',
      organization: null,
      subject,
      message,
      confirm_non_confidential: true,
      website: '',
    });
    await route.fulfill({ json: { case_number: caseNumber } });
  });

  await page.goto('/support-form-demo');

  await expect(page.getByRole('heading', { name: 'Submit a demo support request.' })).toBeVisible();

  await page.getByLabel('Full name').fill('AI-50 Test Visitor');
  await page.getByLabel('Email address').fill('ai50-test@example.invalid');
  await page.getByLabel('Subject').fill(subject);
  await page.getByLabel('Support request').fill(message);
  await page.getByLabel(/I confirm this is fictional demo content/).check();
  await page.getByRole('button', { name: 'Submit support request' }).click();

  await expect(page).toHaveURL(/\/support-form-demo\/confirmation$/);
  await expect(page.getByRole('heading', { name: 'Thank you for submitting the support form.' })).toBeFocused();
  await expect(page.locator('#confirmation-case-number')).toHaveText(caseNumber);
  await expect(page.locator('#confirmation-subject')).toHaveText(subject);
  await expect(page.getByRole('link', { name: 'View this Case' })).toHaveAttribute(
    'href',
    new RegExp(`[?&]view=case&case=${caseNumber}$`),
  );
});
