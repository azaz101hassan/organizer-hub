---
title: "feat: Split apps/web into apps/member + apps/admin with shared package"
type: feat
status: planned
date: 2026-05-31
origin: docs/specs/2026-05-31-admin-member-split-design.md
---

# feat: Split apps/web into apps/member + apps/admin with shared package

> **For implementers:** This plan executes task-by-task. Each Implementation Unit (U#) is one commit unless explicitly grouped. Steps use checkbox (`- [ ]`) syntax for tracking — check off as you complete. Phases are independently shippable: stop after any Phase boundary and the codebase is in a working state.

## Summary

Split `apps/web` into two independent Next.js 16 apps — `apps/member` (consumer surface, port 3000) and `apps/admin` (organizer surface, port 3003) — sharing a new `packages/web-shared` workspace package for API client, OIDC helpers, session reader, middleware factory, and formatters. Admin is single-tenant, bound to one "house" organization via `HOUSE_ORG_ID`. Add an `EventLabel` feature (DB + API + admin CRUD + member filter). Restructure environment configuration into per-app `.env.local` files driven by a `pnpm setup:env` helper. Seed two separate OAuth clients (`organizer-member`, `organizer-admin`) in place of the single `organizer-web` client. Lands in 26 dependency-ordered units across six phases.

## Problem Frame

`apps/web` mixes two audiences. The organizer surface — org list, event editor, ticket-type CRUD, waitlist queue (the Phase 4 SSE feature) — and the consumer surface — event browsing, ticket purchase, membership, ticket-request tracking — share layouts, bundles, and one OAuth session. The audiences have different navigation, auth posture, deploy targets, and visual language. Keeping them in one app forces both to compromise.

The audiences also differ in tenancy. A consumer interacts with many organizations through events. The organizer surface, in practice, is operated by a single internal team — there is no "switch organization" need at the admin layer for the foreseeable future. Locking the admin app to a single house org via `HOUSE_ORG_ID` eliminates an entire dimension of UI (org list, org switcher, per-org route prefix) while preserving the multi-org data model the API and billing flows depend on.

`EventLabel` is a small-but-orthogonal categorization feature ("Concerts", "Workshops", "Community"). It rides along with the split because (a) the admin app needs somewhere to manage labels, (b) the member events list needs a filter, and (c) the admin scaffold is a natural moment to introduce it without churning member-only PRs.

## Requirements

The plan maps 1:1 to the six sections of the origin spec.

- **§1 `packages/web-shared`** — Phase A.
- **§2 `apps/member` (port 3000)** — Phase A (consumes shared package; cookie prefix), Phase D (rename `web` → `member`), Phase F (strip organizer routes, add dashboard home, add label UI).
- **§3 `apps/admin` (port 3003)** — Phase C (EventLabel backend), Phase E (scaffold app, port organizer routes flattened, wire labels page).
- **§4 Auth + second OAuth client** — Phase A (cookie prefix scheme), Phase D (rename `organizer-web` → `organizer-member`), Phase E (add `organizer-admin`).
- **§5 Per-app `.env.local` + `setup:env`** — Phase B.
- **§6 Dashboard chrome per app** — Phase E (admin nav), Phase F (member nav).

## Scope Boundaries

Carried from the spec — out of scope here:

- **Visual redesign.** Tailwind classes are functional, not polished. A redesign effort runs concurrently in this repo and will layer over the structure this plan produces. Do not invest in visual polish during execution.
- **Multi-label per event.** Single label, locked.
- **Cross-app SSO.** Member and admin maintain separate sessions; a dual-role user signs in twice.
- **Unwinding the `Organization` data model.** Schema stays multi-org; admin binds to one via env var.
- **Admin landing for logged-out users.** Admin root is auth-gated; logged-out users redirect to OAuth login.
- **New member features beyond a dashboard home and label filter/badge.** No favorites, sharing, search, etc.
- **Subdomain routing for prod.** Captured as a follow-up spec; dev runs on `localhost:3000` and `localhost:3003` with cookie-prefix isolation.

### Deferred to follow-up work

- Label color / icon / hidden-label visibility — `EventLabel` ships with name/slug/sortOrder only.
- Tier-based label visibility (e.g. "members-only labels").
- Subdomain cookie scoping and reverse-proxy config for prod.
- Admin analytics, audit log surfaces, bulk operations.

## File Structure Overview

```
NEW:
  packages/web-shared/
    package.json
    tsconfig.json
    src/
      index.ts                          # barrel
      api/
        client.ts                       # apiFetch, publicApiFetch, UnauthorizedError, ApiError
        session.ts                      # readSession({ cookiePrefix })
        types.ts                        # all shared DTOs (formerly apps/web/src/lib/api/types.ts)
      oidc/
        config.ts                       # buildOidcConfig({ defaults }) -> { config, endpoints }
        pkce.ts                         # PKCE helpers (verbatim)
        refresh.ts                      # token refresh (verbatim)
      format.ts                         # formatDateTime, formatTimeUntil
      middleware.ts                     # createAuthRefreshMiddleware({ cookiePrefix, oidc })

  apps/admin/                           # fresh Next.js 16 app, port 3003
    package.json, tsconfig.json, next.config.ts, postcss/tailwind configs
    src/app/
      layout.tsx, globals.css, favicon.ico, page.tsx
      auth/{callback,login,logout}/route.ts
      events/{page,new/page,[eventId]/{page,EventEditor,actions,ticket-types/{page,TicketTypeEditor,actions}}}.tsx|.ts
      labels/{page,LabelEditor,actions}.tsx|.ts
      requests/{page,WaitlistQueue,actions}.tsx|.ts
    src/lib/oidc.ts                     # buildOidcConfig with admin defaults
    src/middleware.ts                   # createAuthRefreshMiddleware shim (prefix oh_admin_)
    .env.example, .env.local (gitignored)

  apps/api/event-labels/                # new NestJS module
    event-labels.module.ts
    event-labels.service.ts
    event-labels.controller.ts
    dto/{create-event-label,update-event-label,query-event-labels}.dto.ts
  apps/api/test/event-labels.e2e-spec.ts

  apps/api/scripts/seed.ts              # new — seeds house org + default labels
  packages/db/api/migrations/<ts>_add_event_labels/migration.sql

  scripts/setup-env.mjs                 # copies .env.example -> .env.local for each app+root
  apps/api/.env.example, apps/api/.env.local (gitignored)
  apps/accounts/.env.example, apps/accounts/.env.local (gitignored)
  apps/member/.env.example, apps/member/.env.local (gitignored, post-rename)
  apps/admin/.env.example, apps/admin/.env.local (gitignored)

RENAMED:
  apps/web/ -> apps/member/             # Phase D, single git mv

MODIFIED:
  packages/db/api/schema.prisma         # add EventLabel model + Event.labelId
  apps/api/src/app.module.ts            # register EventLabelsModule
  apps/api/src/events/events.service.ts # accept labelId on create/update; filter by labelId
  apps/api/src/events/events.controller.ts
  apps/api/src/events/dto/{create,update,list}.dto.ts
  apps/accounts/scripts/seed.ts         # rename organizer-web -> organizer-member; add organizer-admin
  apps/api/test/setup-env.ts            # also load apps/api/.env.local
  package.json (root)                   # add "setup:env" script
  README.md                             # new app layout, ports, setup:env
  .gitignore                            # apps/*/.env.local

DELETED (during Phase A/D moves; tracked as renames where possible):
  apps/web/src/lib/api/client.ts        # moved to packages/web-shared
  apps/web/src/lib/api/session.ts
  apps/web/src/lib/api/types.ts
  apps/web/src/lib/oidc/config.ts
  apps/web/src/lib/oidc/pkce.ts
  apps/web/src/lib/oidc/refresh.ts
  apps/web/src/lib/format.ts
  apps/web/src/middleware.ts            # replaced by shim that calls factory

DELETED (Phase F):
  apps/member/src/app/dashboard/organizations/**   # entire subtree — moved to admin in Phase E
  apps/member/src/app/dashboard/page.tsx           # replaced with member dashboard home
```

## Always-On Rules

The following rules apply to **every** Unit. Re-read before each commit.

- **Commit messages** — Conventional commit subject ≤ 70 chars (`feat:`, `chore:`, `fix:`, `refactor:`, `docs:`). One blank line, then a multi-line bullet body — one bullet per logical change. No prose paragraphs in the body. No `Co-Authored-By` trailers. No markdown headings inside the body. One commit per Unit (or per logically grouped Step set within a Unit if it explicitly says "commit checkpoint").
- **e2e tests run with `--runInBand`** — the api e2e suite shares a Postgres instance. The command is `pnpm -F api exec jest --config ./test/jest-e2e.json --runInBand`.
- **Migrations** — hand-write the SQL file under `packages/db/api/migrations/<UTC-timestamp>_<snake_name>/migration.sql`, then `pnpm -F db exec prisma migrate deploy --schema=../db/api/schema.prisma` (or the existing per-package script the repo uses; verify before running). **Never** run `prisma migrate dev` — the Phase 4 `add_ticket_request_partial_unique` migration uses a hand-written partial unique index that `migrate dev` would clobber on regenerate.
- **Web apps gate on `build && lint && typecheck`** — there is no test framework in the web apps. The lint pass is eslint only (no prettier). Manual smoke is the behavioral gate; record what you exercised when committing.
- **Turbopack stale cache** — after a structural change (rename, package move), `rm -rf apps/<app>/.next` if dev server crash-loops with "Next.js package not found".
- **No `--no-verify`, no force pushes** — if a hook fires, fix the cause.
- **Stage explicitly by filename** — `git add <path>`. Avoid `git add -A` / `git add .`.

## High-Level Technical Design

This plan is mechanically straightforward — the spec settled the architecture. Two implementation patterns are load-bearing and worth pre-internalizing:

### The middleware factory pattern

Next.js requires `middleware.ts` at the app root and looks for a file-level `export default` (or named `middleware` export). It cannot import a fully-formed middleware from another package — the file convention is a contract. The shared package therefore exports a **factory** that returns the middleware handler plus the `config` matcher object:

```ts
// packages/web-shared/src/middleware.ts
import type { NextRequest, NextResponse } from "next/server";
type Handler = (req: NextRequest) => Promise<NextResponse>;
export function createAuthRefreshMiddleware(opts: {
  cookiePrefix: string;
  oidc: ReturnType<typeof buildOidcConfig>;
}): { middleware: Handler; config: { matcher: string[] } } { /* … */ }
```

Each app's own `apps/<app>/src/middleware.ts` is a 4-line shim:

```ts
import { createAuthRefreshMiddleware } from "@organizer-hub/web-shared";
import { oidc } from "./lib/oidc";
const { middleware, config } = createAuthRefreshMiddleware({ cookiePrefix: "oh_member_", oidc });
export { middleware, config };
```

This is the only way to satisfy both the Next.js file convention and share the behavior across two apps.

### The cookie-prefix scheme

Browsers ignore port when scoping cookies on `localhost`. A cookie set by `localhost:3000` is visible to `localhost:3003`. Without a prefix, admin's middleware would see member's session cookie, try to refresh it against admin's OAuth client (a different client_id), and either error or — worse — silently rotate it under admin's prefix. The two-prefix scheme (`oh_member_`, `oh_admin_`) keeps the cookies disjoint.

Four cookies per app, all prefixed:

- `oh_<app>_session` — id_token JWT, persistent across the session.
- `oh_<app>_refresh` — refresh_token, persistent.
- `oh_<app>_pkce` — PKCE code_verifier, transient (cleared on callback).
- `oh_<app>_state` — OAuth `state` param, transient (cleared on callback).

`readSession`, the callback handler, the login handler, the logout handler, and the refresh middleware all read/write through the prefix. The prefix is set in one place per app (`lib/oidc.ts`) and threaded everywhere from there.

### The house-org binding

`apps/admin` is single-tenant for the operator. The `Organization` row still exists in the DB (the FK target for events, memberships, Stripe accounts, webhook reconciliation), but admin never lists, switches, or creates orgs. A server-only helper exported from `packages/web-shared`:

```ts
export function getHouseOrgId(): string {
  const id = process.env.HOUSE_ORG_ID;
  if (!id) throw new Error("HOUSE_ORG_ID is not set");
  return id;
}
```

Admin server actions and route handlers call `getHouseOrgId()` and pass the value to every org-scoped API call. The API stays org-aware (no schema change). The house org is seeded with a deterministic `id` so the value can be hard-coded into `apps/admin/.env.example`.

### The migration ordering

`EventLabel` (Phase C) lands before the apps are split, so the existing `apps/web` benefits from `?labelId` filtering during Phase C verification. The migration adds a nullable `labelId` FK on `Event` — existing rows are NULL on backfill; the API enforces presence when admin creates/updates events but stays permissive for the existing data.

---

## Implementation Units

26 units in dependency order across six phases.

```
Phase A (Extract)        A1 -> A2 -> A3 -> A4 -> A5
Phase B (Env)            B1 -> B2 -> B3
Phase C (EventLabel)     C1 -> C2 -> C3 -> C4 -> C5
Phase D (Rename)         D1 -> D2 -> D3
Phase E (Admin scaffold) E1 -> E2 -> E3 -> E4 -> E5 -> E6
Phase F (Member finish)  F1 -> F2 -> F3 -> F4
```

---

### Phase A — Extract `packages/web-shared`

Foundation. Pulls shared utilities out of `apps/web` into a workspace package and parameterizes them (cookie prefix, OIDC defaults). `apps/web` still exists at the end of Phase A, consuming the new package, with no behavioral change.

---

#### U-A1 — Scaffold `packages/web-shared`

**Files:**
- Create: `packages/web-shared/package.json`
- Create: `packages/web-shared/tsconfig.json`
- Create: `packages/web-shared/src/index.ts`

**Steps:**

- [ ] Create the directory tree: `mkdir -p packages/web-shared/src`.
- [ ] Write `packages/web-shared/package.json` — model after `packages/types/package.json`, which is the closest sibling. Required fields: `"name": "@organizer-hub/web-shared"`, `"private": true`, `"version": "0.0.0"`, `"type": "module"`, `"main": "./src/index.ts"`, `"types": "./src/index.ts"`. Add `"peerDependencies"` for `next` (matching the version in `apps/web/package.json`) and `"dependencies"` for `jose` (already used by the current `oidc/refresh.ts`).
- [ ] Write `packages/web-shared/tsconfig.json` — extend `packages/config/tsconfig.base.json` if present (check first; `ls packages/config/`). Set `"compilerOptions": { "outDir": "dist", "rootDir": "src" }` and `"include": ["src/**/*"]`. Mark it `"composite": false` (we are not pre-building — apps consume the TS source directly via the path alias).
- [ ] Write `packages/web-shared/src/index.ts` with one comment line and nothing else for now:

  ```ts
  // Barrel exports populated in U-A2..U-A5.
  export {};
  ```
- [ ] At repo root, `pnpm install`. Verify `node_modules/@organizer-hub/web-shared` is a symlink to `packages/web-shared`.
- [ ] Verify nothing broke: `pnpm -F web build && pnpm -F web typecheck && pnpm -F web lint`.
- [ ] **Commit**:

  ```
  chore: scaffold packages/web-shared workspace package

  - Add packages/web-shared with empty barrel, ready to receive moved helpers
  - Declare workspace dep on next (peer) and jose (runtime)
  - Verify pnpm symlink at node_modules/@organizer-hub/web-shared
  ```

---

#### U-A2 — Move API client, session, and types into shared

**Files:**
- Move: `apps/web/src/lib/api/client.ts` → `packages/web-shared/src/api/client.ts`
- Move: `apps/web/src/lib/api/session.ts` → `packages/web-shared/src/api/session.ts`
- Move: `apps/web/src/lib/api/types.ts`   → `packages/web-shared/src/api/types.ts`
- Modify: `packages/web-shared/src/index.ts`
- Modify: every file in `apps/web/src/**/*.ts` and `apps/web/src/**/*.tsx` that imports from `@/lib/api/*`

**Context:** `readSession` currently reads cookies via Next's `cookies()` and a hard-coded cookie name. It needs to take a `cookiePrefix` parameter. Same for any session-write helpers in `session.ts`. Inspect the current implementations before moving — the surface area is the source of truth.

**Steps:**

- [ ] `git mv apps/web/src/lib/api/client.ts packages/web-shared/src/api/client.ts`. Repeat for `session.ts` and `types.ts`.
- [ ] Open `packages/web-shared/src/api/session.ts`. Refactor its session-cookie-name constant into a parameter. The exported signature becomes:

  ```ts
  export type SessionCookieNames = {
    session: string;     // e.g. "oh_member_session"
    refresh: string;     // e.g. "oh_member_refresh"
  };
  export async function readSession(names: SessionCookieNames): Promise<Session | null> { /* … */ }
  ```

  If `session.ts` currently exports helpers like `clearSession` or `writeSession`, give them the same `names` parameter.
- [ ] In `packages/web-shared/src/api/client.ts`, leave `apiFetch`, `publicApiFetch`, `UnauthorizedError`, and `ApiError` as they are. They do not need parameterization — they read `process.env.NEXT_PUBLIC_API_URL` directly.
- [ ] Update `packages/web-shared/src/index.ts`:

  ```ts
  export { apiFetch, publicApiFetch, UnauthorizedError, ApiError } from "./api/client";
  export { readSession } from "./api/session";
  export type { SessionCookieNames } from "./api/session";
  export type * from "./api/types";
  ```
- [ ] Update every import in `apps/web/src/`. Find them with `rg "@/lib/api" apps/web/src/`. Replace `@/lib/api/client` → `@organizer-hub/web-shared`, `@/lib/api/session` → `@organizer-hub/web-shared`, `@/lib/api/types` → `@organizer-hub/web-shared`.
- [ ] Wherever `readSession()` is called with no args, pass the **forward-compatible** member prefix names: `readSession({ session: "oh_member_session", refresh: "oh_member_refresh" })`. (The actual cookie rename happens in U-A5; this just threads the parameter now to avoid a follow-up sweep.)
- [ ] Run gates: `pnpm -F web build && pnpm -F web typecheck && pnpm -F web lint`.
- [ ] Manual smoke: `pnpm -F web dev` → sign in → confirm `/dashboard` loads with session — note that the cookie name is still the old one at this point, so existing sessions still work. Sign out.
- [ ] **Commit**:

  ```
  refactor(web-shared): move api client/session/types into shared package

  - Move apps/web/src/lib/api/{client,session,types}.ts to packages/web-shared/src/api/
  - Parameterize readSession with a SessionCookieNames object (cookie prefix lands in U-A5)
  - Update every apps/web import from @/lib/api/* to @organizer-hub/web-shared
  ```

---

#### U-A3 — Move `format.ts` into shared

**Files:**
- Move: `apps/web/src/lib/format.ts` → `packages/web-shared/src/format.ts`
- Modify: `packages/web-shared/src/index.ts`
- Modify: every importer in `apps/web/src/**`

**Steps:**

- [ ] `git mv apps/web/src/lib/format.ts packages/web-shared/src/format.ts`.
- [ ] Append to `packages/web-shared/src/index.ts`:

  ```ts
  export { formatDateTime, formatTimeUntil } from "./format";
  ```

  (Adjust the export list to whatever `format.ts` actually exports — verify by inspection.)
- [ ] `rg "@/lib/format" apps/web/src/` and replace each import with `@organizer-hub/web-shared`.
- [ ] Run gates: `pnpm -F web build && pnpm -F web typecheck && pnpm -F web lint`.
- [ ] **Commit**:

  ```
  refactor(web-shared): move format helpers into shared package

  - Move apps/web/src/lib/format.ts to packages/web-shared/src/format.ts
  - Re-export formatDateTime and formatTimeUntil from the barrel
  - Update apps/web importers to @organizer-hub/web-shared
  ```

---

#### U-A4 — Convert OIDC config to a builder; move pkce/refresh

**Files:**
- Move: `apps/web/src/lib/oidc/pkce.ts`    → `packages/web-shared/src/oidc/pkce.ts`
- Move: `apps/web/src/lib/oidc/refresh.ts` → `packages/web-shared/src/oidc/refresh.ts`
- Create: `packages/web-shared/src/oidc/config.ts`
- Create: `apps/web/src/lib/oidc.ts` (calls the builder with member defaults)
- Delete: `apps/web/src/lib/oidc/config.ts` (after the new builder is in place)
- Modify: every importer of `oidcConfig` / `oidcEndpoints` in `apps/web/src/`

**Context:** Today `apps/web/src/lib/oidc/config.ts` exports a frozen `oidcConfig` constant whose `clientId` defaults to `"organizer-web"`. To support two apps with two clients, the shared package exports a `buildOidcConfig` factory that takes per-app defaults; the env-override behavior (`OAUTH_CLIENT_ID`, `OAUTH_REDIRECT_URI`, `OAUTH_POST_LOGOUT_REDIRECT_URI`) carries forward unchanged.

**Steps:**

- [ ] `git mv apps/web/src/lib/oidc/pkce.ts packages/web-shared/src/oidc/pkce.ts`.
- [ ] `git mv apps/web/src/lib/oidc/refresh.ts packages/web-shared/src/oidc/refresh.ts`.
- [ ] Inside `packages/web-shared/src/oidc/refresh.ts`, fix any imports that referenced sibling `config.ts` — they will become parameters on the function once we move callers. For now, point them at the new shared `./config`.
- [ ] Create `packages/web-shared/src/oidc/config.ts`:

  ```ts
  export type OidcDefaults = {
    defaultClientId: string;
    defaultRedirectUri: string;
    defaultPostLogoutRedirectUri: string;
  };

  export type OidcConfig = {
    issuer: string;
    clientId: string;
    redirectUri: string;
    postLogoutRedirectUri: string;
    scope: string;
  };

  export type OidcEndpoints = {
    authorize: string;
    token: string;
    userinfo: string;
    jwks: string;
    endSession: string;
  };

  export function buildOidcConfig(defaults: OidcDefaults): {
    config: OidcConfig;
    endpoints: OidcEndpoints;
  } {
    const issuer = process.env.NEXT_PUBLIC_ACCOUNTS_URL ?? "http://localhost:3002";
    const config: OidcConfig = {
      issuer,
      clientId: process.env.OAUTH_CLIENT_ID ?? defaults.defaultClientId,
      redirectUri: process.env.OAUTH_REDIRECT_URI ?? defaults.defaultRedirectUri,
      postLogoutRedirectUri:
        process.env.OAUTH_POST_LOGOUT_REDIRECT_URI ?? defaults.defaultPostLogoutRedirectUri,
      scope: "openid profile email offline_access",
    };
    const endpoints: OidcEndpoints = {
      authorize: `${issuer}/oidc/auth`,
      token: `${issuer}/oidc/token`,
      userinfo: `${issuer}/oidc/me`,
      jwks: `${issuer}/oidc/jwks`,
      endSession: `${issuer}/oidc/session/end`,
    };
    return { config, endpoints };
  }
  ```
- [ ] Append to `packages/web-shared/src/index.ts`:

  ```ts
  export { buildOidcConfig } from "./oidc/config";
  export type { OidcConfig, OidcEndpoints, OidcDefaults } from "./oidc/config";
  export { /* whatever pkce.ts exports */ } from "./oidc/pkce";
  export { refreshTokens } from "./oidc/refresh";   // adjust to actual export name
  ```
- [ ] Create `apps/web/src/lib/oidc.ts`:

  ```ts
  import { buildOidcConfig } from "@organizer-hub/web-shared";

  export const { config: oidcConfig, endpoints: oidcEndpoints } = buildOidcConfig({
    defaultClientId: "organizer-member",
    defaultRedirectUri: "http://localhost:3000/auth/callback",
    defaultPostLogoutRedirectUri: "http://localhost:3000/",
  });
  ```

  (Member defaults — the rename in Phase D switches the OAuth client name in seed; until then the existing `organizer-web` client still works because env vars are the override path. If you want zero-downtime during the in-between window, temporarily set `OAUTH_CLIENT_ID=organizer-web` in the root `.env` for the rest of Phase A; remove it in Phase D after seeding.)
- [ ] `rg "@/lib/oidc/config" apps/web/src/` and replace each with `@/lib/oidc` (the new local re-export). Replace `import { oidcConfig, oidcEndpoints } from "@/lib/oidc/config"` accordingly.
- [ ] `rg "@/lib/oidc/pkce" apps/web/src/` and `rg "@/lib/oidc/refresh" apps/web/src/` — replace with `@organizer-hub/web-shared`.
- [ ] Delete `apps/web/src/lib/oidc/config.ts` (the directory should also be empty now — leave it; the dir auto-disappears once empty in git, or remove explicitly with `rmdir apps/web/src/lib/oidc`).
- [ ] Run gates: `pnpm -F web build && pnpm -F web typecheck && pnpm -F web lint`.
- [ ] Manual smoke: dev server → sign in → ensure refresh still rotates the session cookie.
- [ ] **Commit**:

  ```
  refactor(web-shared): expose buildOidcConfig builder; move pkce and refresh

  - Move apps/web/src/lib/oidc/{pkce,refresh}.ts to packages/web-shared/src/oidc/
  - Replace the frozen oidcConfig constant with buildOidcConfig({ defaults })
  - apps/web/src/lib/oidc.ts now calls the builder with member-app defaults
  - Env overrides (OAUTH_CLIENT_ID, OAUTH_REDIRECT_URI, OAUTH_POST_LOGOUT_REDIRECT_URI) still win
  ```

---

#### U-A5 — Convert middleware to factory; thread cookie prefix; rewire `apps/web`

**Files:**
- Move + transform: `apps/web/src/middleware.ts` → `packages/web-shared/src/middleware.ts` (becomes `createAuthRefreshMiddleware`)
- Create: `apps/web/src/middleware.ts` (4-line shim)
- Modify: `apps/web/src/app/auth/callback/route.ts` (use `oh_member_` cookie names)
- Modify: `apps/web/src/app/auth/login/route.ts` (use `oh_member_` cookie names; PKCE + state cookies prefixed)
- Modify: `apps/web/src/app/auth/logout/route.ts` (clear `oh_member_*` cookies)
- Modify: any other call sites of `readSession()` that still use the temporary literal names from U-A2

**Context:** The Next.js middleware file convention requires a top-level `export default` (or a named `middleware` export) in a file at the app root. We can't import the middleware from a package directly — but we can have the package export a factory that returns the handler, and have a 4-line shim file at the app root that calls the factory and re-exports. The shared package's `createAuthRefreshMiddleware` takes `cookiePrefix` and the OIDC config, returns `{ middleware, config }`.

**Steps:**

- [ ] Read `apps/web/src/middleware.ts` end-to-end. Identify: (a) which cookies it reads/writes, (b) how it constructs cookie names, (c) what `config.matcher` looks like.
- [ ] Create `packages/web-shared/src/middleware.ts`:

  ```ts
  import type { NextRequest } from "next/server";
  import { NextResponse } from "next/server";
  import type { OidcConfig, OidcEndpoints } from "./oidc/config";
  import { refreshTokens } from "./oidc/refresh";

  export type AuthMiddlewareOptions = {
    cookiePrefix: string;       // e.g. "oh_member_"
    oidc: { config: OidcConfig; endpoints: OidcEndpoints };
    matcher?: string[];         // defaults to ["/((?!_next|favicon.ico|api/).*)"]
  };

  export function createAuthRefreshMiddleware(opts: AuthMiddlewareOptions) {
    const sessionCookie = `${opts.cookiePrefix}session`;
    const refreshCookie = `${opts.cookiePrefix}refresh`;
    async function middleware(req: NextRequest): Promise<NextResponse> {
      /* port the existing logic verbatim, swapping
         hard-coded cookie names for sessionCookie / refreshCookie,
         and calling opts.oidc.endpoints.token for refresh URLs. */
    }
    const config = { matcher: opts.matcher ?? ["/((?!_next|favicon.ico|api/).*)"] };
    return { middleware, config };
  }
  ```
- [ ] Export from the barrel:

  ```ts
  export { createAuthRefreshMiddleware } from "./middleware";
  export type { AuthMiddlewareOptions } from "./middleware";
  ```
- [ ] Replace `apps/web/src/middleware.ts` with the 4-line shim:

  ```ts
  import { createAuthRefreshMiddleware } from "@organizer-hub/web-shared";
  import { oidc } from "./lib/oidc";

  // Wrap the builder return into the shape the factory expects.
  const { middleware, config } = createAuthRefreshMiddleware({
    cookiePrefix: "oh_member_",
    oidc: { config: oidc.config, endpoints: oidc.endpoints },
  });
  export { middleware, config };
  ```

  Adjust `oidc` export shape to match what `apps/web/src/lib/oidc.ts` exports (`oidcConfig`, `oidcEndpoints` named exports). Wrap them into the `{ config, endpoints }` shape inline, or update `lib/oidc.ts` to also export a packaged `oidc` object.
- [ ] Update `apps/web/src/app/auth/login/route.ts`:
  - PKCE verifier cookie: `oh_member_pkce`
  - State cookie: `oh_member_state`
  - The handler should set these with `httpOnly: true`, `sameSite: "lax"`, `secure: process.env.NODE_ENV === "production"`, `path: "/"`, and the existing short max-age.
- [ ] Update `apps/web/src/app/auth/callback/route.ts`:
  - Read `oh_member_pkce`, `oh_member_state` from the request cookies; clear them on the response.
  - On token exchange success, set `oh_member_session` and `oh_member_refresh` cookies.
- [ ] Update `apps/web/src/app/auth/logout/route.ts`:
  - Clear `oh_member_session`, `oh_member_refresh`, `oh_member_pkce`, `oh_member_state` on the response. Then redirect to `oidcEndpoints.endSession` per the existing flow.
- [ ] Sweep any remaining `readSession()` calls inserted in U-A2 — they used the temporary literal names. If you took the shortcut in U-A2 of hard-coding `"oh_member_session"` everywhere, those values are already correct. If you used a different placeholder, replace now.
- [ ] Run gates: `pnpm -F web build && pnpm -F web typecheck && pnpm -F web lint`.
- [ ] Run the api e2e suite as a regression check (middleware changes do not touch the api, but the env load may): `pnpm -F api exec jest --config ./test/jest-e2e.json --runInBand`. All green.
- [ ] **Manual smoke** (cookie names just changed — existing sessions in your dev browser will be invalidated, which is expected one-time):
  1. Open a private window at `http://localhost:3000`.
  2. Sign in via OAuth; confirm callback succeeds.
  3. In DevTools → Application → Cookies, confirm the four cookies are all `oh_member_*` and the old unprefixed names are gone.
  4. Force a refresh past the access token's TTL (or wait it out); confirm middleware rotates the session cookie.
  5. Sign out; confirm all four cookies cleared.
- [ ] **Commit**:

  ```
  refactor(web-shared): expose createAuthRefreshMiddleware factory; prefix cookies oh_member_

  - Move auth-refresh middleware logic into packages/web-shared/src/middleware.ts as a factory
  - apps/web/src/middleware.ts is now a 4-line shim that wires the factory with cookiePrefix "oh_member_"
  - Rename session/refresh/pkce/state cookies to the oh_member_ prefix in login, callback, logout routes
  - One-time invalidation of existing dev sessions; re-login works
  ```

**Phase A complete.** `apps/web` still exists, runs on port 3000, consumes `packages/web-shared`, and uses the `oh_member_` cookie prefix. No member-visible behavior changed beyond the cookie name.

---

### Phase B — Per-app `.env.local` + `setup:env` script

Restructures environment configuration so each app owns its own env file. Lays the groundwork for the per-app OAuth client divergence that Phase E needs.

---

#### U-B1 — Trim root `.env`; create per-app `.env.example` files

**Files:**
- Modify: `.env` (root) — trim to shared infra only
- Modify: `.env.example` (root) — same trim
- Create: `apps/api/.env.example`
- Create: `apps/accounts/.env.example`
- Create: `apps/web/.env.example`
- Modify: `.gitignore`

**Context:** Today the root `.env` holds everything. We split shared infra (database URLs, Redis URL — anything root scripts touch) at the root; per-app secrets and per-app vars move to each app's own `.env.example` (checked in) + `.env.local` (gitignored).

**Steps:**

- [ ] Audit the current root `.env.example`. Bucket each line by which app needs it:
  - **Root** (shared infra): `DATABASE_URL`, `ACCOUNTS_DATABASE_URL`, `REDIS_URL`, anything used by root-level scripts (`pnpm prisma` from the root).
  - **api**: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `JWKS_URL`, mailer creds (Resend), `JWT_*`, `RATE_LIMIT_*`.
  - **accounts**: `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`, `OIDC_*`, anything specific to the accounts provider.
  - **web** (→ member after Phase D): `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_ACCOUNTS_URL`. (Leave `OAUTH_*` overrides out — the in-code defaults win for dev.)
- [ ] Write the trimmed root `.env.example` — keep only the "Root" bucket. Add a top comment:

  ```
  # Root .env — shared infra only. Per-app secrets live in apps/<app>/.env.local.
  # Run `pnpm setup:env` after cloning to scaffold per-app .env.local files from each .env.example.
  ```
- [ ] Write `apps/api/.env.example` — the "api" bucket above. Use sentinel values (`sk_test_REPLACE_ME`, etc.).
- [ ] Write `apps/accounts/.env.example` — the "accounts" bucket.
- [ ] Write `apps/web/.env.example` — the "web" bucket. Include commented-out `OAUTH_*` lines as documentation, defaulted to member values:

  ```
  # OAUTH_CLIENT_ID=organizer-member
  # OAUTH_REDIRECT_URI=http://localhost:3000/auth/callback
  # OAUTH_POST_LOGOUT_REDIRECT_URI=http://localhost:3000/
  NEXT_PUBLIC_API_URL=http://localhost:3001
  NEXT_PUBLIC_ACCOUNTS_URL=http://localhost:3002
  ```
- [ ] Update `.gitignore` to add (if not already covered):

  ```
  apps/*/.env.local
  apps/*/.env
  ```
- [ ] Mirror the trim from root `.env.example` into your local root `.env`: cut the per-app blocks out. **Before deleting them locally, copy each block into its respective `apps/<app>/.env.local`** so your dev environment still has the real secrets. (This is a local-only step; only the `.env.example` files are committed.)
- [ ] Start all four services with `pnpm dev` — verify api, accounts, and web all reach steady state. (Member rename hasn't happened yet, so it's still `apps/web`.)
- [ ] **Commit** (the four `.env.example` files + `.gitignore` + trimmed root `.env.example` only; `.env*.local` are gitignored):

  ```
  chore(env): split env into per-app .env.example files

  - Trim root .env.example to shared infra only (DATABASE_URL, ACCOUNTS_DATABASE_URL, REDIS_URL)
  - Add apps/api/.env.example for api secrets (Stripe, mailer, JWKS)
  - Add apps/accounts/.env.example for OIDC and JWT signing keys
  - Add apps/web/.env.example for NEXT_PUBLIC_* and documented OAUTH overrides
  - .gitignore apps/*/.env.local so each developer's local secrets stay out of git
  ```

---

#### U-B2 — `scripts/setup-env.mjs` + `pnpm setup:env`

**Files:**
- Create: `scripts/setup-env.mjs`
- Modify: `package.json` (root) — add `"setup:env"` script
- Modify: `README.md` — document the new bootstrap step

**Steps:**

- [ ] Create `scripts/setup-env.mjs`:

  ```js
  #!/usr/bin/env node
  // Copies every .env.example to a sibling .env.local if the local file does not exist.
  // Idempotent: never overwrites an existing .env.local.
  import { readdir, copyFile, access, stat } from "node:fs/promises";
  import { constants } from "node:fs";
  import { join } from "node:path";
  import { fileURLToPath } from "node:url";

  const REPO_ROOT = join(fileURLToPath(import.meta.url), "..", "..");
  const APPS_DIR = join(REPO_ROOT, "apps");

  async function exists(p) {
    try { await access(p, constants.F_OK); return true; } catch { return false; }
  }

  async function copyIfMissing(examplePath, localPath) {
    if (await exists(localPath)) {
      console.log(`  skip   ${localPath} (exists)`);
      return;
    }
    await copyFile(examplePath, localPath);
    console.log(`  create ${localPath}`);
  }

  async function main() {
    const targets = [];
    // Root.
    const rootExample = join(REPO_ROOT, ".env.example");
    if (await exists(rootExample)) {
      targets.push({ example: rootExample, local: join(REPO_ROOT, ".env") });
    }
    // Per-app.
    const apps = await readdir(APPS_DIR);
    for (const app of apps) {
      const appPath = join(APPS_DIR, app);
      const st = await stat(appPath);
      if (!st.isDirectory()) continue;
      const example = join(appPath, ".env.example");
      if (await exists(example)) {
        targets.push({ example, local: join(appPath, ".env.local") });
      }
    }
    console.log(`setup:env — ${targets.length} candidate(s)`);
    for (const t of targets) {
      await copyIfMissing(t.example, t.local);
    }
    console.log("done. fill in any sentinel values then `pnpm dev`.");
  }

  main().catch(err => { console.error(err); process.exit(1); });
  ```
- [ ] Add the script entry to root `package.json`:

  ```jsonc
  {
    "scripts": {
      // … existing scripts …
      "setup:env": "node scripts/setup-env.mjs"
    }
  }
  ```
- [ ] Verify idempotence: from a fresh state (`rm -f apps/*/.env.local`), run `pnpm setup:env`. Confirm each `.env.local` is created. Re-run — confirm each is `skip ... (exists)`.
- [ ] Update `README.md` "Getting started" (or equivalent section): replace the "copy `.env.example` to `.env`" instruction with "run `pnpm setup:env`, then fill in any sentinel values across `.env` and `apps/*/.env.local`".
- [ ] **Commit**:

  ```
  chore(env): add scripts/setup-env.mjs + pnpm setup:env

  - Copy every .env.example to sibling .env.local, idempotent (skip-if-exists)
  - Wire as root pnpm script
  - Update README getting-started section to point at pnpm setup:env
  ```

---

#### U-B3 — Repoint Nest `ConfigModule` paths; update test setup-env

**Files:**
- Modify: `apps/api/src/app.module.ts` (or wherever `ConfigModule.forRoot` lives in api)
- Modify: `apps/accounts/src/app.module.ts` (same for accounts)
- Modify: `apps/api/test/setup-env.ts` — also load `apps/api/.env.local`

**Context:** Today both Nest apps `findUp('.env')` to load the root `.env`. After Phase B, the api's secrets live in `apps/api/.env.local` and accounts' live in `apps/accounts/.env.local`. The root `.env` still loads first (for `DATABASE_URL`); per-app values layer on top.

**Steps:**

- [ ] In `apps/api/src/app.module.ts`, locate the `ConfigModule.forRoot(...)` call. Update to load **both** files in order (root first, app overlay second). Example:

  ```ts
  ConfigModule.forRoot({
    isGlobal: true,
    envFilePath: [".env.local", "apps/api/.env.local", ".env"],
  })
  ```

  Nest's `ConfigModule` reads earlier entries with higher priority by default when `expandVariables` is off — verify by reading the Nest docs version locked in `package.json` (`@nestjs/config`). If priority is the other way, reverse the array. The intent: per-app values override root.
- [ ] Repeat in `apps/accounts/src/app.module.ts` with `apps/accounts/.env.local` in place.
- [ ] In `apps/api/test/setup-env.ts`, append a second load after the root `.env` find:

  ```ts
  import * as fs from 'node:fs';
  import * as nodePath from 'node:path';
  import { config as loadDotenv } from 'dotenv';

  /* … existing findUp + loadDotenv for root .env … */

  // Layer apps/api/.env.local on top (per-app secrets in tests).
  const apiEnvLocal = nodePath.resolve(__dirname, '../.env.local');
  if (fs.existsSync(apiEnvLocal)) loadDotenv({ path: apiEnvLocal, override: false });
  ```

  `override: false` means root values win where both are set — same priority as the runtime app.
- [ ] Run the api e2e suite end-to-end: `pnpm -F api exec jest --config ./test/jest-e2e.json --runInBand`. All green.
- [ ] Run `pnpm dev` to boot all services; verify api and accounts both reach steady state with secrets read from their per-app `.env.local`.
- [ ] **Commit**:

  ```
  chore(env): repoint Nest ConfigModule and api test setup at per-app .env.local

  - apps/api ConfigModule loads root .env then apps/api/.env.local
  - apps/accounts ConfigModule loads root .env then apps/accounts/.env.local
  - apps/api/test/setup-env.ts layers apps/api/.env.local on top of root .env for e2e runs
  - All four services boot; api e2e suite green
  ```

**Phase B complete.** Each app owns its env. `pnpm setup:env` is the new clone-and-go step.

---

### Phase C — `EventLabel` backend

DB migration + API module. Independent of the app split; lands before admin scaffolds so Phase E can wire `/labels` against a working API.

---

#### U-C1 — Prisma migration + schema update

**Files:**
- Modify: `packages/db/api/schema.prisma`
- Create: `packages/db/api/migrations/<timestamp>_add_event_labels/migration.sql`

**Steps:**

- [ ] Inspect `packages/db/api/schema.prisma` around the `Organization` and `Event` models (line ~92 and ~125 per current state). Note: `Organization` has many relations; `Event` has `organizationId` FK.
- [ ] Append to `schema.prisma`:

  ```prisma
  model EventLabel {
    id             String   @id @default(cuid())
    organizationId String
    name           String
    slug           String
    sortOrder      Int      @default(0)
    createdAt      DateTime @default(now())
    updatedAt      DateTime @updatedAt
    organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
    events         Event[]

    @@unique([organizationId, slug])
    @@index([organizationId, sortOrder])
  }
  ```
- [ ] Update the existing `Event` model — add the FK relation:

  ```prisma
  model Event {
    // … existing fields …
    labelId String?
    label   EventLabel? @relation(fields: [labelId], references: [id], onDelete: SetNull)
    // … existing indexes …
  }
  ```
- [ ] Update the existing `Organization` model — add the back-relation:

  ```prisma
  model Organization {
    // … existing fields …
    eventLabels EventLabel[]
  }
  ```
- [ ] Generate a timestamp: `date -u +%Y%m%d%H%M%S` (e.g., `20260601000100`). Create the migration directory: `mkdir -p packages/db/api/migrations/20260601000100_add_event_labels`.
- [ ] Hand-write `packages/db/api/migrations/20260601000100_add_event_labels/migration.sql`:

  ```sql
  -- Create EventLabel table.
  CREATE TABLE "EventLabel" (
    "id"             TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name"           TEXT NOT NULL,
    "slug"           TEXT NOT NULL,
    "sortOrder"      INTEGER NOT NULL DEFAULT 0,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EventLabel_pkey" PRIMARY KEY ("id")
  );

  CREATE UNIQUE INDEX "EventLabel_organizationId_slug_key"
    ON "EventLabel"("organizationId", "slug");

  CREATE INDEX "EventLabel_organizationId_sortOrder_idx"
    ON "EventLabel"("organizationId", "sortOrder");

  ALTER TABLE "EventLabel"
    ADD CONSTRAINT "EventLabel_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

  -- Add Event.labelId nullable FK.
  ALTER TABLE "Event" ADD COLUMN "labelId" TEXT;

  ALTER TABLE "Event"
    ADD CONSTRAINT "Event_labelId_fkey"
    FOREIGN KEY ("labelId") REFERENCES "EventLabel"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

  CREATE INDEX "Event_labelId_idx" ON "Event"("labelId");
  ```

- [ ] Apply the migration: `pnpm -F db exec prisma migrate deploy --schema=./api/schema.prisma`. (Verify the exact command from the existing `packages/db/package.json` scripts — it may be wrapped as `pnpm db:api:migrate` or similar.) **Do NOT use `migrate dev`.**
- [ ] Regenerate the Prisma client: `pnpm -F db exec prisma generate --schema=./api/schema.prisma`.
- [ ] Run the api e2e suite — confirms no existing tests broke: `pnpm -F api exec jest --config ./test/jest-e2e.json --runInBand`. All green.
- [ ] **Commit**:

  ```
  feat(db): add EventLabel model and Event.labelId FK

  - Add EventLabel { id, organizationId, name, slug, sortOrder, createdAt, updatedAt } with unique (organizationId, slug)
  - Add Event.labelId nullable FK with ON DELETE SET NULL (existing rows backfill as NULL)
  - Hand-written migration applied via prisma migrate deploy
  ```

---

#### U-C2 — `EventLabelsModule` scaffold (TDD: e2e tests first)

**Files:**
- Create: `apps/api/src/event-labels/event-labels.module.ts`
- Create: `apps/api/src/event-labels/event-labels.service.ts`
- Create: `apps/api/src/event-labels/event-labels.controller.ts`
- Create: `apps/api/src/event-labels/dto/create-event-label.dto.ts`
- Create: `apps/api/src/event-labels/dto/update-event-label.dto.ts`
- Create: `apps/api/src/event-labels/dto/query-event-labels.dto.ts`
- Create: `apps/api/test/event-labels.e2e-spec.ts`
- Modify: `apps/api/src/app.module.ts`

**Context:** Model after `apps/api/src/organizations/`. Read `organizations.controller.ts` and `organizations.service.ts` first. The org-membership guard pattern (which checks the caller's role on the org being touched) is the gate for write operations. Read access (`GET /api/event-labels?organizationId=...`) is allowed for any signed-in member of the org.

**Steps:**

- [ ] Create the test file first. `apps/api/test/event-labels.e2e-spec.ts`:

  ```ts
  import type { INestApplication } from '@nestjs/common';
  import { bootTestApp } from './helpers/boot-test-app';     // adjust import to actual helper path
  import { signInAs, createOrgWith } from './helpers/...';   // mirror existing helpers; see organizations.e2e-spec.ts

  describe('EventLabels (e2e)', () => {
    let app: INestApplication;

    beforeAll(async () => { app = await bootTestApp(); });
    afterAll(async () => { await app.close(); });

    describe('GET /api/event-labels', () => {
      it('returns labels for an org the caller is a member of', async () => { /* … */ });
      it('returns 403 when caller is not a member of the org', async () => { /* … */ });
      it('orders by sortOrder ascending then name ascending', async () => { /* … */ });
    });

    describe('POST /api/event-labels', () => {
      it('creates a label as OWNER/ADMIN; returns 201 with body', async () => { /* … */ });
      it('rejects creation as MEMBER with 403', async () => { /* … */ });
      it('rejects duplicate (organizationId, slug) with 409', async () => { /* … */ });
      it('validates name (non-empty, <= 60 chars)', async () => { /* … */ });
      it('validates slug (lowercase, hyphen-separated, <= 60 chars)', async () => { /* … */ });
    });

    describe('PATCH /api/event-labels/:id', () => {
      it('renames a label as OWNER/ADMIN; sortOrder change persists', async () => { /* … */ });
      it('returns 404 when the label is not in the caller’s orgs', async () => { /* … */ });
    });

    describe('DELETE /api/event-labels/:id', () => {
      it('deletes when no events reference the label', async () => { /* … */ });
      it('returns 409 with { eventCount } when at least one event references the label', async () => { /* … */ });
    });
  });
  ```

  Use helpers from the existing test suite (`organizations.e2e-spec.ts`, `events.e2e-spec.ts`) for `bootTestApp`, OAuth login mocks, and org-with-members fixtures. Do not invent new helpers in this unit.
- [ ] Run the tests to confirm they fail (because the module doesn't exist):

  ```
  pnpm -F api exec jest --config ./test/jest-e2e.json --runInBand --testPathPattern event-labels
  ```

  Expected: every test fails on route 404 or missing module.
- [ ] Create the DTOs.

  `apps/api/src/event-labels/dto/create-event-label.dto.ts`:

  ```ts
  import { IsInt, IsOptional, IsString, Length, Matches, Min } from 'class-validator';

  export class CreateEventLabelDto {
    @IsString() organizationId!: string;
    @IsString() @Length(1, 60) name!: string;
    @IsString() @Matches(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/) @Length(1, 60) slug!: string;
    @IsOptional() @IsInt() @Min(0) sortOrder?: number;
  }
  ```

  `update-event-label.dto.ts`: same fields, all optional, omit `organizationId`.

  `query-event-labels.dto.ts`:

  ```ts
  import { IsString } from 'class-validator';

  export class QueryEventLabelsDto {
    @IsString() organizationId!: string;
  }
  ```
- [ ] Create `apps/api/src/event-labels/event-labels.service.ts` — methods `list(orgId)`, `create(dto)`, `update(id, dto)`, `delete(id)`. The service depends on `PrismaService` (look at `events.service.ts` for the constructor pattern). `delete` does a count first:

  ```ts
  async delete(id: string): Promise<void> {
    const eventCount = await this.prisma.event.count({ where: { labelId: id } });
    if (eventCount > 0) {
      throw new ConflictException({ message: 'Label is referenced by events', eventCount });
    }
    await this.prisma.eventLabel.delete({ where: { id } });
  }
  ```

  `create` catches `P2002` on the unique constraint and throws `ConflictException('Duplicate slug for organization')`.

  `list` orders by `[{ sortOrder: 'asc' }, { name: 'asc' }]`.
- [ ] Create `apps/api/src/event-labels/event-labels.controller.ts`. Follow the route shape and guard pattern from `organizations.controller.ts`:

  ```ts
  @Controller('api/event-labels')
  @UseGuards(JwtAuthGuard)
  export class EventLabelsController {
    constructor(private readonly service: EventLabelsService) {}

    @Get()
    list(@Req() req: AuthedRequest, @Query() q: QueryEventLabelsDto) {
      return this.service.listForUser(req.user, q.organizationId);
    }

    @Post()
    @HttpCode(201)
    create(@Req() req: AuthedRequest, @Body() dto: CreateEventLabelDto) {
      return this.service.createForUser(req.user, dto);
    }

    @Patch(':id')
    update(@Req() req: AuthedRequest, @Param('id') id: string, @Body() dto: UpdateEventLabelDto) {
      return this.service.updateForUser(req.user, id, dto);
    }

    @Delete(':id')
    @HttpCode(204)
    remove(@Req() req: AuthedRequest, @Param('id') id: string) {
      return this.service.deleteForUser(req.user, id);
    }
  }
  ```

  The `*ForUser` methods on the service apply org-membership guards (OWNER/ADMIN for write; any role for read).
- [ ] Create `apps/api/src/event-labels/event-labels.module.ts`:

  ```ts
  import { Module } from '@nestjs/common';
  import { PrismaModule } from '../prisma/prisma.module';
  import { EventLabelsController } from './event-labels.controller';
  import { EventLabelsService } from './event-labels.service';

  @Module({
    imports: [PrismaModule],
    controllers: [EventLabelsController],
    providers: [EventLabelsService],
    exports: [EventLabelsService],
  })
  export class EventLabelsModule {}
  ```
- [ ] Register in `apps/api/src/app.module.ts` imports array.
- [ ] Re-run the test suite. Iterate until green:

  ```
  pnpm -F api exec jest --config ./test/jest-e2e.json --runInBand --testPathPattern event-labels
  ```
- [ ] Full e2e regression: `pnpm -F api exec jest --config ./test/jest-e2e.json --runInBand`. All green.
- [ ] **Commit**:

  ```
  feat(api): add EventLabel CRUD module with org-scoped access

  - Add EventLabelsModule with list/create/update/delete endpoints under /api/event-labels
  - OWNER/ADMIN required for writes; any org member can read
  - Delete returns 409 + eventCount when any event references the label
  - Duplicate (organizationId, slug) returns 409
  - e2e suite covers permission, validation, ordering, and delete-blocked paths
  ```

---

#### U-C3 — Extend `Event` create/update to accept `labelId`; filter list by `?labelId`

**Files:**
- Modify: `apps/api/src/events/dto/create-event.dto.ts` (or wherever the create DTO lives)
- Modify: `apps/api/src/events/dto/update-event.dto.ts`
- Modify: `apps/api/src/events/dto/list-events.dto.ts` (or the public-events DTO if separate)
- Modify: `apps/api/src/events/events.service.ts`
- Modify: `apps/api/src/events/events.controller.ts` (likely no change if it already passes the query DTO through)
- Modify: `apps/api/src/public/public.controller.ts` (or wherever `/api/orgs/:orgId/events` lives) — add `?labelId` to the public list as well, for member filter
- Modify: `apps/api/test/events.e2e-spec.ts` (or add tests to event-labels.e2e-spec.ts) — add `?labelId` filter coverage + cross-org-label rejection

**Context:** `labelId` is optional; validation must reject a `labelId` belonging to a different org than the event's `organizationId` (caught with a 400 with a clear message).

**Steps:**

- [ ] Add optional `labelId?: string` to both create and update DTOs. Use `@IsOptional() @IsString()`.
- [ ] In `events.service.ts`, in the create/update methods: if `labelId` is set, fetch the label and assert `label.organizationId === eventOrgId`. Throw `BadRequestException('Label does not belong to the event organization')` on mismatch.
- [ ] Add `?labelId=` to the events list query. In the list DTO, `@IsOptional() @IsString() labelId?: string`. In the service, append `if (q.labelId) where.labelId = q.labelId;`.
- [ ] Add the same `?labelId=` support to the public events endpoint (the one member-side `/events` uses). Verify which controller serves it (`apps/api/src/public/` or similar).
- [ ] Add 4 tests:
  1. Create event with valid `labelId` — succeeds; returned event has `labelId` set.
  2. Create event with `labelId` belonging to a different org — 400 with the expected message.
  3. List `?labelId=<id>` returns only matching events; without filter, returns all.
  4. Update event with a `null` `labelId` clears the label (the DTO needs to allow explicit null vs undefined — verify or document the chosen semantics).
- [ ] Run targeted: `pnpm -F api exec jest --config ./test/jest-e2e.json --runInBand --testPathPattern "events|event-labels"`.
- [ ] Full e2e regression. All green.
- [ ] **Commit**:

  ```
  feat(api): events accept and filter by labelId

  - Add optional labelId to event create/update DTOs; validate same-org membership
  - Add ?labelId filter to events list (org-scoped and public endpoints)
  - Reject cross-org labelId assignment with 400
  - e2e covers happy path, cross-org rejection, list filter, and clearing the label
  ```

---

#### U-C4 — Default `EventLabel` seed for the house org

**Files:**
- Create or Modify: `apps/api/scripts/seed.ts` (create if it does not exist — currently only `apps/accounts/scripts/seed.ts` does)
- Modify: `apps/api/package.json` — add `"seed": "ts-node scripts/seed.ts"` (or whatever ts runner the accounts seed uses — copy that pattern)

**Context:** This unit creates the api seed script for the first time. It seeds (a) the house `Organization` row with a deterministic id and (b) three default `EventLabel` rows attached to it. The deterministic id is the value `apps/admin/.env.example` references in Phase E.

**Steps:**

- [ ] Read `apps/accounts/scripts/seed.ts` for the dotenv-loading + Prisma-client pattern. Mirror it.
- [ ] Pick a deterministic id for the house org. Use a fixed cuid-shape string, e.g., `org_house_000000000000000001`. The shape doesn't have to be a real cuid as long as Prisma accepts arbitrary strings for `@id @default(cuid())` columns (cuid is only the default — explicit values pass through). Verify with a small test create first; if Prisma rejects, use an actual cuid generator and hard-code its output.
- [ ] Write `apps/api/scripts/seed.ts`:

  ```ts
  import { config } from 'dotenv';
  import path from 'node:path';

  config({ path: path.resolve(__dirname, '../../../.env') });
  config({ path: path.resolve(__dirname, '../.env.local'), override: false });

  import { PrismaClient } from '@organizer-hub/db/api';

  const HOUSE_ORG_ID = 'org_house_000000000000000001';
  const HOUSE_ORG_NAME = 'House Organization';

  async function main(): Promise<void> {
    const prisma = new PrismaClient();
    try {
      const org = await prisma.organization.upsert({
        where: { id: HOUSE_ORG_ID },
        update: { name: HOUSE_ORG_NAME },
        create: { id: HOUSE_ORG_ID, name: HOUSE_ORG_NAME /* fill required fields per schema */ },
      });
      console.log(`seeded house organization: ${org.id} (${org.name})`);

      const defaults = [
        { slug: 'concerts',  name: 'Concerts',  sortOrder: 0 },
        { slug: 'workshops', name: 'Workshops', sortOrder: 1 },
        { slug: 'community', name: 'Community', sortOrder: 2 },
      ];
      for (const d of defaults) {
        const label = await prisma.eventLabel.upsert({
          where: { organizationId_slug: { organizationId: HOUSE_ORG_ID, slug: d.slug } },
          update: { name: d.name, sortOrder: d.sortOrder },
          create: { ...d, organizationId: HOUSE_ORG_ID },
        });
        console.log(`  - label: ${label.slug} (${label.name})`);
      }

      console.log(`\nHOUSE_ORG_ID=${HOUSE_ORG_ID}`);
      console.log('Add this to apps/admin/.env.local in Phase E.');
    } finally {
      await prisma.$disconnect();
    }
  }

  void main();
  ```

  Replace `/* fill required fields per schema */` with whatever fields the `Organization` model marks as required without a default (`slug`, `createdAt`, etc. — check the schema).
- [ ] Add the script to `apps/api/package.json`:

  ```jsonc
  "scripts": {
    "seed": "ts-node scripts/seed.ts"
  }
  ```

  (Match the ts runner / transpiler the accounts seed uses — if accounts uses `tsx`, use `tsx`. Inspect first.)
- [ ] Run it: `pnpm -F api seed`. Confirm the printed id and three labels. Re-run — should be idempotent.
- [ ] Verify in the DB (psql or Prisma Studio): house org row exists; three EventLabel rows exist tied to it.
- [ ] Full e2e regression: `pnpm -F api exec jest --config ./test/jest-e2e.json --runInBand`. All green (seed runs are isolated from test DBs).
- [ ] **Commit**:

  ```
  feat(api): seed house organization and default event labels

  - Add apps/api/scripts/seed.ts that upserts a house Organization with deterministic id and three default EventLabel rows (Concerts, Workshops, Community)
  - Wire pnpm -F api seed
  - Print the HOUSE_ORG_ID for Phase E to consume in apps/admin/.env.local
  ```

---

#### U-C5 — Verification gate

This unit is the explicit Phase C checkpoint. No code; sanity-check the pieces.

**Steps:**

- [ ] `pnpm -F api exec jest --config ./test/jest-e2e.json --runInBand` — green.
- [ ] `pnpm -F api seed` — idempotent, prints expected id and labels.
- [ ] From a running api (`pnpm -F api dev`), with an OAuth token for a user who is OWNER of the house org:
  - `GET /api/event-labels?organizationId=org_house_000000000000000001` → returns 3 labels in `sortOrder` order.
  - `POST /api/event-labels` with a fresh slug → 201.
  - `POST` with a duplicate slug → 409.
  - `DELETE` on a label that has no events → 204.
  - Create an event in this org with `labelId=<one of the 3 default ids>` → 200; verify in DB the label is set.
  - `DELETE` that label → 409 with `{ eventCount: 1 }`.
- [ ] No commit (verification only). If something breaks, fix in the relevant Unit (C1–C4) and retry.

**Phase C complete.** The EventLabel feature is fully backed; admin scaffolding in Phase E can wire UI against working endpoints.

---

### Phase D — Rename `apps/web` → `apps/member`

Pure rename. No behavior change, no route change, no middleware change. Kept as its own phase so any rename breakage is easy to bisect.

---

#### U-D1 — `git mv apps/web apps/member`; rename package + .env

**Files:**
- Renamed: every file under `apps/web/` → `apps/member/`
- Modify: `apps/member/package.json` — `"name": "@organizer-hub/member"`
- (No other changes in this Unit)

**Steps:**

- [ ] Stop any running dev server.
- [ ] `git mv apps/web apps/member`. Verify nothing was missed: `ls apps/web` should fail; `ls apps/member` should show the moved tree.
- [ ] Open `apps/member/package.json`. Change `"name"` to `"@organizer-hub/member"`. Leave the dev script as `next dev -p 3000`. Leave all other scripts and dependencies untouched.
- [ ] `pnpm install` at the root — confirms pnpm picks up the new package name. Should be quick (no actual install work, just lockfile updates).
- [ ] **Do not** commit yet — wait for U-D2.

---

#### U-D2 — Update Turborepo / workspace references; rename `organizer-web` → `organizer-member` in accounts seed

**Files:**
- Modify: `turbo.json` (only if it has app-name overrides — inspect)
- Modify: `pnpm-workspace.yaml` (only if it has explicit per-app entries beyond the `apps/*` glob — current state uses `apps/*`, so no edit needed)
- Modify: `apps/accounts/scripts/seed.ts` — rename the OAuth client `organizer-web` → `organizer-member`
- Modify: any references to `apps/web` in `README.md`, `docs/`, root configs

**Steps:**

- [ ] `rg "apps/web|@organizer-hub/web|organizer-web" --hidden -g '!node_modules' -g '!.next' -g '!dist'`. Triage each hit:
  - `docs/**` references — update path and name.
  - `README.md` references — update.
  - `apps/accounts/scripts/seed.ts` — change `clientId: 'organizer-web'` → `'organizer-member'` and `name: 'OrganizerHub Web'` → `'OrganizerHub Member'`.
  - `turbo.json` — likely no hits since it uses `tasks` not app names.
  - Comments inside source code that reference paths — update.
  - Existing `docs/specs/` and `docs/plans/` files — update only the cross-links if they break path resolution, otherwise leave (those docs are historical records).
- [ ] Re-seed the accounts client to pick up the rename: `pnpm -F accounts seed`. Confirm it prints `seeded OAuth client: organizer-member`.
- [ ] Run gates: `pnpm -F member build && pnpm -F member typecheck && pnpm -F member lint`.
- [ ] Run api e2e regression: `pnpm -F api exec jest --config ./test/jest-e2e.json --runInBand`. All green.
- [ ] **Commit** (U-D1 + U-D2 together as the rename):

  ```
  refactor: rename apps/web to apps/member; rename OAuth client organizer-web to organizer-member

  - git mv apps/web apps/member; package name now @organizer-hub/member
  - apps/accounts/scripts/seed.ts upserts organizer-member in place of organizer-web
  - Update docs, README, and source comments that referenced apps/web or organizer-web
  - Member dev port stays 3000; cookies (oh_member_*) and middleware unchanged from Phase A
  ```

---

#### U-D3 — Verification

**Steps:**

- [ ] `rm -rf apps/member/.next` (Turbopack cache from before the rename will crash-loop).
- [ ] `pnpm -F member dev`. Sign in from a private window. Confirm session cookie is `oh_member_session`, OAuth flow hits `client_id=organizer-member` in the accounts URL.
- [ ] Buy a ticket end-to-end (or run the Phase 4 capacity flow). Confirm nothing regressed.
- [ ] **No commit** (verification only).

**Phase D complete.** `apps/web` no longer exists; `apps/member` is the consumer app, behaviorally identical to Phase A's end state.

---

### Phase E — Scaffold `apps/admin`

Fresh app at port 3003 with the same baseline stack. Ports organizer routes from member (flattened — no `[orgId]`), adds the `/labels` page, seeds a second OAuth client.

---

#### U-E1 — Scaffold `apps/admin` skeleton

**Files:**
- Create: `apps/admin/package.json`
- Create: `apps/admin/tsconfig.json`
- Create: `apps/admin/next.config.ts`
- Create: `apps/admin/postcss.config.mjs` (copy from member)
- Create: `apps/admin/tailwind.config.ts` (copy from member)
- Create: `apps/admin/.gitignore` (copy from member)
- Create: `apps/admin/eslint.config.mjs` (copy from member)
- Create: `apps/admin/src/app/layout.tsx`
- Create: `apps/admin/src/app/page.tsx` (temporary "Hello admin" — replaced in U-E4)
- Create: `apps/admin/src/app/globals.css` (copy from member)
- Create: `apps/admin/public/favicon.ico` (copy from member)

**Context:** Do not use `create-next-app`. Replicate `apps/member` baseline so the two apps stay aligned.

**Steps:**

- [ ] Read `apps/member/package.json`. Copy its dev/build/lint/typecheck scripts, dependencies, and devDependencies into a new `apps/admin/package.json`. Change `"name"` to `"@organizer-hub/admin"`. Change `"dev"` port to `3003` and `"start"` port to `3003`. Add `"@organizer-hub/web-shared": "workspace:*"` to dependencies.
- [ ] Copy `apps/member/tsconfig.json` to `apps/admin/tsconfig.json`. No path changes needed (relative paths resolve from each app dir).
- [ ] Copy `apps/member/next.config.ts` to `apps/admin/next.config.ts`. If it loads dotenv from a custom path, point that path at `apps/admin/.env.local` (and root `.env` second).
- [ ] Copy the remaining configs (`postcss`, `tailwind`, `eslint`, `.gitignore`) from member to admin.
- [ ] Create `apps/admin/src/app/layout.tsx` — copy member's root layout, change the `<title>` to `OrganizerHub Admin` and any branding text accordingly. (Visual polish is out of scope; functional only.)
- [ ] Create `apps/admin/src/app/page.tsx` — temporary placeholder:

  ```tsx
  export default function HomePage() {
    return <main className="p-8"><h1 className="text-2xl">Admin (placeholder — replaced in U-E4)</h1></main>;
  }
  ```
- [ ] Copy `apps/member/src/app/globals.css` to `apps/admin/src/app/globals.css`.
- [ ] Copy `apps/member/public/favicon.ico` to `apps/admin/public/favicon.ico`.
- [ ] `pnpm install` at the root — picks up the new workspace package.
- [ ] `pnpm -F admin build && pnpm -F admin typecheck && pnpm -F admin lint`. All clean.
- [ ] `pnpm -F admin dev`. Visit `http://localhost:3003`. See the placeholder.
- [ ] **Commit**:

  ```
  chore(admin): scaffold apps/admin baseline on port 3003

  - Copy package, tsconfig, next.config, tailwind/postcss/eslint configs from apps/member
  - Add workspace dep on @organizer-hub/web-shared
  - Placeholder home page; layout and globals copied from member
  - Build/lint/typecheck clean; dev server reachable at localhost:3003
  ```

---

#### U-E2 — Admin middleware + `lib/oidc.ts` + `getHouseOrgId`

**Files:**
- Create: `apps/admin/src/lib/oidc.ts`
- Create: `apps/admin/src/middleware.ts`
- Modify: `packages/web-shared/src/index.ts` — export `getHouseOrgId`
- Create: `packages/web-shared/src/house-org.ts`

**Steps:**

- [ ] Create `packages/web-shared/src/house-org.ts`:

  ```ts
  // Server-only: reads HOUSE_ORG_ID at runtime so the admin app can bind to one org.
  export function getHouseOrgId(): string {
    const id = process.env.HOUSE_ORG_ID;
    if (!id) {
      throw new Error("HOUSE_ORG_ID is not set. Add it to apps/admin/.env.local.");
    }
    return id;
  }
  ```
- [ ] Export from barrel:

  ```ts
  export { getHouseOrgId } from "./house-org";
  ```
- [ ] Create `apps/admin/src/lib/oidc.ts`:

  ```ts
  import { buildOidcConfig } from "@organizer-hub/web-shared";

  export const oidc = buildOidcConfig({
    defaultClientId: "organizer-admin",
    defaultRedirectUri: "http://localhost:3003/auth/callback",
    defaultPostLogoutRedirectUri: "http://localhost:3003/",
  });
  ```
- [ ] Create `apps/admin/src/middleware.ts` — same shim shape as member, different prefix:

  ```ts
  import { createAuthRefreshMiddleware } from "@organizer-hub/web-shared";
  import { oidc } from "./lib/oidc";

  const { middleware, config } = createAuthRefreshMiddleware({
    cookiePrefix: "oh_admin_",
    oidc: { config: oidc.config, endpoints: oidc.endpoints },
  });
  export { middleware, config };
  ```
- [ ] `pnpm -F admin build && pnpm -F admin typecheck && pnpm -F admin lint`. (Will fail at runtime if HOUSE_ORG_ID isn't set, but build/typecheck only need the imports to resolve.)
- [ ] **Commit**:

  ```
  feat(admin): add OIDC builder, middleware shim, and getHouseOrgId helper

  - apps/admin/src/lib/oidc.ts wires buildOidcConfig with admin defaults (organizer-admin, port 3003)
  - apps/admin/src/middleware.ts shim calls createAuthRefreshMiddleware with oh_admin_ cookie prefix
  - packages/web-shared exports getHouseOrgId(): reads HOUSE_ORG_ID at runtime, throws if unset
  ```

---

#### U-E3 — Seed `organizer-admin` OAuth client; create admin env files

**Files:**
- Modify: `apps/accounts/scripts/seed.ts` — add `organizer-admin` upsert
- Create: `apps/admin/.env.example`
- Create: `apps/admin/.env.local` (not committed; gitignored)

**Steps:**

- [ ] Edit `apps/accounts/scripts/seed.ts`. Append a second upsert call after the `organizer-member` block:

  ```ts
  const admin = await prisma.oAuthClient.upsert({
    where: { clientId: 'organizer-admin' },
    update: {
      redirectUris: ['http://localhost:3003/auth/callback'],
      postLogoutRedirectUris: ['http://localhost:3003/'],
      scopes: ['openid', 'profile', 'email', 'offline_access'],
      grantTypes: ['authorization_code', 'refresh_token'],
      responseTypes: ['code'],
      isPublic: true,
      pkceRequired: true,
    },
    create: {
      clientId: 'organizer-admin',
      name: 'OrganizerHub Admin',
      clientSecret: null,
      redirectUris: ['http://localhost:3003/auth/callback'],
      postLogoutRedirectUris: ['http://localhost:3003/'],
      grantTypes: ['authorization_code', 'refresh_token'],
      responseTypes: ['code'],
      scopes: ['openid', 'profile', 'email', 'offline_access'],
      isPublic: true,
      pkceRequired: true,
    },
  });
  console.log(`seeded OAuth client: ${admin.clientId} (${admin.name})`);
  ```
- [ ] Optional cleanup: while you are here, add a one-line delete to drop the obsolete `organizer-web` client now that no app references it (Phase D already replaced the seed with `organizer-member`; this just removes the row that the old seed left):

  ```ts
  const deleted = await prisma.oAuthClient.deleteMany({ where: { clientId: 'organizer-web' } });
  if (deleted.count > 0) console.log(`deleted obsolete OAuth client: organizer-web`);
  ```
- [ ] Run the seed: `pnpm -F accounts seed`. Confirm both clients printed; obsolete one deleted on first run, idempotent on rerun.
- [ ] Create `apps/admin/.env.example`:

  ```
  # apps/admin env. Run `pnpm setup:env` to copy this to .env.local.
  NEXT_PUBLIC_API_URL=http://localhost:3001
  NEXT_PUBLIC_ACCOUNTS_URL=http://localhost:3002

  # In-code defaults: organizer-admin / port 3003 redirects. Uncomment to override.
  # OAUTH_CLIENT_ID=organizer-admin
  # OAUTH_REDIRECT_URI=http://localhost:3003/auth/callback
  # OAUTH_POST_LOGOUT_REDIRECT_URI=http://localhost:3003/

  # Single-tenant binding — paste the id printed by `pnpm -F api seed`.
  HOUSE_ORG_ID=org_house_000000000000000001
  ```
- [ ] Run `pnpm setup:env` — creates `apps/admin/.env.local` from the example.
- [ ] Verify by booting admin (you'll need at least one signed-in user for downstream units, but middleware should at least not crash on missing HOUSE_ORG_ID): `pnpm -F admin dev`. Visit `/`. Confirm middleware redirects you to the OAuth login at `accounts` with `client_id=organizer-admin`. Sign in. Land back at admin. (Placeholder page still — that's U-E4.)
- [ ] **Commit** (only `.env.example`, the seed change, and accounts seed updates; `.env.local` is gitignored):

  ```
  feat(admin): seed organizer-admin OAuth client; add admin env files

  - apps/accounts/scripts/seed.ts now upserts organizer-admin client for port 3003 redirects
  - Delete obsolete organizer-web client row if present (idempotent)
  - Add apps/admin/.env.example documenting NEXT_PUBLIC_* and HOUSE_ORG_ID
  - Setup:env helper creates apps/admin/.env.local from the example
  ```

---

#### U-E4 — Port organizer routes from member to admin (flattened, no `[orgId]`)

**Files:**
- Create: `apps/admin/src/app/auth/callback/route.ts`
- Create: `apps/admin/src/app/auth/login/route.ts`
- Create: `apps/admin/src/app/auth/logout/route.ts`
- Create: `apps/admin/src/app/events/page.tsx`
- Create: `apps/admin/src/app/events/new/page.tsx`
- Create: `apps/admin/src/app/events/new/actions.ts`
- Create: `apps/admin/src/app/events/[eventId]/page.tsx`
- Create: `apps/admin/src/app/events/[eventId]/EventEditor.tsx`
- Create: `apps/admin/src/app/events/[eventId]/actions.ts`
- Create: `apps/admin/src/app/events/[eventId]/ticket-types/page.tsx`
- Create: `apps/admin/src/app/events/[eventId]/ticket-types/TicketTypeEditor.tsx`
- Create: `apps/admin/src/app/events/[eventId]/ticket-types/actions.ts`
- Create: `apps/admin/src/app/requests/page.tsx`
- Create: `apps/admin/src/app/requests/WaitlistQueue.tsx`
- Create: `apps/admin/src/app/requests/actions.ts`
- Replace: `apps/admin/src/app/page.tsx` (was U-E1 placeholder; now redirects to `/events`)
- Replace: `apps/admin/src/app/layout.tsx` — add admin nav

**Context:** Copy source from `apps/member/src/app/dashboard/organizations/[orgId]/**` and `apps/member/src/app/auth/**` into the admin app, dropping the `[orgId]` route segment and replacing every `params.orgId` read with `getHouseOrgId()`. Keep the auth routes parameterized via the admin's own `oidc` config (Phase E-2 already wired this).

**Steps:**

- [ ] **Auth routes:** copy `apps/member/src/app/auth/{callback,login,logout}/route.ts` to admin, swap `oh_member_` cookie prefix references for `oh_admin_`, swap the imported `oidc` for admin's `./lib/oidc`. Verify the cookie names line up with the middleware in U-E2.
- [ ] **Events list:** Copy `apps/member/src/app/dashboard/organizations/[orgId]/page.tsx` to `apps/admin/src/app/events/page.tsx`. Remove `params: { orgId }`; replace every `orgId` use with `const orgId = getHouseOrgId();` at the top of the server component. Update internal links: `/dashboard/organizations/${orgId}/events/${eventId}` → `/events/${eventId}` (no orgId segment).
- [ ] **Event create:** Copy `apps/member/src/app/dashboard/organizations/[orgId]/events/new/{page,actions}.tsx` to `apps/admin/src/app/events/new/`. Same orgId substitution. Add the `labelId` dropdown to the create form (the U-E5 unit can also handle this if you want to defer, but keeping it together with the route move is cleaner).
- [ ] **Event edit:** Copy `apps/member/src/app/dashboard/organizations/[orgId]/events/[eventId]/{page,EventEditor,actions}.tsx` to `apps/admin/src/app/events/[eventId]/`. Adjust routing references; substitute `orgId`.
- [ ] **Ticket types:** Copy `apps/member/src/app/dashboard/organizations/[orgId]/events/[eventId]/ticket-types/{page,TicketTypeEditor,actions}.tsx` to `apps/admin/src/app/events/[eventId]/ticket-types/`. Substitute `orgId`.
- [ ] **Requests:** Copy `apps/member/src/app/dashboard/organizations/[orgId]/requests/{page,WaitlistQueue,actions}.tsx` to `apps/admin/src/app/requests/`. Substitute `orgId`. The SSE query-token mint still requires an `orgId` argument — replace caller-side `params.orgId` with `getHouseOrgId()`.
- [ ] **Root layout:** Replace `apps/admin/src/app/layout.tsx` with the admin nav per spec §6:
  - Top bar links: Events → `/events`, Labels → `/labels` (U-E5 adds this page; the link will 404 until then; that's acceptable mid-phase), Waitlist → `/requests`.
  - User menu (right) — email + Sign out.
  - Subtle "Admin" wordmark or chip near the brand.
  - Server component; reads session via `readSession({ session: 'oh_admin_session', refresh: 'oh_admin_refresh' })`.
- [ ] **Root page:** Replace `apps/admin/src/app/page.tsx` with `redirect('/events')` (using `redirect` from `next/navigation`).
- [ ] Run gates: `pnpm -F admin build && pnpm -F admin typecheck && pnpm -F admin lint`. Iterate until clean. Common failures:
  - Missed an `orgId` reference — search `rg "orgId" apps/admin/src/`.
  - Import paths still pointing at `@/lib/api/*` from the source — replace with `@organizer-hub/web-shared`.
  - Tailwind classes referencing component files that didn't get copied.
- [ ] Manual smoke: sign in to admin → land on `/events` → click into an event → edit it → manage ticket types → view `/requests` → confirm the SSE waitlist loads. Phase 4 query-token SSE pattern carries verbatim.
- [ ] **Commit**:

  ```
  feat(admin): port organizer routes from member; flatten orgId out of URLs

  - Copy auth/callback, auth/login, auth/logout from member; swap to oh_admin_ cookies and admin oidc
  - Copy events list, create, edit, ticket-types CRUD, and waitlist SSE under /events and /requests (no /dashboard/organizations/[orgId] prefix)
  - Replace [orgId] param reads with getHouseOrgId()
  - Root layout wires admin nav (Events, Labels, Waitlist) and sign-out
  - / redirects to /events
  ```

---

#### U-E5 — Wire `/labels` admin CRUD page + `labelId` dropdown in event editor

**Files:**
- Create: `apps/admin/src/app/labels/page.tsx`
- Create: `apps/admin/src/app/labels/LabelEditor.tsx`
- Create: `apps/admin/src/app/labels/actions.ts`
- Modify: `apps/admin/src/app/events/new/page.tsx` — add label dropdown
- Modify: `apps/admin/src/app/events/[eventId]/EventEditor.tsx` — add label dropdown
- Modify: `apps/admin/src/app/events/new/actions.ts` and `[eventId]/actions.ts` — accept `labelId`
- Modify: `packages/web-shared/src/api/types.ts` — add `EventLabelView` type if not present

**Steps:**

- [ ] In `packages/web-shared/src/api/types.ts`, ensure there is a type for an event label:

  ```ts
  export type EventLabelView = {
    id: string;
    organizationId: string;
    name: string;
    slug: string;
    sortOrder: number;
  };
  ```
- [ ] Build `apps/admin/src/app/labels/page.tsx` — server component:
  - `const orgId = getHouseOrgId();`
  - `const labels = await apiFetch<EventLabelView[]>(`/api/event-labels?organizationId=${orgId}`);`
  - Render the list with create form at top, each row having Rename + Delete affordances (the `LabelEditor` client component handles inline edit; `actions.ts` handles server-side mutations).
  - Loading: server-component suspense or simple awaited fetch.
  - Empty state: "No labels yet. Create one above."
- [ ] Build `apps/admin/src/app/labels/actions.ts` — server actions: `createLabel({ name, slug, sortOrder? })`, `renameLabel(id, name)`, `reorderLabel(id, sortOrder)`, `deleteLabel(id)`. Each wraps `apiFetch` with try/catch, returns `{ error?, ok? }`. The delete action surfaces the 409 `eventCount` payload as a user-readable message: `"Cannot delete — N event(s) still reference this label."`
- [ ] Build `apps/admin/src/app/labels/LabelEditor.tsx` — client component for the inline rename and the create form. Uses `useTransition` (per repo lint rule mentioned in the Phase 4 plan).
- [ ] Update `apps/admin/src/app/events/new/page.tsx`:
  - Fetch labels: `const labels = await apiFetch<EventLabelView[]>(`/api/event-labels?organizationId=${getHouseOrgId()}`);`
  - Pass to the form; render a `<select name="labelId">` with the labels (plus an empty option for "No label").
  - Server action accepts the optional `labelId` and forwards to `POST /api/events`.
- [ ] Same change to `apps/admin/src/app/events/[eventId]/EventEditor.tsx` — preselect the current label.
- [ ] Run gates: `pnpm -F admin build && pnpm -F admin typecheck && pnpm -F admin lint`. Iterate until clean.
- [ ] Manual smoke:
  1. Visit `/labels` → see 3 seeded labels.
  2. Create a fresh label "Test" with slug "test" → appears in the list.
  3. Rename it to "Test 2" → updates.
  4. Try to create a duplicate slug "test" → see the 409 surface as an inline error.
  5. Create a new event with label "Test 2".
  6. Visit `/labels`, try to delete "Test 2" → see the 409 message with event count.
  7. Edit the event, change the label, save → reflected in DB.
- [ ] **Commit**:

  ```
  feat(admin): add /labels CRUD page and labelId dropdown in event editor

  - /labels lists, creates, renames, reorders, and deletes EventLabel rows for the house org
  - Inline 409 surface on duplicate slug and on delete-with-events (renders eventCount)
  - Event create and edit forms now expose a labelId dropdown populated by GET /api/event-labels
  - EventLabelView type lives in packages/web-shared/src/api/types.ts
  ```

---

#### U-E6 — Admin verification gate

**Steps:**

- [ ] `pnpm -F admin build && pnpm -F admin typecheck && pnpm -F admin lint`. All clean.
- [ ] `pnpm dev` (all four services). Visit:
  - `http://localhost:3000` (member) — still works; sign in with member browser profile.
  - `http://localhost:3003` (admin) — sign in with a user who is OWNER of the house org. Confirm both apps have **separate** sessions in the same browser (DevTools → Cookies — `oh_member_*` and `oh_admin_*` co-exist, no leakage).
  - Walk the full admin flow: events list → create event → edit event → manage ticket types → labels CRUD → waitlist SSE.
- [ ] Run api e2e regression: `pnpm -F api exec jest --config ./test/jest-e2e.json --runInBand`. Green.
- [ ] **No commit** (verification only).

**Phase E complete.** Admin runs standalone at port 3003 with its own OAuth client, its own session, and all organizer functionality. Member still works untouched; the organizer routes still exist vestigially in member's tree.

---

### Phase F — Member cleanup + label UI

Strip organizer routes from member, add the member dashboard home, add the label filter and label badge for the consumer events surfaces.

---

#### U-F1 — Strip organizer routes from member; new dashboard home

**Files:**
- Delete: `apps/member/src/app/dashboard/organizations/` (entire subtree)
- Delete: `apps/member/src/app/dashboard/page.tsx` (existing org list — replaced with the member home)
- Create: `apps/member/src/app/dashboard/page.tsx` (new member home)

**Context:** The existing `apps/member/src/app/dashboard/page.tsx` is the organizer org list, which now lives in admin. Replace it with a member-oriented home: membership status card, ticket-requests count card, browse-events CTA. Composes existing API endpoints — no new backend.

**Steps:**

- [ ] `git rm -r apps/member/src/app/dashboard/organizations/`.
- [ ] `git rm apps/member/src/app/dashboard/page.tsx`.
- [ ] Create `apps/member/src/app/dashboard/page.tsx`:

  ```tsx
  import Link from "next/link";
  import { apiFetch, readSession } from "@organizer-hub/web-shared";
  // import types for MembershipView and TicketRequestSummary from web-shared as appropriate

  export const dynamic = "force-dynamic";

  export default async function MemberDashboardPage() {
    const session = await readSession({ session: "oh_member_session", refresh: "oh_member_refresh" });
    // Membership card
    const membership = await apiFetch<MembershipView | null>("/api/me/membership").catch(() => null);
    // Requests summary
    const requests = await apiFetch<TicketRequestSummary>("/api/me/requests/summary").catch(() => ({ pending: 0, approved: 0, rejected: 0 }));

    return (
      <main className="p-8 max-w-4xl mx-auto space-y-6">
        <h1 className="text-2xl font-semibold">Welcome{session?.profile?.name ? `, ${session.profile.name}` : ""}</h1>
        <div className="grid sm:grid-cols-3 gap-4">
          <Card title="Membership">
            {membership ? `${membership.tier} — renews ${formatDateTime(membership.renewsAt)}` : "No active membership"}
            <Link href="/dashboard/membership" className="block mt-2 text-sm underline">Manage</Link>
          </Card>
          <Card title="My requests">
            <ul className="text-sm">
              <li>Pending: {requests.pending}</li>
              <li>Approved: {requests.approved}</li>
              <li>Rejected: {requests.rejected}</li>
            </ul>
            <Link href="/dashboard/requests" className="block mt-2 text-sm underline">View</Link>
          </Card>
          <Card title="Browse">
            <p className="text-sm">Discover upcoming events.</p>
            <Link href="/events" className="block mt-2 text-sm underline">All events</Link>
          </Card>
        </div>
      </main>
    );
  }

  function Card({ title, children }: { title: string; children: React.ReactNode }) {
    return <section className="border rounded p-4"><h2 className="font-medium">{title}</h2><div className="mt-2">{children}</div></section>;
  }
  ```

  If `/api/me/requests/summary` does not exist, either add it as a tiny api endpoint in this unit (count by status for the caller — small) OR replace with `/api/me/requests` and compute counts client-side. **Prefer adding the summary endpoint** — keeps the page server-rendered and minimal.

  *If you add the summary endpoint:* add a method to `TicketRequestsService` (likely under `apps/api/src/ticket-requests/`) returning `{ pending, approved, rejected }` for the caller; add an api e2e test covering it; include in this commit.
- [ ] Run gates: `pnpm -F member build && pnpm -F member typecheck && pnpm -F member lint`. Iterate.
- [ ] Manual smoke: sign into member → visit `/dashboard` → see the three cards with real data.
- [ ] **Commit**:

  ```
  feat(member): replace organizer dashboard with member home; remove organizer routes

  - Remove apps/member/src/app/dashboard/organizations/** (moved to apps/admin in Phase E)
  - Replace dashboard/page.tsx with three-card member home (membership, requests count, browse CTA)
  - (Optional: add GET /api/me/requests/summary for the requests count; e2e covered)
  ```

---

#### U-F2 — Member dashboard nav update

**Files:**
- Modify: `apps/member/src/app/dashboard/layout.tsx`

**Steps:**

- [ ] Read the existing `dashboard/layout.tsx`. Remove any nav links that pointed at organizer surfaces (e.g., "Organizations").
- [ ] Final nav per spec §6: Dashboard (home) → `/dashboard`, Browse Events → `/events`, Membership → `/dashboard/membership`, My Requests → `/dashboard/requests`. Plus the user menu with email and Sign out.
- [ ] Active link highlight uses `usePathname()` (client subcomponent ok; rest of layout is server).
- [ ] Run gates: `pnpm -F member build && pnpm -F member typecheck && pnpm -F member lint`.
- [ ] Manual smoke: nav reflects the four links, each routes correctly.
- [ ] **Commit**:

  ```
  refactor(member): trim dashboard nav to member-only surfaces

  - Remove Organizations link; keep Dashboard, Browse Events, Membership, My Requests
  - Active state highlights via usePathname()
  ```

---

#### U-F3 — Add label filter to member `/events`; add label badge to event detail

**Files:**
- Modify: `apps/member/src/app/events/page.tsx`
- Modify: `apps/member/src/app/events/[eventId]/page.tsx`
- (No new API endpoints — uses public events list with `?labelId` and `GET /api/event-labels`)

**Steps:**

- [ ] `apps/member/src/app/events/page.tsx`:
  - Read `?labelId` from `searchParams`.
  - Fetch labels: `await publicApiFetch<EventLabelView[]>("/api/event-labels?organizationId=" + HOUSE_ORG_ID)` — wait: the member-side fetch should not depend on `getHouseOrgId()` (member is multi-org-aware in principle; in practice today the only org IS the house org). For the v1 implementation, use `getHouseOrgId()` from web-shared (it's a server-only helper); the page is a server component, so it has access. If at some future point member sees multiple orgs, the filter UI becomes a per-org chip strip; not this phase.
  - Render a filter chip row: "All" + one chip per label. Active state from `searchParams.labelId`.
  - Each chip is a `<Link>` to `/events` or `/events?labelId=<id>`.
  - Pass `searchParams.labelId` to the events list fetch: `await publicApiFetch<EventView[]>(`/api/orgs/${HOUSE_ORG_ID}/events${labelId ? `?labelId=${labelId}` : ''}`);` (verify the exact public events URL — `apps/api/src/public/`).
- [ ] `apps/member/src/app/events/[eventId]/page.tsx`:
  - If `event.label` (returned by the api via the labelId join), render a small badge near the title: `<span className="inline-block text-xs border rounded px-2 py-0.5">{event.label.name}</span>`.
  - Ensure the public event response includes the label join. Check `apps/api/src/public/`; if needed, extend the select/include to pull `label: { select: { id, name, slug } }`.
- [ ] Run gates: `pnpm -F member build && pnpm -F member typecheck && pnpm -F member lint`.
- [ ] Manual smoke:
  1. Visit `/events` → see the 3 seeded labels as chips + "All".
  2. Click "Concerts" → URL becomes `/events?labelId=<id>`; list filters.
  3. Click "All" → URL clears; list shows all.
  4. Click into an event with a label → badge visible near title.
  5. Click into an unlabeled event → no badge.
- [ ] **Commit**:

  ```
  feat(member): label filter on /events; label badge on event detail

  - Filter chip strip on /events pulls labels via GET /api/event-labels and applies ?labelId
  - Event detail renders a small badge when the event has a label
  - Public event endpoint extended to include label { id, name, slug } in the response when present
  ```

---

#### U-F4 — README update + final two-app verification

**Files:**
- Modify: `README.md`
- Create: `docs/admin-member-split-smoke.md` (manual click-through, mirrors Phase 4's smoke doc shape)

**Steps:**

- [ ] Update `README.md`:
  - Replace any `apps/web` references with `apps/member`.
  - Add `apps/admin` to the apps list with its port (3003).
  - Add `pnpm setup:env` to "Getting started".
  - Add a "First run" note: after `pnpm setup:env`, run `pnpm -F api seed` to materialize the house org; paste the printed `HOUSE_ORG_ID` into `apps/admin/.env.local`. Then `pnpm dev`.
  - Note that each app has its own OAuth client; first sign-in to each is independent.
- [ ] Create `docs/admin-member-split-smoke.md` with:
  - Member flow (port 3000): sign in → dashboard home shows 3 cards → browse events (filter by label) → buy a ticket → cancel → sign out.
  - Admin flow (port 3003): sign in (separate browser profile or private window) → events list → create event with label → edit event → manage ticket types → labels CRUD (create, rename, delete-blocked when in-use) → waitlist SSE queue.
  - Cross-app: confirm cookies in DevTools are disjoint (`oh_member_*` vs `oh_admin_*`).
  - Phase 4 regression: capacity + waitlist flow still works end-to-end through the two apps.
- [ ] Walk the entire smoke checklist; record results inline.
- [ ] Run all gates one final time:
  - `pnpm -F member build && pnpm -F member typecheck && pnpm -F member lint`
  - `pnpm -F admin build && pnpm -F admin typecheck && pnpm -F admin lint`
  - `pnpm -F api exec jest --config ./test/jest-e2e.json --runInBand`
- [ ] **Commit**:

  ```
  docs: wrap up admin/member split with README and smoke checklist

  - README documents the new apps/member and apps/admin layout, ports, OAuth clients, and pnpm setup:env bootstrap
  - Add docs/admin-member-split-smoke.md with member, admin, and cross-app manual click-through
  - Phase 4 capacity + waitlist regression covered in the smoke checklist
  ```

**Phase F complete.** `apps/web` is gone. `apps/member` and `apps/admin` run side-by-side with disjoint sessions, shared via `packages/web-shared`, configured via per-app `.env.local`, talking to a single api that now supports `EventLabel`.

---

## Self-Review Notes

Findings from a fresh read of this plan against the spec:

- **Spec coverage:** Every section of the origin spec maps to one or more Units. §1 → Phase A. §2 → Phase A + Phase D + Phase F. §3 → Phase C + Phase E. §4 → Phases A (cookie prefix) + D (rename client) + E (admin client). §5 → Phase B. §6 → Phase E-4 (admin nav) + Phase F-2 (member nav).
- **Placeholders:** No `TBD` / `TODO` / "implement later" in the body. Two Units (U-F1 endpoint addition, U-E5 dropdown placement choice) flag minor optionality with the rationale spelled out — these are real decisions documented in-place, not deferrals.
- **Type consistency:** `EventLabelView` is defined in U-E5 (added to `packages/web-shared/src/api/types.ts`) and referenced in U-F3 (member label fetch). `getHouseOrgId()` is created in U-E2 (`packages/web-shared/src/house-org.ts`) and used in U-E4, U-E5, U-F3. `oidc` shape from `apps/<app>/src/lib/oidc.ts` is `{ config, endpoints }` everywhere it is consumed.
- **Operational gates:** Every behavior-changing Unit ends with a Gate step (build + typecheck + lint + e2e where applicable + manual smoke as relevant). Migration runs explicitly use `migrate deploy`.
- **Commit cadence:** One commit per Unit; the U-D1 + U-D2 grouping is explicitly noted.
- **Risk of skipped step:** the cookie-name change in U-A5 invalidates dev sessions one-time. Flagged in both U-A5 and U-D3. Engineers re-running smoke should expect to re-sign-in.

## Sources & References

- **Origin spec:** `docs/specs/2026-05-31-admin-member-split-design.md`
- **Prior plans worth skimming for repo conventions:** `docs/plans/2026-05-29-001-feat-phase-4-capacity-waitlist-plan.md`, `docs/plans/2026-05-21-001-feat-phase-3-stripe-billing-plan.md`
- **Solutions to honor without changes:**
  - `docs/solutions/architecture-patterns/query-token-sse-auth-pattern.md` — SSE query-token auth pattern; the waitlist routes port verbatim.
  - `docs/solutions/design-patterns/cas-partial-unique-concurrency-model.md` — concurrency model for the request lifecycle; untouched by this split.
  - `docs/solutions/design-patterns/commit-then-send-mailer-seam.md` — mailer seam; untouched.
  - `docs/solutions/architecture-patterns/webhook-reconciliation-guard.md` — webhook handler; untouched.
- **First-time spec for the same area:** `docs/specs/2026-05-20-token-refresh-middleware-design.md` — token refresh middleware design (Phase 1 of the OIDC work); the middleware moved into `packages/web-shared` in Phase A of this plan.
