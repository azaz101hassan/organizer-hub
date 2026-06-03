# Playwright e2e reorganization design

**Date:** 2026-06-03
**Status:** Approved (design); plan pending

## Context

The repo ships a single hand-rolled Playwright smoke at `scripts/admin-member-smoke.mjs` (429 lines). It uses the raw `playwright` library (not `@playwright/test`), drives both the `member` (port 3000) and `admin` (port 3003) apps in one entrypoint, and is not wired into `pnpm test` or CI. It has accumulated outdated assertions as the apps have evolved, and there is no structure to extend.

The repo has four apps:

- `apps/api` — Nest HTTP API on 3001
- `apps/accounts` — OIDC provider on 3002
- `apps/member` — public/member-facing Next app on 3000
- `apps/admin` — admin Next app on 3003

The existing smoke covers a deliberately broad slice: OIDC signup, two isolated browser contexts, the member three-card dashboard, label-chip filter on `/events`, label badge on the public event detail, admin label CRUD with duplicate-slug 409 surfacing and delete-in-use rejection, admin event create → publish → member visibility check, and a cookie-isolation probe. The flows are correct in shape but the implementation style precludes parallel execution, retries, traces, and per-app invocation.

## Goals

1. Migrate the existing smoke to `@playwright/test` so we get test/describe/expect, parallelism, retries, HTML reports, traces, and failure screenshots/video.
2. Segregate specs by web app so each app can be exercised independently.
3. Provide per-app run scripts at the root.
4. Establish a folder layout that scales as new specs are added.
5. Preserve the current coverage verbatim; fix any UI drift inline where the spec no longer matches the live UI.
6. Delete `scripts/admin-member-smoke.mjs` once the new structure matches its coverage.

## Non-goals

- Wiring e2e into CI. The current smoke isn't either; CI requires containerized Postgres + `webServer` config, which is its own scope.
- Replacing the admin UI publish flow with API/DB seeding. Port-verbatim means keeping the UI path.
- Page-object models. Four specs per app is too small to justify the ceremony; functional helpers cover the duplication.

## Structure

```
e2e/
  playwright.config.ts            # root config, member + admin projects
  package.json                    # @playwright/test, scripts
  README.md                       # prereqs + how to run
  .gitignore                      # test-results/, playwright-report/, .auth/
  global-setup.ts                 # signup fresh user, grant OWNER, save storageState x2
  shared/
    env.ts                        # dotenv reader (ported from current script)
    accounts.ts                   # OIDC signup helper (ported)
    db.ts                         # psql OWNER-grant helper (ported)
    fixtures.ts                   # @playwright/test custom fixtures
    selectors.ts                  # named selectors shared across specs
  member/
    auth.spec.ts                  # signin lands on /dashboard
    dashboard.spec.ts             # three-card dashboard renders
    events.spec.ts                # label-chip filter on /events
    event-detail.spec.ts          # public event detail shows label badge
  admin/
    auth.spec.ts                  # signin lands on /
    labels.spec.ts                # CRUD: create, dup-slug 409, rename, delete-unused, delete-in-use rejection
    event-publish.spec.ts         # create → publish → member sees it (cross-context)
    cookie-isolation.spec.ts      # oh_member_* vs oh_admin_* probe
```

`e2e/` is a pnpm workspace package (`@organizer-hub/e2e`). It has no runtime dependencies on the apps; it only needs `@playwright/test` and access to `.env` for URLs and the `DATABASE_URL` used by the OWNER grant.

## Auth strategy

`global-setup.ts` runs once before any project starts. It:

1. Reads root `.env` for service URLs, `HOUSE_ORG_ID`, and `DATABASE_URL_ACCOUNTS` / `DATABASE_URL_API` (mirroring the current script).
2. Signs up a fresh user against `accounts:3002` using the helper in `shared/accounts.ts`.
3. Grants the new user OWNER on `HOUSE_ORG_ID` via `shared/db.ts` (psql `INSERT INTO organization_members ...`).
4. Opens the member app's `/auth/login`, completes the OIDC dance, and persists context state to `e2e/.auth/member.json`.
5. Opens the admin app's `/auth/login`, completes the OIDC dance, and persists context state to `e2e/.auth/admin.json`.

Each project in `playwright.config.ts` declares its `storageState` to point at the right `.auth/*.json` file. Specs start signed-in — no per-spec login overhead.

`.auth/` is gitignored. A fresh `pnpm e2e` run regenerates it.

## Cross-app flow

`admin/event-publish.spec.ts` is the only spec that uses both contexts.

- The spec runs in the `admin` project, so its primary `page` is signed in as admin.
- After the admin UI publishes the event, the spec opens a second browser context via `browser.newContext({ storageState: 'e2e/.auth/member.json' })`, navigates to the public event detail, and asserts the label badge is visible.

Consequence: `pnpm e2e:admin` requires both apps and both storage states to be available (which they are after `global-setup`). `pnpm e2e:member` does not — it stays single-context.

Alternative considered: seed the event via API and verify in `member/`. Rejected because it loses admin-UI coverage; port-verbatim requires keeping the admin publish flow exercised end-to-end.

## Run scripts

`e2e/package.json`:

```json
{
  "name": "@organizer-hub/e2e",
  "private": true,
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
    "@playwright/test": "^1.60.0"
  }
}
```

Root `package.json` adds:

```json
{
  "scripts": {
    "e2e": "pnpm -F @organizer-hub/e2e test",
    "e2e:member": "pnpm -F @organizer-hub/e2e test:member",
    "e2e:admin": "pnpm -F @organizer-hub/e2e test:admin"
  }
}
```

## Config highlights

`playwright.config.ts`:

- `testDir: '.'`, `testMatch: ['member/**/*.spec.ts', 'admin/**/*.spec.ts']`
- `globalSetup: './global-setup.ts'`
- Two projects:
  - `member`: `storageState: '.auth/member.json'`, `baseURL: 'http://localhost:3000'`
  - `admin`: `storageState: '.auth/admin.json'`, `baseURL: 'http://localhost:3003'`
- `reporter: [['html'], ['list']]`
- `use.trace: 'on-first-retry'`, `use.screenshot: 'only-on-failure'`, `use.video: 'retain-on-failure'`
- `retries: process.env.CI ? 2 : 0`
- `workers: process.env.CI ? 1 : undefined` — parallel locally, serial in CI to avoid shared-DB races
- No `webServer` block: the four apps must already be running. Documented in README.

## Migration

1. Scaffold `e2e/` with the layout above plus a stub `playwright.config.ts`, `global-setup.ts`, `package.json`, `README.md`, `.gitignore`.
2. Port the OIDC signup, env reader, and psql grant from `scripts/admin-member-smoke.mjs` into `shared/`.
3. Port each test category from the smoke into its own spec file, splitting member-side and admin-side assertions across the two project directories.
4. Implement `admin/event-publish.spec.ts` with the two-context pattern.
5. Wire the root and `e2e/` scripts.
6. Run `pnpm e2e:member` and `pnpm e2e:admin` separately to confirm each project is self-contained.
7. Run `pnpm e2e` to confirm full parity with the existing smoke.
8. Delete `scripts/admin-member-smoke.mjs` and remove the `setup:owner`/related references that no longer apply.
9. Update root `package.json`'s `playwright` devDependency to `@playwright/test` (or add it; current is the bare `playwright` lib).

## Open questions

None known at design time. Cross-app behavior in `admin/event-publish.spec.ts` may need a polled assertion if member visibility lags publish; that's a runtime detail to handle during implementation.

## Future work (not in this scope)

- `webServer` config + CI integration with a containerized Postgres
- Page-object models if spec count grows past ~6 per app
- A `cross/` project for any future scenarios that legitimately need both contexts but aren't naturally rooted in either app
- API-seeded variants of slow UI flows for fast-feedback test tiers
