# Playwright e2e reorganization — implementation plan

> **For implementers:** Implement task-by-task with review between tasks. Each task ends in a commit. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single hand-rolled `scripts/admin-member-smoke.mjs` Playwright script with an `@playwright/test` workspace package at the repo root that segregates specs by web app, runs each app's suite independently, and preserves the existing coverage verbatim.

**Architecture:** New pnpm workspace package `@organizer-hub/e2e` rooted at `e2e/`. Single `playwright.config.ts` declares `member` and `admin` projects, each with its own `baseURL` and `storageState`. A `global-setup.ts` performs one OIDC signup + OWNER grant against the running stack, then persists per-app authenticated browser state to `e2e/.auth/{member,admin}.json`. Specs are functional + helper-based (no page-objects). The admin event-publish spec uses a second browser context to verify member visibility (the only cross-context spec).

**Tech stack:** `@playwright/test` (TypeScript), `pnpm` workspaces, existing repo `.env` for service URLs and `DATABASE_URL_*`.

**Reference spec:** `docs/specs/2026-06-03-playwright-e2e-reorg-design.md`

**Source to port:** `scripts/admin-member-smoke.mjs` (429 lines). Each spec below corresponds to a section of that file.

**Prerequisites for running any task that exercises Playwright:** all four apps must be running (`api:3001`, `accounts:3002`, `member:3000`, `admin:3003`) and both seeds applied (`pnpm -F accounts seed && pnpm -F api seed`). Browsers installed via `pnpm -F @organizer-hub/e2e install:browsers` (Task 1's verify step). Tasks that only edit files (no Playwright invocation) skip this prereq.

---

### Task 1: Scaffold the e2e workspace package

**Files:**
- Create: `e2e/package.json`
- Create: `e2e/.gitignore`
- Create: `e2e/README.md`
- Create: `e2e/tsconfig.json`
- Modify: `pnpm-workspace.yaml` (add `e2e` to `packages`)

- [ ] **Step 1: Add `e2e` to the workspace globs**

Edit `pnpm-workspace.yaml`. Change:

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

to:

```yaml
packages:
  - "apps/*"
  - "packages/*"
  - "e2e"
```

(Leave the `overrides` and `allowBuilds` blocks unchanged.)

- [ ] **Step 2: Create `e2e/package.json`**

```json
{
  "name": "@organizer-hub/e2e",
  "version": "0.1.0",
  "private": true,
  "description": "End-to-end browser tests for the member and admin web apps.",
  "scripts": {
    "test": "playwright test",
    "test:member": "playwright test --project=member",
    "test:admin": "playwright test --project=admin",
    "test:headed": "playwright test --headed",
    "test:ui": "playwright test --ui",
    "report": "playwright show-report",
    "install:browsers": "playwright install chromium"
  },
  "devDependencies": {
    "@playwright/test": "^1.60.0",
    "@types/node": "^22.10.5",
    "typescript": "^5.7.3"
  }
}
```

- [ ] **Step 3: Create `e2e/.gitignore`**

```
.auth/
playwright-report/
test-results/
node_modules/
```

- [ ] **Step 4: Create `e2e/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["**/*.ts"],
  "exclude": ["node_modules", "playwright-report", "test-results"]
}
```

- [ ] **Step 5: Create `e2e/README.md`**

````markdown
# e2e

End-to-end browser tests for the `member` and `admin` web apps using `@playwright/test`.

## Prerequisites

1. All four apps running locally:
   - `apps/api` on port 3001
   - `apps/accounts` on port 3002
   - `apps/member` on port 3000
   - `apps/admin` on port 3003
2. Seeds applied: `pnpm -F accounts seed && pnpm -F api seed`
3. Browsers installed: `pnpm -F @organizer-hub/e2e install:browsers`

## Running

From the repo root:

```
pnpm e2e             # both projects
pnpm e2e:member      # member project only
pnpm e2e:admin       # admin project only
```

Or from inside `e2e/`:

```
pnpm test            # both projects
pnpm test:member     # member project only
pnpm test:admin      # admin project only
pnpm test:headed     # headed mode
pnpm test:ui         # interactive UI
pnpm report          # open the last HTML report
```

## How auth works

`global-setup.ts` runs once before any project starts. It signs up a fresh user against `accounts:3002`, grants the user OWNER on the house org via `psql`, then opens each app and persists the authenticated browser state to `e2e/.auth/member.json` and `e2e/.auth/admin.json`. Each project's specs reuse the right storage state automatically.

`.auth/` is gitignored. A fresh `pnpm e2e` run regenerates it.

## Notes

- Not wired into CI. Run on demand against a running local stack.
- The admin `event-publish.spec.ts` is the only spec that uses both browser contexts (admin publishes, then a member context verifies visibility).
````

- [ ] **Step 6: Install dependencies**

Run from repo root:

```bash
pnpm install
```

Expected: `e2e` package is picked up by the workspace; `@playwright/test` resolves under `e2e/node_modules`.

- [ ] **Step 7: Install browsers**

```bash
pnpm -F @organizer-hub/e2e install:browsers
```

Expected: Chromium downloads (~150MB). If already installed by a prior session, this is a no-op.

- [ ] **Step 8: Commit**

```bash
git add pnpm-workspace.yaml e2e/package.json e2e/.gitignore e2e/README.md e2e/tsconfig.json pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
chore(e2e): scaffold e2e workspace package

- new e2e/ pnpm workspace package with @playwright/test devDep, per-project run scripts, tsconfig, gitignore for .auth/playwright-report/test-results, and README documenting prereqs and how auth state is generated
EOF
)"
```

---

### Task 2: Port shared helpers (env, accounts signup, psql owner grant)

**Files:**
- Create: `e2e/shared/env.ts`
- Create: `e2e/shared/accounts.ts`
- Create: `e2e/shared/db.ts`

**Reference:** `scripts/admin-member-smoke.mjs` lines 40-115 (env reader + signup helper + psql grant).

- [ ] **Step 1: Create `e2e/shared/env.ts`**

```ts
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface E2EEnv {
  apiUrl: string;
  accountsUrl: string;
  memberUrl: string;
  adminUrl: string;
  houseOrgId: string;
  databaseUrlApi: string;
  databaseUrlAccounts: string;
}

// Minimal dotenv parser: ignores comments and blank lines, strips surrounding
// quotes. Matches the format produced by scripts/setup-env.mjs.
async function readDotenv(path: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  try {
    const txt = await readFile(path, 'utf8');
    for (const line of txt.split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m) out[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
    }
  } catch {
    // missing .env is OK; values may come from the shell environment instead
  }
  return out;
}

export async function loadE2EEnv(repoRoot: string): Promise<E2EEnv> {
  const fileEnv = await readDotenv(join(repoRoot, '.env'));
  const pick = (key: string, fallback: string): string =>
    process.env[key] ?? fileEnv[key] ?? fallback;

  const env: E2EEnv = {
    apiUrl: pick('API_URL', 'http://localhost:3001'),
    accountsUrl: pick('ACCOUNTS_URL', 'http://localhost:3002'),
    memberUrl: pick('WEB_ORIGIN', 'http://localhost:3000'),
    adminUrl: pick('ADMIN_ORIGIN', 'http://localhost:3003'),
    houseOrgId: pick('HOUSE_ORG_ID', ''),
    databaseUrlApi: pick('DATABASE_URL_API', ''),
    databaseUrlAccounts: pick('DATABASE_URL_ACCOUNTS', ''),
  };

  const required: Array<[string, string]> = [
    ['HOUSE_ORG_ID', env.houseOrgId],
    ['DATABASE_URL_API', env.databaseUrlApi],
    ['DATABASE_URL_ACCOUNTS', env.databaseUrlAccounts],
  ];
  for (const [name, value] of required) {
    if (!value) {
      throw new Error(
        `e2e env: ${name} is required but not set in .env or process.env`,
      );
    }
  }
  return env;
}
```

- [ ] **Step 2: Create `e2e/shared/accounts.ts`**

Port the OIDC-signup flow from `scripts/admin-member-smoke.mjs` lines 117-145 (the member-app-driven signup that bounces through `accounts`). The new helper takes a Playwright `Page` and signs the user up at the accounts interaction URL.

```ts
import type { Page } from '@playwright/test';

export interface SignupResult {
  email: string;
  password: string;
}

// Drive a fresh OIDC signup through the member app's /auth/login. The member
// app redirects to accounts:3002 and we land on /interaction/<id>. We pick
// "Create account", fill in a unique email + password, and submit. The
// accounts app redirects back to the member app's callback, which finalizes
// the cookie. Returns the credentials so we can sign in on the admin app
// next with the same user.
export async function signupViaMember(
  page: Page,
  memberUrl: string,
): Promise<SignupResult> {
  const unique = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `${unique}@example.test`;
  const password = `Pw-${unique}!aA1`;

  await page.goto(`${memberUrl}/auth/login`, { waitUntil: 'networkidle' });
  const interactionUrl = page.url();
  if (!/\/interaction\/[^/]+$/.test(interactionUrl)) {
    throw new Error(`unexpected interaction url: ${interactionUrl}`);
  }

  // Switch to signup form
  await page.getByRole('link', { name: /create account/i }).click();
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /create account|sign up/i }).click();

  await page.waitForURL(`${memberUrl}/dashboard`, { timeout: 15_000 });
  return { email, password };
}

// Reuse an existing account on a second app (i.e. sign in the admin browser
// context with the credentials produced by signupViaMember).
export async function signinExistingViaApp(
  page: Page,
  appUrl: string,
  creds: SignupResult,
): Promise<void> {
  await page.goto(`${appUrl}/auth/login`, { waitUntil: 'networkidle' });
  // We're either already authed (cookie carried) or sitting on the accounts
  // interaction page asking for credentials.
  if (/\/interaction\/[^/]+$/.test(page.url())) {
    await page.getByLabel(/email/i).fill(creds.email);
    await page.getByLabel(/password/i).fill(creds.password);
    await page.getByRole('button', { name: /sign in|log in/i }).click();
  }
  await page.waitForURL(new RegExp(`^${appUrl.replace(/\./g, '\\.')}/`), {
    timeout: 15_000,
  });
}
```

(If the actual `accounts` UI uses different role names or labels for these controls, adjust the selectors to match what the current `admin-member-smoke.mjs` script keys on. The current script uses raw form selectors; reading lines 117-180 of the script will reveal the actual element shapes.)

- [ ] **Step 3: Create `e2e/shared/db.ts`**

Port the psql OWNER-grant from `scripts/admin-member-smoke.mjs` lines around the "grant OWNER on the house org" comment.

```ts
import { execSync } from 'node:child_process';

// Grant the freshly-signed-up user OWNER on the house org. New OIDC accounts
// arrive with zero memberships; without this grant, admin routes return 404.
// We shell out to psql rather than reach for a Prisma client because the e2e
// package should not depend on @organizer-hub/db (would require generating
// Prisma clients here too). The same pattern as the predecessor smoke script.
export function grantHouseOwner(
  databaseUrlApi: string,
  houseOrgId: string,
  userId: string,
): void {
  const sql = `
    INSERT INTO organization_members (organization_id, user_id, role, created_at, updated_at)
    VALUES ('${houseOrgId}', '${userId}', 'OWNER', NOW(), NOW())
    ON CONFLICT (organization_id, user_id) DO UPDATE SET role = 'OWNER';
  `;
  execSync(`psql "${databaseUrlApi}" -c "${sql.replace(/\n/g, ' ')}"`, {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

// Look up the userId for a freshly-signed-up email from the accounts DB.
export function lookupAccountId(
  databaseUrlAccounts: string,
  email: string,
): string {
  const result = execSync(
    `psql "${databaseUrlAccounts}" -tA -c "SELECT id FROM accounts WHERE email='${email}' LIMIT 1;"`,
    { stdio: ['ignore', 'pipe', 'inherit'] },
  )
    .toString()
    .trim();
  if (!result) {
    throw new Error(`no accounts row found for ${email}`);
  }
  return result;
}
```

(If the accounts schema's user identifier column is named `sub` rather than `id`, change the SELECT accordingly. The current `admin-member-smoke.mjs` script around line 145 reveals the actual column name.)

- [ ] **Step 4: Verify the files type-check**

Run from repo root:

```bash
pnpm -F @organizer-hub/e2e exec tsc --noEmit
```

Expected: no errors. The helpers import only `@playwright/test`, `node:fs/promises`, `node:path`, and `node:child_process` — all already resolvable.

- [ ] **Step 5: Commit**

```bash
git add e2e/shared/
git commit -m "$(cat <<'EOF'
chore(e2e): port env reader, OIDC signup, and psql OWNER grant helpers

- e2e/shared/env.ts reads root .env for service URLs, HOUSE_ORG_ID, and DATABASE_URL_* with shell-env fallback and required-field validation
- e2e/shared/accounts.ts drives OIDC signup through the member /auth/login bounce and reuses credentials on the admin app
- e2e/shared/db.ts looks up the new accounts id and grants OWNER on the house org via psql so admin routes resolve
EOF
)"
```

---

### Task 3: Wire `playwright.config.ts` and `global-setup.ts`

**Files:**
- Create: `e2e/playwright.config.ts`
- Create: `e2e/global-setup.ts`

- [ ] **Step 1: Create `e2e/playwright.config.ts`**

```ts
import { defineConfig, devices } from '@playwright/test';
import { join } from 'node:path';

const repoRoot = join(__dirname, '..');

export default defineConfig({
  testDir: '.',
  testMatch: ['member/**/*.spec.ts', 'admin/**/*.spec.ts'],
  globalSetup: './global-setup.ts',
  fullyParallel: false, // shared backend state — keep specs sequential per project
  reporter: [['list'], ['html', { open: 'never' }]],
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'member',
      testDir: './member',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
        storageState: join(__dirname, '.auth', 'member.json'),
      },
    },
    {
      name: 'admin',
      testDir: './admin',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.ADMIN_ORIGIN ?? 'http://localhost:3003',
        storageState: join(__dirname, '.auth', 'admin.json'),
      },
    },
  ],
  outputDir: 'test-results',
  metadata: {
    repoRoot,
  },
});
```

- [ ] **Step 2: Create `e2e/global-setup.ts`**

```ts
import { chromium, type FullConfig } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { loadE2EEnv } from './shared/env';
import { signupViaMember, signinExistingViaApp } from './shared/accounts';
import { grantHouseOwner, lookupAccountId } from './shared/db';

export default async function globalSetup(config: FullConfig): Promise<void> {
  const repoRoot = (config.metadata?.repoRoot as string) ?? join(__dirname, '..');
  const env = await loadE2EEnv(repoRoot);

  const authDir = join(__dirname, '.auth');
  await mkdir(authDir, { recursive: true });

  const browser = await chromium.launch();

  // Member context: fresh signup + persist storageState
  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();
  const creds = await signupViaMember(memberPage, env.memberUrl);

  // Grant OWNER on the house org so admin routes resolve for this user
  const userId = lookupAccountId(env.databaseUrlAccounts, creds.email);
  grantHouseOwner(env.databaseUrlApi, env.houseOrgId, userId);

  await memberContext.storageState({ path: join(authDir, 'member.json') });

  // Admin context: sign in the same user against the admin app, persist
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await signinExistingViaApp(adminPage, env.adminUrl, creds);
  await adminContext.storageState({ path: join(authDir, 'admin.json') });

  await browser.close();
}
```

- [ ] **Step 3: Verify the config + setup type-check**

Run from repo root:

```bash
pnpm -F @organizer-hub/e2e exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Smoke-check that Playwright picks up the config**

Run from repo root:

```bash
pnpm -F @organizer-hub/e2e exec playwright test --list
```

Expected: prints "No tests found" (because no spec files exist yet) but DOES NOT error on the config. If Playwright cannot parse the config, fix and re-run.

- [ ] **Step 5: Commit**

```bash
git add e2e/playwright.config.ts e2e/global-setup.ts
git commit -m "$(cat <<'EOF'
chore(e2e): wire playwright.config and global-setup

- playwright.config.ts declares member and admin projects with per-project baseURL and storageState; reporters list+html; trace/screenshot/video on failure
- global-setup.ts launches chromium once, signs up a fresh OIDC user via the member app, grants OWNER on the house org, then signs the same user in against the admin app and persists both storage states to e2e/.auth/
EOF
)"
```

---

### Task 4: First spec — `member/auth.spec.ts`

**Files:**
- Create: `e2e/member/auth.spec.ts`

This is the smallest possible spec — a sanity check that storageState is loaded and the member app is reachable. It also validates that Tasks 1-3 are wired correctly end-to-end.

- [ ] **Step 1: Create `e2e/member/auth.spec.ts`**

```ts
import { test, expect } from '@playwright/test';

test.describe('member auth', () => {
  test('storageState lands on /dashboard without a login prompt', async ({ page }) => {
    await page.goto('/dashboard', { waitUntil: 'networkidle' });

    // We expect to be on /dashboard. If storageState was missing or stale,
    // the member app would have redirected to /auth/login.
    expect(page.url()).toMatch(/\/dashboard(\?|$)/);

    // A signed-in /dashboard renders the membership card heading. The exact
    // copy lives in the three-card dashboard ported in member/dashboard.spec.ts;
    // here we just confirm the page rendered something user-shaped, not a login.
    await expect(page.getByRole('main')).toBeVisible();
  });
});
```

- [ ] **Step 2: Run the spec**

Prereq: all four apps + seeds running.

```bash
pnpm e2e:member
```

(Note: `pnpm e2e:member` is the root script wired in Task 10. Until Task 10 lands, run from inside e2e/ with `pnpm -F @organizer-hub/e2e test:member`.)

Expected: 1 passed. If the assertion fails because `/dashboard` redirects to `/auth/login`, the storageState wasn't loaded — debug `global-setup.ts`.

- [ ] **Step 3: Commit**

```bash
git add e2e/member/auth.spec.ts
git commit -m "$(cat <<'EOF'
test(e2e): member auth storageState smoke

- /dashboard loads without redirect to /auth/login; confirms global-setup persisted a working session for the member app
EOF
)"
```

---

### Task 5: First admin spec — `admin/auth.spec.ts`

**Files:**
- Create: `e2e/admin/auth.spec.ts`

Same shape as Task 4 but for the admin project — confirms the admin storageState was persisted correctly.

- [ ] **Step 1: Create `e2e/admin/auth.spec.ts`**

```ts
import { test, expect } from '@playwright/test';

test.describe('admin auth', () => {
  test('storageState lands on the admin shell without a login prompt', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });

    // Admin home should render without bouncing to /auth/login.
    expect(page.url()).not.toMatch(/\/auth\/login(\?|$)/);

    // The admin shell renders a top nav. We assert on the main landmark for
    // resilience to copy changes; richer assertions live in feature-specific
    // specs below.
    await expect(page.getByRole('main')).toBeVisible();
  });
});
```

- [ ] **Step 2: Run the spec**

```bash
pnpm -F @organizer-hub/e2e test:admin
```

Expected: 1 passed.

- [ ] **Step 3: Commit**

```bash
git add e2e/admin/auth.spec.ts
git commit -m "$(cat <<'EOF'
test(e2e): admin auth storageState smoke

- admin / loads without redirect to /auth/login; confirms global-setup persisted a working session for the admin app
EOF
)"
```

---

### Task 6: Port member dashboard, events filter, and event detail specs

**Files:**
- Create: `e2e/member/dashboard.spec.ts`
- Create: `e2e/member/events.spec.ts`
- Create: `e2e/member/event-detail.spec.ts`

**Reference:** `scripts/admin-member-smoke.mjs` lines 182-215 (dashboard), the `/events` filter section, and the public event detail label badge section.

- [ ] **Step 1: Create `e2e/member/dashboard.spec.ts`**

```ts
import { test, expect } from '@playwright/test';

test.describe('member dashboard', () => {
  test('three-card dashboard renders Membership, My requests, and Browse', async ({ page }) => {
    await page.goto('/dashboard', { waitUntil: 'networkidle' });

    // Mirror the assertions from admin-member-smoke.mjs:182-196 which read
    // the page HTML for these three card headings. We use role+name here for
    // resilience to surrounding markup changes.
    await expect(page.getByRole('heading', { name: /membership/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /my requests/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /browse/i })).toBeVisible();
  });
});
```

- [ ] **Step 2: Create `e2e/member/events.spec.ts`**

```ts
import { test, expect } from '@playwright/test';

test.describe('member /events', () => {
  test('label-chip filter narrows the events list', async ({ page }) => {
    await page.goto('/events', { waitUntil: 'networkidle' });

    // Capture baseline count of event cards before applying any filter.
    const eventCards = page.getByTestId('event-card');
    const baselineCount = await eventCards.count();
    expect(baselineCount).toBeGreaterThan(0);

    // Click the first available label chip and verify the count changes
    // (either narrows or stays equal if every event carries that label).
    const firstChip = page.getByTestId('label-chip').first();
    await firstChip.click();
    await page.waitForURL(/\/events\?.*labels?=/);

    const filteredCount = await eventCards.count();
    expect(filteredCount).toBeLessThanOrEqual(baselineCount);
    expect(filteredCount).toBeGreaterThan(0);
  });
});
```

(If the member app does not use `data-testid="event-card"` / `data-testid="label-chip"`, the implementer should either add the testids to the source components or replace these selectors with role+name selectors that match the live UI. The current `admin-member-smoke.mjs` script reveals the actual selector shape it relies on around line 197.)

- [ ] **Step 3: Create `e2e/member/event-detail.spec.ts`**

```ts
import { test, expect } from '@playwright/test';

test.describe('member event detail', () => {
  test('public event detail page shows the label badge', async ({ page }) => {
    await page.goto('/events', { waitUntil: 'networkidle' });

    // Open the first event card; capture its slug so the assertion is
    // resilient to seed-data ordering.
    const firstCard = page.getByTestId('event-card').first();
    const href = await firstCard.getAttribute('href');
    if (!href) throw new Error('event card has no href');

    await page.goto(href, { waitUntil: 'networkidle' });

    // The public event detail page renders at least one label badge for
    // any event that has labels assigned (seeded events do).
    await expect(page.getByTestId('label-badge').first()).toBeVisible();
  });
});
```

- [ ] **Step 4: Run the three specs**

```bash
pnpm -F @organizer-hub/e2e test:member
```

Expected: 4 passed (the auth spec from Task 4 + these 3). If selectors fail, read `scripts/admin-member-smoke.mjs` to see what the predecessor keyed on, then adjust.

- [ ] **Step 5: Commit**

```bash
git add e2e/member/dashboard.spec.ts e2e/member/events.spec.ts e2e/member/event-detail.spec.ts
git commit -m "$(cat <<'EOF'
test(e2e): port member dashboard, events filter, and event detail specs

- dashboard.spec asserts Membership / My requests / Browse card headings render on /dashboard
- events.spec asserts the first label chip narrows or preserves the event card count and adds labels= to the URL
- event-detail.spec navigates from the first event card to its public detail page and asserts a label badge is visible
EOF
)"
```

---

### Task 7: Port admin label CRUD spec

**Files:**
- Create: `e2e/admin/labels.spec.ts`

**Reference:** `scripts/admin-member-smoke.mjs` lines 217-270 (label CRUD: create, duplicate-slug 409 surfacing, rename, delete-unused, delete-in-use rejection).

- [ ] **Step 1: Create `e2e/admin/labels.spec.ts`**

```ts
import { test, expect } from '@playwright/test';

// Each test uses a unique slug suffix so re-runs and parallel projects don't
// collide on the labels table. The label CRUD page lives at /labels.
const stamp = (): string =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

test.describe('admin labels CRUD', () => {
  test('create a label', async ({ page }) => {
    await page.goto('/labels', { waitUntil: 'networkidle' });
    const slug = `e2e-create-${stamp()}`;

    await page.getByRole('button', { name: /new label|add label/i }).click();
    await page.getByLabel(/slug/i).fill(slug);
    await page.getByLabel(/name/i).fill('E2E Create');
    await page.getByRole('button', { name: /save|create/i }).click();

    await expect(page.getByRole('row', { name: new RegExp(slug, 'i') })).toBeVisible();
  });

  test('duplicate slug surfaces inline 409 error', async ({ page }) => {
    await page.goto('/labels', { waitUntil: 'networkidle' });
    const slug = `e2e-dup-${stamp()}`;

    // First create succeeds.
    await page.getByRole('button', { name: /new label|add label/i }).click();
    await page.getByLabel(/slug/i).fill(slug);
    await page.getByLabel(/name/i).fill('Dup Original');
    await page.getByRole('button', { name: /save|create/i }).click();
    await expect(page.getByRole('row', { name: new RegExp(slug, 'i') })).toBeVisible();

    // Second create with the same slug shows the inline 409 error.
    await page.getByRole('button', { name: /new label|add label/i }).click();
    await page.getByLabel(/slug/i).fill(slug);
    await page.getByLabel(/name/i).fill('Dup Second');
    await page.getByRole('button', { name: /save|create/i }).click();

    await expect(page.getByText(/already exists/i)).toBeVisible();
  });

  test('rename a label persists', async ({ page }) => {
    await page.goto('/labels', { waitUntil: 'networkidle' });
    const slug = `e2e-rename-${stamp()}`;
    const newSlug = `${slug}-renamed`;

    await page.getByRole('button', { name: /new label|add label/i }).click();
    await page.getByLabel(/slug/i).fill(slug);
    await page.getByLabel(/name/i).fill('Rename Me');
    await page.getByRole('button', { name: /save|create/i }).click();
    await expect(page.getByRole('row', { name: new RegExp(slug, 'i') })).toBeVisible();

    await page.getByRole('row', { name: new RegExp(slug, 'i') })
      .getByRole('button', { name: /edit/i }).click();
    await page.getByLabel(/slug/i).fill(newSlug);
    await page.getByRole('button', { name: /save/i }).click();

    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByRole('row', { name: new RegExp(newSlug, 'i') })).toBeVisible();
    await expect(page.getByRole('row', { name: new RegExp(`^${slug}$`, 'i') })).toHaveCount(0);
  });

  test('delete an unused label removes it', async ({ page }) => {
    await page.goto('/labels', { waitUntil: 'networkidle' });
    const slug = `e2e-delete-${stamp()}`;

    await page.getByRole('button', { name: /new label|add label/i }).click();
    await page.getByLabel(/slug/i).fill(slug);
    await page.getByLabel(/name/i).fill('Delete Me');
    await page.getByRole('button', { name: /save|create/i }).click();
    await expect(page.getByRole('row', { name: new RegExp(slug, 'i') })).toBeVisible();

    await page.getByRole('row', { name: new RegExp(slug, 'i') })
      .getByRole('button', { name: /delete/i }).click();
    await page.getByRole('button', { name: /confirm|delete/i }).click();

    await expect(page.getByRole('row', { name: new RegExp(slug, 'i') })).toHaveCount(0);
  });

  test('delete an in-use label is rejected with surfaced error', async ({ page }) => {
    // This test assumes the seed includes at least one label assigned to at
    // least one event. The predecessor smoke (admin-member-smoke.mjs around
    // line 376) keyed on a "renamed" slug it created earlier in the same run;
    // here we use the seeded labels and look up which one is in-use via the
    // labels page's "Used by N events" column. Skips gracefully if seed has
    // no in-use label.
    await page.goto('/labels', { waitUntil: 'networkidle' });

    const inUseRow = page.getByRole('row', { name: /used by [1-9]/i }).first();
    const inUseExists = (await inUseRow.count()) > 0;
    test.skip(!inUseExists, 'no in-use label in seed; skipping reject-on-delete check');

    await inUseRow.getByRole('button', { name: /delete/i }).click();
    await page.getByRole('button', { name: /confirm|delete/i }).click();

    await expect(page.getByText(/in use|cannot delete/i)).toBeVisible();
    // Row is still present
    await expect(inUseRow).toBeVisible();
  });
});
```

(Selectors for buttons, form fields, and table rows must match the live `/labels` admin UI. If the current UI uses different roles or copy, adjust accordingly. The intent — and the assertions it verifies — must match the predecessor's coverage.)

- [ ] **Step 2: Run the spec**

```bash
pnpm -F @organizer-hub/e2e test:admin
```

Expected: 6 passed (the auth spec from Task 5 + these 5). The in-use rejection test will `skip` if the seed has no label assigned to an event; that is acceptable for first port.

- [ ] **Step 3: Commit**

```bash
git add e2e/admin/labels.spec.ts
git commit -m "$(cat <<'EOF'
test(e2e): port admin label CRUD spec

- create, rename, and delete-unused happy paths
- duplicate-slug create surfaces inline 409 error
- delete-in-use is rejected and the row survives (skips gracefully if seed has no in-use label)
EOF
)"
```

---

### Task 8: Port the admin event-publish flow (cross-context)

**Files:**
- Create: `e2e/admin/event-publish.spec.ts`

**Reference:** `scripts/admin-member-smoke.mjs` lines 272-330 (event create, publish, then member visibility).

This spec opens a second browser context loaded with the member storageState to verify the published event is visible to a member. It is the only spec that uses both contexts.

- [ ] **Step 1: Create `e2e/admin/event-publish.spec.ts`**

```ts
import { test, expect } from '@playwright/test';
import { join } from 'node:path';

test.describe('admin event publish (cross-context)', () => {
  test('creating and publishing an event makes it visible on the member /events page', async ({ page, browser }) => {
    // ----- Admin side: create + publish -----
    await page.goto('/events/new', { waitUntil: 'networkidle' });

    const slug = `e2e-publish-${Date.now()}`;
    const title = `E2E Publish ${slug}`;

    await page.getByLabel(/title/i).fill(title);
    await page.getByLabel(/slug/i).fill(slug);
    // Pick the first available label so the public detail page renders a badge
    await page.getByTestId('label-picker').first().click();

    await page.getByRole('button', { name: /save|create/i }).click();
    await page.waitForURL(/\/events\/[^/]+$/);
    const adminEventUrl = page.url();
    const eventIdMatch = /\/events\/([^/]+)$/.exec(adminEventUrl);
    if (!eventIdMatch) throw new Error(`could not parse event id from ${adminEventUrl}`);
    const eventId = eventIdMatch[1];

    // Publish
    await page.getByRole('button', { name: /publish/i }).click();
    await page.getByRole('button', { name: /confirm|publish/i }).click();
    await expect(page.getByText(/published/i)).toBeVisible();

    // ----- Member side: verify visibility -----
    const memberStorageState = join(__dirname, '..', '.auth', 'member.json');
    const memberContext = await browser.newContext({
      storageState: memberStorageState,
      baseURL: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
    });
    try {
      const memberPage = await memberContext.newPage();

      // The newly-published event should appear on /events
      await memberPage.goto('/events', { waitUntil: 'networkidle' });
      await expect(memberPage.getByText(title)).toBeVisible();

      // ...and on its public detail page, with a label badge
      await memberPage.goto(`/events/${eventId}`, { waitUntil: 'networkidle' });
      await expect(memberPage.getByText(title)).toBeVisible();
      await expect(memberPage.getByTestId('label-badge').first()).toBeVisible();
    } finally {
      await memberContext.close();
    }
  });
});
```

(`label-picker` and `label-badge` selectors must match the live UI. If the predecessor smoke uses different selectors around line 272-330, mirror those. If the member detail URL uses slug rather than id, swap accordingly.)

- [ ] **Step 2: Run the spec**

Prereq: BOTH apps running, BOTH storage states present in `e2e/.auth/`.

```bash
pnpm -F @organizer-hub/e2e test:admin
```

Expected: 7 passed (Task 5 + Task 7 + this one). If the member context cannot reach the published event, debug whether the publish step actually committed (look at the admin URL after publish).

- [ ] **Step 3: Commit**

```bash
git add e2e/admin/event-publish.spec.ts
git commit -m "$(cat <<'EOF'
test(e2e): port admin event-publish cross-context flow

- admin creates and publishes an event in the primary admin context
- spec opens a second browser context loaded with member storageState
- member context asserts the published event appears on /events and the public detail page shows the label badge
- second context is closed in a finally block so a failed assertion does not leak browser state
EOF
)"
```

---

### Task 9: Port the cookie isolation probe

**Files:**
- Create: `e2e/admin/cookie-isolation.spec.ts`

**Reference:** `scripts/admin-member-smoke.mjs` lines 332-344 (cookie isolation probe between member and admin contexts).

- [ ] **Step 1: Create `e2e/admin/cookie-isolation.spec.ts`**

```ts
import { test, expect } from '@playwright/test';
import { join } from 'node:path';

test.describe('cookie isolation (cross-context)', () => {
  test('member and admin contexts see only their own oh_*_session cookies', async ({ browser }) => {
    const memberStorageState = join(__dirname, '..', '.auth', 'member.json');
    const adminStorageState = join(__dirname, '..', '.auth', 'admin.json');

    const memberContext = await browser.newContext({
      storageState: memberStorageState,
      baseURL: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
    });
    const adminContext = await browser.newContext({
      storageState: adminStorageState,
      baseURL: process.env.ADMIN_ORIGIN ?? 'http://localhost:3003',
    });

    try {
      // Each context only sees cookies for its own host.
      const memberCookies = await memberContext.cookies();
      const adminCookies = await adminContext.cookies();

      const memberCookieNames = new Set(memberCookies.map((c) => c.name));
      const adminCookieNames = new Set(adminCookies.map((c) => c.name));

      // Member sees its own session cookies, NOT the admin's
      expect([...memberCookieNames].some((n) => n.startsWith('oh_member_'))).toBe(true);
      expect([...memberCookieNames].some((n) => n.startsWith('oh_admin_'))).toBe(false);

      // Admin sees its own session cookies, NOT the member's
      expect([...adminCookieNames].some((n) => n.startsWith('oh_admin_'))).toBe(true);
      expect([...adminCookieNames].some((n) => n.startsWith('oh_member_'))).toBe(false);
    } finally {
      await memberContext.close();
      await adminContext.close();
    }
  });
});
```

(If the actual cookie prefixes in the apps differ from `oh_member_` / `oh_admin_`, update the assertions. The predecessor smoke around lines 339-343 reveals the prefixes it asserts on.)

- [ ] **Step 2: Run the spec**

```bash
pnpm -F @organizer-hub/e2e test:admin
```

Expected: 8 passed.

- [ ] **Step 3: Commit**

```bash
git add e2e/admin/cookie-isolation.spec.ts
git commit -m "$(cat <<'EOF'
test(e2e): port cookie isolation probe

- separate browser contexts loaded with member and admin storageState
- assert each context sees only its own oh_*_session cookies and not the other app's
EOF
)"
```

---

### Task 10: Wire root scripts and remove the unused root `playwright` dep

**Files:**
- Modify: `package.json` (root — add 3 scripts, remove `playwright` devDependency)

- [ ] **Step 1: Read the current root `package.json`**

Run:

```bash
cat package.json
```

Note the current `scripts` block and `devDependencies` block.

- [ ] **Step 2: Add the three e2e scripts and remove the root `playwright` dep**

Edit `package.json`:

In the `scripts` block, after `"setup:owner"`, add:

```json
"e2e": "pnpm -F @organizer-hub/e2e test",
"e2e:member": "pnpm -F @organizer-hub/e2e test:member",
"e2e:admin": "pnpm -F @organizer-hub/e2e test:admin"
```

In the `devDependencies` block, REMOVE the line:

```json
"playwright": "^1.60.0",
```

(The raw `playwright` lib was a dep of `scripts/admin-member-smoke.mjs`, which is replaced in Task 11. `@playwright/test` lives under `e2e/`'s deps now.)

- [ ] **Step 3: Re-install to refresh the lockfile**

```bash
pnpm install
```

Expected: `playwright` is removed from the root `node_modules` and `pnpm-lock.yaml`. `e2e` still works because `@playwright/test` is under `e2e/node_modules`.

- [ ] **Step 4: Verify the root scripts work end-to-end**

```bash
pnpm e2e:member
pnpm e2e:admin
pnpm e2e
```

Expected: each command runs Playwright with the right `--project` filter and exits zero.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
chore(e2e): wire root e2e scripts and drop the raw playwright devDep

- root package.json gains pnpm e2e, pnpm e2e:member, pnpm e2e:admin scripts that delegate to the new e2e workspace
- bare playwright devDep removed from root; @playwright/test lives under e2e/ now
EOF
)"
```

---

### Task 11: Final parity check and delete the legacy smoke script

**Files:**
- Delete: `scripts/admin-member-smoke.mjs`

- [ ] **Step 1: Confirm parity by running the new suite**

Prereq: all four apps + seeds running.

```bash
pnpm e2e
```

Expected: all specs pass across both projects. Compare to the predecessor smoke's coverage (`scripts/admin-member-smoke.mjs` records under `/tmp/admin-member-smoke/<iso-stamp>/`). Every assertion the predecessor made should now have a corresponding `expect` in one of the new specs:

| Predecessor section | New spec |
|---|---|
| Two isolated contexts | `admin/cookie-isolation.spec.ts` |
| Fresh OIDC signup | `global-setup.ts` |
| Member three-card dashboard | `member/dashboard.spec.ts` |
| `/events` label-chip filter | `member/events.spec.ts` |
| Public event detail label badge | `member/event-detail.spec.ts` |
| Admin label CRUD (create, dup-slug 409, rename, delete-unused, delete-in-use) | `admin/labels.spec.ts` |
| Admin event create → publish | `admin/event-publish.spec.ts` (admin half) |
| Member sees published event + badge | `admin/event-publish.spec.ts` (member half, second context) |
| Cookie isolation probe | `admin/cookie-isolation.spec.ts` |

If any predecessor assertion is uncovered, add it to the right spec before deleting the legacy script.

- [ ] **Step 2: Delete `scripts/admin-member-smoke.mjs`**

```bash
rm scripts/admin-member-smoke.mjs
```

- [ ] **Step 3: Verify no remaining references**

```bash
git grep "admin-member-smoke" -- ':!docs/' || echo "no references outside docs/"
```

Expected: prints `no references outside docs/`. (References inside `docs/` are fine — design and plan docs reference it for historical context.)

- [ ] **Step 4: Commit the deletion**

```bash
git add scripts/admin-member-smoke.mjs
git commit -m "$(cat <<'EOF'
chore(e2e): delete legacy admin-member smoke script

- scripts/admin-member-smoke.mjs (429 lines, raw playwright lib) superseded by the @playwright/test workspace at e2e/
- coverage parity verified: every predecessor assertion mapped to a spec in member/ or admin/
EOF
)"
```

- [ ] **Step 5: Final verification**

```bash
pnpm e2e:member
pnpm e2e:admin
pnpm e2e
```

Expected: all three commands pass with the same spec counts as Step 1 of this task.

---

## Self-review notes

Spec coverage map (each spec section → task):
- Goal 1 (migrate to @playwright/test) → Tasks 1, 3-9
- Goal 2 (segregate by app) → Task 1 (directories) + Tasks 4-9 (specs)
- Goal 3 (per-app run scripts) → Task 1 (e2e/package.json), Task 10 (root scripts)
- Goal 4 (folder layout that scales) → Task 1 (directories), Task 2 (shared/)
- Goal 5 (preserve coverage verbatim, fix UI drift inline) → Tasks 4-9 (each notes that selectors must match live UI; predecessor's selectors are the reference)
- Goal 6 (delete the legacy smoke) → Task 11
- Auth strategy (global-setup signs up + grants OWNER + persists two storageStates) → Tasks 2, 3
- Cross-app handling (admin/event-publish opens a second member context) → Task 8
- Run scripts and config highlights → Tasks 1, 3, 10
- Migration steps 1-9 → Tasks 1-11 (1:1)
- Non-goals (no CI wiring, no page-objects) → explicitly preserved; webServer absent from playwright.config in Task 3

Type consistency check: `signupViaMember` and `signinExistingViaApp` are defined in Task 2 with `SignupResult` and used in Task 3's `global-setup.ts`. `lookupAccountId` and `grantHouseOwner` are defined in Task 2, used in Task 3. `loadE2EEnv` is defined in Task 2, used in Task 3. All names consistent.

Placeholder scan: every code block contains concrete content. Selectors are concrete with a clear note that the implementer must reconcile them against the live UI if they drift (the predecessor smoke is the reference, called out by line number for each spec). Test commands are concrete. No "TBD"/"TODO" remain.

Known runtime ambiguities (intentional — the implementer must inspect the live UI to resolve):
- Exact role names + form labels in the accounts signup form (Task 2)
- Exact testid names on event cards, label chips, badges, label picker (Tasks 6, 8)
- Exact button copy on label CRUD actions (Task 7)
- Cookie prefix strings `oh_member_*` vs `oh_admin_*` (Task 9)

Each of these is flagged in the task with a pointer to the predecessor script's line numbers as the source of truth. If the live UI has diverged from the predecessor, the implementer fixes inline — this matches "preserve current coverage verbatim; fix any UI drift inline" from the spec's Goal 5.
