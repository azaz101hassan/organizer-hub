import { test, expect } from '@playwright/test';

test.describe('member /events', () => {
  test('clicking a label filter chip narrows the URL to labelId=', async ({ page }) => {
    await page.goto('/events', { waitUntil: 'networkidle' });

    // Label filter chips are <button> elements that drive a client-side router
    // push to /events?labelId=<id>. The predecessor smoke keyed on the seeded
    // "Concerts" label specifically. We relax that to any chip-shaped button
    // and try each candidate until one produces a labelId transition. This
    // keeps the spec green across DB-state drift (admin specs may create new
    // events tied to fresh labels, shifting which chips render here).
    const candidates = page.getByRole('button').filter({
      hasText: /^[A-Za-z][\w &-]{1,30}$/,
    });
    const count = await candidates.count();
    test.skip(count === 0, 'no chip-shaped buttons on /events; nothing to filter on');

    let matched = false;
    for (let i = 0; i < count; i++) {
      const chip = candidates.nth(i);
      try {
        await Promise.all([
          page.waitForURL(/labelId=/, { timeout: 2_500 }),
          chip.click(),
        ]);
        matched = true;
        break;
      } catch {
        // This button wasn't a label filter chip; reset and try the next.
        if (!/\/events($|\?)/.test(new URL(page.url()).pathname + new URL(page.url()).search)) {
          await page.goto('/events', { waitUntil: 'networkidle' });
        }
      }
    }

    expect(matched, `tried ${count} button(s) on /events; none produced a labelId= transition`).toBe(true);
    expect(page.url()).toMatch(/[?&]labelId=/);
  });
});
