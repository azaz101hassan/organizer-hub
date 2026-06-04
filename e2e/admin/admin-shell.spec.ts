import { test, expect } from '@playwright/test';

test.describe('admin shell regressions', () => {
  test('settings page renders without 500', async ({ page }) => {
    const [response] = await Promise.all([
      page.waitForResponse((r) => new URL(r.url()).pathname === '/settings'),
      page.goto('/settings', { waitUntil: 'networkidle' }),
    ]);

    expect(response.status()).toBe(200);
    await expect(page.getByRole('heading', { name: /branding/i })).toBeVisible();
  });

  test('coalitions list renders without 404', async ({ page }) => {
    const [response] = await Promise.all([
      page.waitForResponse((r) => new URL(r.url()).pathname === '/coalitions'),
      page.goto('/coalitions', { waitUntil: 'networkidle' }),
    ]);

    expect(response.status()).toBe(200);
    await expect(page.getByRole('heading', { name: /coalitions/i })).toBeVisible();
  });

  test('analytics fetch does not 400 on the API', async ({ page }) => {
    const badResponses: { url: string; status: number }[] = [];

    page.on('response', (response) => {
      const url = new URL(response.url());
      if (url.pathname.startsWith('/api/') && response.status() >= 400) {
        badResponses.push({ url: response.url(), status: response.status() });
      }
    });

    await page.goto('/analytics', { waitUntil: 'networkidle' });

    const badApiCalls = badResponses.filter((r) => r.status === 400);
    expect(badApiCalls).toHaveLength(0);
  });

  test('members nav entry is no longer present', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(
      page.locator('nav').getByRole('link', { name: 'Members' }),
    ).toHaveCount(0);
  });
});
