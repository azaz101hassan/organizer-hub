import { test, expect } from '@playwright/test';

test.describe('member auth', () => {
  test('storageState lands on /dashboard without a login prompt', async ({ page }) => {
    await page.goto('/dashboard', { waitUntil: 'networkidle' });

    // We expect to be on /dashboard. If storageState was missing or stale,
    // the member app would have redirected to /auth/login.
    expect(page.url()).toMatch(/\/dashboard(\?|$)/);

    // A signed-in /dashboard renders the main landmark. The richer
    // assertions (membership card, browse, etc.) land in member/dashboard.spec.ts.
    await expect(page.getByRole('main')).toBeVisible();
  });
});
