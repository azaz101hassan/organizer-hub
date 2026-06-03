import { test, expect, type Page } from '@playwright/test';

// One-shot inventory probe. Visits every admin route and reports HTTP status,
// uncaught page errors, and console errors. Not part of the regular suite.
// Run with: pnpm -F @organizer-hub/e2e test --project=admin -g "probe"

interface RouteFinding {
  route: string;
  status: number | null;
  finalUrl: string;
  pageErrors: string[];
  consoleErrors: string[];
}

async function probe(page: Page, route: string): Promise<RouteFinding> {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];

  const onPageError = (err: Error): void => {
    pageErrors.push(err.message);
  };
  const onConsole = (msg: { type(): string; text(): string }): void => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  };

  page.on('pageerror', onPageError);
  page.on('console', onConsole);

  let status: number | null = null;
  try {
    const resp = await page.goto(route, {
      waitUntil: 'networkidle',
      timeout: 15000,
    });
    status = resp?.status() ?? null;
  } catch (err) {
    pageErrors.push(`goto threw: ${(err as Error).message}`);
  }

  // Give client-side hydration a moment to throw.
  await page.waitForTimeout(500);

  page.off('pageerror', onPageError);
  page.off('console', onConsole);

  return {
    route,
    status,
    finalUrl: page.url(),
    pageErrors,
    consoleErrors,
  };
}

/**
 * Try to read the href of the first matching link on the current page.
 * Returns null immediately (after ~3 s) if no link is rendered — avoids
 * hanging the whole probe when a list page is empty.
 */
async function firstHref(
  page: Page,
  selector: string,
): Promise<string | null> {
  try {
    return await page
      .locator(selector)
      .first()
      .getAttribute('href', { timeout: 3000 });
  } catch {
    return null;
  }
}

test.describe('admin probe', () => {
  test('inventory every admin route', async ({ page }) => {
    test.setTimeout(240_000);

    // ── Discover dynamic IDs from listing pages ──────────────────────────
    // Each discovery uses a short timeout and falls back to a sentinel ID
    // so the probe continues even when seed data is absent.

    await page.goto('/events', { waitUntil: 'networkidle', timeout: 15000 });
    // Exclude /events/new (the "create" button) — we want a real event row ID.
    const firstEventLink = await firstHref(
      page,
      'a[href^="/events/"]:not([href="/events/new"])',
    );
    const eventId =
      firstEventLink?.replace('/events/', '') ?? 'evt_does_not_exist';

    await page.goto('/coalitions', {
      waitUntil: 'networkidle',
      timeout: 15000,
    });
    const firstCoalitionLink = await firstHref(page, 'a[href^="/coalitions/"]');
    const coalitionId =
      firstCoalitionLink?.replace('/coalitions/', '') ?? 'coal_does_not_exist';

    // Try to find a campaign id from the coalition detail page (if a real
    // coalition was discovered).
    let campaignId: string | null = null;
    if (!coalitionId.startsWith('coal_does_not_exist')) {
      await page.goto(`/coalitions/${coalitionId}`, {
        waitUntil: 'networkidle',
        timeout: 15000,
      });
      const firstCampaignLink = await firstHref(
        page,
        'a[href^="/campaigns/"]',
      );
      campaignId = firstCampaignLink?.replace('/campaigns/', '') ?? null;
    }
    if (!campaignId) campaignId = 'camp_does_not_exist';

    // ── Route list ────────────────────────────────────────────────────────
    const routes: string[] = [
      '/',
      '/analytics',
      '/events',
      '/events/new',
      `/events/${eventId}`,
      `/events/${eventId}/ticket-types`,
      '/labels',
      '/coalitions',
      `/coalitions/${coalitionId}`,
      `/campaigns/${campaignId}`,
      '/members',
      '/waitlist',
      '/transactions',
      '/settings',
    ];

    const findings: RouteFinding[] = [];
    for (const r of routes) {
      const f = await probe(page, r);
      findings.push(f);
    }

    // ── Summary output ────────────────────────────────────────────────────
    /* eslint-disable no-console */
    console.log('\n=== ADMIN PROBE SUMMARY ===');
    for (const f of findings) {
      const flag =
        f.status !== 200
          ? '!'
          : f.pageErrors.length || f.consoleErrors.length
            ? '?'
            : 'OK';
      console.log(
        `${flag.padEnd(3)} ${String(f.status).padEnd(4)} ${f.route} -> ${f.finalUrl} | pageErrors=${f.pageErrors.length} consoleErrors=${f.consoleErrors.length}`,
      );
    }
    console.log('\n=== ADMIN PROBE DETAILS ===');
    for (const f of findings) {
      if (
        f.status === 200 &&
        f.pageErrors.length === 0 &&
        f.consoleErrors.length === 0
      ) {
        continue;
      }
      console.log(`\n--- ${f.route} (status=${f.status})`);
      console.log(`    finalUrl: ${f.finalUrl}`);
      for (const e of f.pageErrors) console.log(`    pageError: ${e}`);
      for (const e of f.consoleErrors) console.log(`    consoleError: ${e}`);
    }
    /* eslint-enable no-console */

    // Always pass — this is an inventory run, not a regression gate.
    expect(findings.length).toBeGreaterThan(0);
  });
});
