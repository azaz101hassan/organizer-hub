import type { Page } from '@playwright/test';

export interface SignupResult {
  name: string;
  email: string;
  password: string;
}

// Drive a fresh OIDC signup through the member app's /auth/login/authorize.
// That route sets PKCE cookies and immediately redirects to
// accounts:3002/oidc/auth, which in turn redirects to
// accounts:3002/interaction/<id>. We click the "Create an account" link,
// fill name/email/password, submit, and wait for the redirect back to the
// member origin. Selectors match the accounts app's HTML form attributes.
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

  // /auth/login/authorize (not /auth/login) immediately fires the OIDC redirect
  // to accounts. /auth/login is a static landing page with a "Continue" button.
  await page.goto(`${memberUrl}/auth/login/authorize`, { waitUntil: 'networkidle' });
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

// Sign in the same user against any app to seed its cookies. loginPath is the
// app-specific route that fires the OIDC redirect (e.g. '/auth/login' for
// admin, '/auth/login/authorize' for member). Lands on accounts:3002/interaction/
// <id> after the redirect chain resolves. Some flows insert a consent step
// after credentials, which we submit defensively while still on /interaction/.
export async function signinExistingViaApp(
  page: Page,
  appUrl: string,
  accountsUrl: string,
  creds: SignupResult,
  loginPath = '/auth/login',
): Promise<void> {
  await page.goto(`${appUrl}${loginPath}`, { waitUntil: 'networkidle' });
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
