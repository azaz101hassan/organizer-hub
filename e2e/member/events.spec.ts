import { test, expect } from '@playwright/test';

test.describe('member /events', () => {
  test('clicking the Concerts label chip narrows the URL to labelId=', async ({ page }) => {
    await page.goto('/events', { waitUntil: 'networkidle' });

    // The seeded "Concerts" label is rendered as a button chip on the events
    // index. Matching on `has-text` mirrors the predecessor smoke's selector.
    // Note: the chips are <button> elements, not <a> elements — the URL
    // transition is driven by a client-side router push on click, not href.
    const concerts = page.locator('button').filter({ hasText: /^Concerts$/i }).first();
    await expect(concerts).toBeVisible();

    // Next.js client-side navigation never fires a load event, so we wait on
    // the URL transition rather than waitForLoadState.
    await Promise.all([
      page.waitForURL(/labelId=/, { timeout: 10_000 }),
      concerts.click(),
    ]);

    expect(page.url()).toMatch(/[?&]labelId=/);
  });
});
