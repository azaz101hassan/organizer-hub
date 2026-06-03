import { test, expect } from '@playwright/test';

test.describe('admin auth', () => {
  test('storageState lands on the admin shell without a login prompt', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });

    // Admin home should render without bouncing to /auth/login.
    expect(page.url()).not.toMatch(/\/auth\/login(\?|$)/);

    // The admin shell renders a top nav and a main landmark. Richer assertions
    // (specific dashboards, labels, etc.) live in feature-specific specs.
    await expect(page.getByRole('main')).toBeVisible();
  });
});
