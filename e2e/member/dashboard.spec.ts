import { test, expect } from '@playwright/test';

test.describe('member dashboard', () => {
  test('renders Membership, My requests, and Overview content', async ({ page }) => {
    await page.goto('/dashboard', { waitUntil: 'networkidle' });

    // The predecessor smoke matched on text content rather than role+name because
    // these card titles may not be wrapped in semantic heading elements. Keep the
    // same approach: look for each substring in the rendered page.
    // Live UI: dashboard shows a "Membership" stat card, "My requests" nav item,
    // and an "Overview" heading — there is no "Browse" card in the current build.
    await expect(page.getByText(/membership/i).first()).toBeVisible();
    await expect(page.getByText(/my requests/i).first()).toBeVisible();
    await expect(page.getByText(/overview/i).first()).toBeVisible();
  });
});
