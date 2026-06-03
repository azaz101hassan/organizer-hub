import type { Page } from '@playwright/test';

export interface SignupResult {
  name: string;
  email: string;
  password: string;
}

// Drive a fresh OIDC signup through the member app's /auth/login. The member
// app redirects to accounts:3002/interaction/<id>. We click the "Create an
// account" link, fill name/email/password, submit, and wait for the redirect
// back to the member origin. Selectors mirror scripts/admin-member-smoke.mjs
// (input[name=...] and button[type=submit]).
export async function signupViaMember(
  page: Page,
  memberUrl: string,
  accountsUrl: string,
): Promise<SignupResult> {
  const unique = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const result: SignupResult = {
    name: `E2E ${unique}`,
    email: `${unique}@example.test`,
    password: `Pw-${unique}!aA1`,
  };

  await page.goto(`${memberUrl}/auth/login`, { waitUntil: 'networkidle' });
  if (!page.url().startsWith(`${accountsUrl}/interaction/`)) {
    throw new Error(`unexpected interaction url: ${page.url()}`);
  }

  await page.click('a[href*="/signup"]');
  await page.waitForLoadState('domcontentloaded');

  await page.fill('input[name="name"]', result.name);
  await page.fill('input[name="email"]', result.email);
  await page.fill('input[name="password"]', result.password);

  await Promise.all([
    page.waitForLoadState('networkidle'),
    page.click('button[type="submit"]'),
  ]);

  // After signup OIDC completes, the page is back on the member origin.
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (page.url().startsWith(memberUrl)) return result;
    await page.waitForTimeout(200);
  }
  throw new Error(`signup never landed on member; last=${page.url()}`);
}

// Sign in the same user against the admin app to seed admin cookies. The
// /auth/login redirects to the same accounts interaction surface; some
// flows insert a consent step after credentials, which we submit defensively
// by clicking any next submit button while still on /interaction/.
export async function signinExistingViaApp(
  page: Page,
  appUrl: string,
  accountsUrl: string,
  creds: SignupResult,
): Promise<void> {
  await page.goto(`${appUrl}/auth/login`, { waitUntil: 'networkidle' });
  if (!page.url().startsWith(`${accountsUrl}/interaction/`)) {
    throw new Error(`unexpected interaction url: ${page.url()}`);
  }

  await page.fill('input[name="email"]', creds.email);
  await page.fill('input[name="password"]', creds.password);

  await Promise.all([
    page.waitForLoadState('networkidle'),
    page.click('button[type="submit"]'),
  ]);

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const url = page.url();
    if (url.startsWith(appUrl)) return;
    if (/\/interaction\/[^/]+$/.test(url)) {
      // Likely a consent screen — submit defensively.
      const btn = await page.$('button[type="submit"]');
      if (btn) {
        await Promise.all([
          page.waitForLoadState('networkidle'),
          btn.click(),
        ]).catch(() => undefined);
        continue;
      }
    }
    await page.waitForTimeout(200);
  }
  throw new Error(`signin never landed on ${appUrl}; last=${page.url()}`);
}
