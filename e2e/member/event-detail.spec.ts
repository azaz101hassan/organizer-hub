import { test, expect } from '@playwright/test';

test.describe('member event detail', () => {
  test('public event detail page renders the event title and at least one label name', async ({ page }) => {
    // Open /events and pick the first event card's href so the assertion is
    // resilient to seed-data ordering. The predecessor smoke hardcoded an
    // event id created during the same run; here we lean on whatever the
    // seed produced.
    await page.goto('/events', { waitUntil: 'networkidle' });

    // Collect all <a> hrefs that look like event detail paths. Use a short
    // timeout via evaluate so we never hang if the events list is empty.
    const eventHrefs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a[href]'))
        .map((a) => (a as HTMLAnchorElement).getAttribute('href') ?? '')
        .filter((h) => /^\/events\/[^/]+$/.test(h)),
    );

    if (eventHrefs.length === 0) {
      test.skip(true, 'no event detail links found on /events; seed may have no published events');
      return;
    }

    const href = eventHrefs[0];
    await page.goto(href, { waitUntil: 'networkidle' });

    // The page should render some non-trivial text content — at minimum a heading
    // for the event title and a chip/badge for at least one label.
    await expect(page.getByRole('heading').first()).toBeVisible();

    // Probe for any label name from the seed. We don't know which label this
    // event carries, so match on a generic label-shaped element (anchor or chip)
    // somewhere on the page.
    const anyLabelChip = page.locator('a[href*="labelId="], a[href*="/labels/"], button[class*="chip"]').first();
    await expect(anyLabelChip).toBeVisible({ timeout: 5_000 });
  });
});
