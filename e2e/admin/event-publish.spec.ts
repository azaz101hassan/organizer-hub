import { test, expect } from '@playwright/test';
import { join } from 'node:path';

const stamp = (): string =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

function datetimeLocal(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

test.describe('admin event publish (cross-context)', () => {
  test('admin creates and publishes an event; member context sees it on /events/<id>', async ({ page, browser }) => {
    // ----- Phase 1: create a fresh label so we can match its name on the member side -----
    const labelSlug = `e2e-pub-${stamp()}`;
    const labelName = `E2E Pub ${labelSlug}`;

    await page.goto('/labels', { waitUntil: 'networkidle' });
    await page.fill('input[name="name"]', labelName);
    await page.fill('input[name="slug"]', labelSlug);
    await Promise.all([
      page.waitForLoadState('networkidle'),
      page.click('button:has-text("Add label")'),
    ]);
    await expect(page.locator('li', { hasText: labelSlug }).first()).toBeVisible();

    // ----- Phase 2: create an event referencing the label -----
    await page.goto('/events/new', { waitUntil: 'networkidle' });

    const title = `E2E Publish ${stamp()}`;
    const startsAt = datetimeLocal(new Date(Date.now() + 60 * 60 * 1000));

    await page.fill('input[name="title"]', title);
    await page.fill('input[name="startsAt"]', startsAt);
    await page.selectOption('select[name="labelId"]', { label: labelName });

    await Promise.all([
      page.waitForURL(
        (url) => /\/events\/[^/]+$/.test(url.pathname) && url.pathname !== '/events/new',
        { timeout: 20_000 },
      ),
      page.click('button[type="submit"]'),
    ]);
    const adminEventUrl = page.url();
    const eventIdMatch = /\/events\/([^/?#]+)/.exec(adminEventUrl);
    if (!eventIdMatch) throw new Error(`could not parse event id from ${adminEventUrl}`);
    const eventId = eventIdMatch[1];

    // ----- Phase 3: publish -----
    const publishBtn = page.locator('button:has-text("Publish")').first();
    await expect(publishBtn).toBeVisible();
    await publishBtn.click();
    await page.waitForLoadState('networkidle');
    // Mirror the ~500ms post-publish re-render settle from the predecessor smoke script.
    await page.waitForTimeout(500);

    // ----- Phase 4: verify visibility from a member browser context -----
    const memberStorageState = join(__dirname, '..', '.auth', 'member.json');
    const memberBaseUrl =
      process.env.WEB_ORIGIN ?? 'http://localhost:3000';

    const memberContext = await browser.newContext({
      storageState: memberStorageState,
      baseURL: memberBaseUrl,
    });
    try {
      const memberPage = await memberContext.newPage();
      await memberPage.goto(`/events/${eventId}`, { waitUntil: 'networkidle' });

      const html = await memberPage.content();
      expect(html.includes(title)).toBe(true);
      expect(html.includes(labelName)).toBe(true);
    } finally {
      await memberContext.close();
    }
  });
});
