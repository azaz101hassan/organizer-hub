# Admin / Member App Split — Design

**Date:** 2026-05-31
**Status:** Approved for implementation
**Related:** `docs/solutions/architecture-patterns/query-token-sse-auth-pattern.md`, `docs/solutions/design-patterns/cas-partial-unique-concurrency-model.md`, `docs/solutions/design-patterns/commit-then-send-mailer-seam.md`, `docs/solutions/architecture-patterns/webhook-reconciliation-guard.md`

## Problem

`apps/web` mixes two audiences in one Next.js app: the organizer (admin) surface — org list, event editor, ticket-type CRUD, waitlist queue — and the member (consumer) surface — event browsing, ticket purchase, membership, request tracking. The two audiences have different navigation, different auth posture, different deploy targets, and different visual languages. Keeping them in one app forces shared layouts, shared bundles, and shared OAuth sessions that don't serve either user well.

## Goal

Split `apps/web` into two independent Next.js apps — `apps/member` (consumer) and `apps/admin` (organizer) — sharing extracted utilities through a new `packages/web-shared` workspace package. Each app gets its own OAuth client, its own port, its own cookies. The admin app is single-tenant: it binds to one "house" organization via env var and never exposes the multi-org concept in its UI.

Add one new feature alongside the split: `EventLabel` — a curated, admin-managed categorization label, one per event, surfaced as a filter on the member events list.

## Non-goals

- **Visual redesign.** Colors, spacing, typography, and component visual language are out of scope. The split is structured to accommodate redesign work that happens concurrently in this repo on a separate track. Only navigation structure (which routes exist, what they are called) is fixed here.
- **Multi-label per event.** Single label is locked in. Multi-label can be a follow-up if needed.
- **Cross-app SSO.** Member and admin maintain separate sessions by design. A user with both roles signs in twice. Subdomain cookie scoping for prod is a future spec.
- **Unwinding the `Organization` data model.** The DB stays multi-org-capable (it is the FK target for events, memberships, Stripe accounts, and webhook reconciliation). Admin just binds to one org in its UI.
- **Admin landing/marketing for logged-out users.** Admin root is auth-gated; logged-out users get bounced to the OAuth login flow.
- **New member features beyond a dashboard home and label filter/badge** (no favorites, sharing, etc.).

## Architecture overview

```
apps/
├── api/             (NestJS, port 3001) — unchanged transport, EventLabel module added
├── accounts/        (NestJS, port 3002) — unchanged code; seed script gains two clients
├── member/          (Next.js 16, port 3000) — was apps/web; consumer surface
└── admin/           (Next.js 16, port 3003) — new; organizer surface, single-tenant

packages/
├── config/          (unchanged)
├── db/              (unchanged)
├── types/           (unchanged)
└── web-shared/      (new) — API client, OIDC helpers, session reader, middleware factory, formatters
```

Each web app:

- Declares `@organizer-hub/web-shared` as a workspace dependency.
- Has its own OAuth client registered in `accounts` (`organizer-member`, `organizer-admin`).
- Has its own `OAUTH_CLIENT_ID`, redirect URI, and post-logout redirect URI.
- Uses its own cookie prefix (`oh_member_*`, `oh_admin_*`) so cookies do not leak across ports.
- Has its own `apps/<app>/.env.local` (`.env.example` checked in), per the env layout below.

## 1. `packages/web-shared`

Layout:

```
packages/web-shared/
├── package.json              # name: "@organizer-hub/web-shared", private, type: module
├── tsconfig.json             # extends packages/config/tsconfig.base.json
├── src/
│   ├── index.ts              # barrel re-exports
│   ├── api/
│   │   ├── client.ts         # apiFetch, publicApiFetch, UnauthorizedError, ApiError
│   │   ├── session.ts        # readSession (server-only, reads cookies via cookiePrefix)
│   │   └── types.ts          # DTOs currently under apps/web/src/lib/api/types.ts
│   ├── oidc/
│   │   ├── config.ts         # buildOidcConfig({ defaults }) — returns oidcConfig + oidcEndpoints
│   │   ├── pkce.ts
│   │   └── refresh.ts
│   ├── format.ts             # formatDateTime, formatTimeUntil
│   └── middleware.ts         # createAuthRefreshMiddleware({ cookiePrefix, oidc })
```

Two non-obvious points:

1. **OIDC config is a builder, not a constant.** Current `config.ts` reads `OAUTH_CLIENT_ID` with default `"organizer-web"`. The shared package exports `buildOidcConfig({ defaultClientId, defaultRedirectUri, defaultPostLogoutRedirectUri })`. Each app calls it with its own defaults; env vars still win, preserving today's override behavior.
2. **Middleware is a factory, not a file-convention export.** Next.js requires `middleware.ts` at the app root. The shared package exports `createAuthRefreshMiddleware({ cookiePrefix, oidc })` returning the handler and matcher config. Each app keeps a thin `apps/<app>/src/middleware.ts` that calls the factory and re-exports.

Consumers import from the single entry `"@organizer-hub/web-shared"` (no deep imports — keeps internal refactors safe).

## 2. `apps/member` (port 3000)

Result of renaming `apps/web` → `apps/member` and stripping organizer routes. Same Next.js 16 + Turbopack + Tailwind stack.

### Routes

```
apps/member/src/app/
├── layout.tsx                            # root layout, globals.css
├── globals.css
├── favicon.ico
├── page.tsx                              # landing
├── auth/{callback,login,logout}/route.ts # parameterized via env → member's client_id
├── events/
│   ├── page.tsx                          # browse, label filter chips/dropdown
│   └── [eventId]/
│       ├── page.tsx                      # event detail, label badge
│       ├── TicketRow.tsx
│       └── actions.ts                    # buy / claim / request
├── membership/
│   ├── page.tsx                          # pricing
│   ├── actions.ts                        # Stripe checkout
│   ├── success/page.tsx
│   └── cancel/page.tsx
├── dashboard/
│   ├── layout.tsx                        # member nav (see §6)
│   ├── page.tsx                          # NEW — member dashboard home
│   ├── membership/
│   │   ├── page.tsx
│   │   ├── actions.ts
│   │   └── CancelButton.tsx
│   └── requests/
│       ├── page.tsx
│       ├── [requestId]/page.tsx
│       ├── actions.ts
│       ├── CancelRequestButton.tsx
│       ├── RequestList.tsx
│       └── RequestStatusBadge.tsx
└── middleware.ts                         # thin shim → createAuthRefreshMiddleware({ cookiePrefix: "oh_member_", oidc })
```

### Removed from member

The entire `dashboard/organizations/**` subtree — all admin work.

### New: `dashboard/page.tsx` (member dashboard home)

A read-only summary composed from existing API endpoints (`/api/me/membership`, `/api/me/requests`). Three cards:

- **Membership status** — tier, renewal date, link to `/dashboard/membership`.
- **My ticket requests** — count by status (Pending / Approved / Rejected), link to `/dashboard/requests`.
- **Browse events** CTA — link to `/events`.

No new backend endpoints.

### Package wiring

```jsonc
// apps/member/package.json
{
  "name": "@organizer-hub/member",
  "scripts": { "dev": "next dev -p 3000 --turbopack", ... },
  "dependencies": { "@organizer-hub/web-shared": "workspace:*", ... }
}
```

Imports change from `"@/lib/api/client"` → `"@organizer-hub/web-shared"`. The `@/*` path alias stays for app-local imports.

## 3. `apps/admin` (port 3003)

Fresh Next.js 16 app, same stack as member. Single-tenant: binds to one organization via `HOUSE_ORG_ID`, no org concept in UI.

### `EventLabel` (new data model + API)

```prisma
model EventLabel {
  id             String   @id @default(cuid())
  organizationId String
  name           String
  slug           String
  sortOrder      Int      @default(0)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  events         Event[]
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  @@unique([organizationId, slug])
}

model Event {
  // existing fields…
  labelId String?
  label   EventLabel? @relation(fields: [labelId], references: [id], onDelete: SetNull)
}
```

Migration: hand-written SQL + `pnpm prisma migrate deploy`. Never `migrate dev` (the codebase already has a partial unique index that `migrate dev` would clobber).

API endpoints in `apps/api` (org-scoped via existing membership guards; admin always passes `HOUSE_ORG_ID`):

- `GET    /api/event-labels` — list (also called by member side for filter UI).
- `POST   /api/event-labels` — create.
- `PATCH  /api/event-labels/:id` — rename, reorder.
- `DELETE /api/event-labels/:id` — **block with 409 + count if any event references it**; client decides how to surface the conflict.

Event create/update DTOs gain optional `labelId`, validated to belong to the same org. `GET /api/events` (and the public org-scoped list) gains `?labelId=` filter.

Seed: house org gets three default labels (`Concerts`, `Workshops`, `Community`) so admin has something to show on first run.

### Admin route shape

```
apps/admin/src/app/
├── layout.tsx                            # root layout owns the admin nav (see §6)
├── globals.css
├── favicon.ico
├── page.tsx                              # redirect to /events (or render events list directly)
├── auth/{callback,login,logout}/route.ts # parameterized → admin's client_id
├── events/
│   ├── page.tsx                          # events list, filter by label
│   ├── new/
│   │   ├── page.tsx                      # create event (label dropdown)
│   │   └── actions.ts
│   └── [eventId]/
│       ├── page.tsx                      # edit event (label dropdown)
│       ├── EventEditor.tsx
│       ├── actions.ts
│       └── ticket-types/
│           ├── page.tsx
│           ├── TicketTypeEditor.tsx
│           └── actions.ts
├── labels/
│   ├── page.tsx                          # CRUD list, drag-reorder
│   ├── LabelEditor.tsx
│   └── actions.ts
├── requests/
│   ├── page.tsx                          # SSE waitlist queue (single org, no orgId segment)
│   ├── WaitlistQueue.tsx
│   └── actions.ts
└── middleware.ts                         # thin shim → createAuthRefreshMiddleware({ cookiePrefix: "oh_admin_", oidc })
```

### Single-org binding

Shared helper in `packages/web-shared` (server-only):

```ts
export function getHouseOrgId(): string {
  const id = process.env.HOUSE_ORG_ID;
  if (!id) throw new Error("HOUSE_ORG_ID is not set");
  return id;
}
```

Admin server actions and route handlers call `getHouseOrgId()` and pass it to API calls. The API stays org-aware (no schema change there); admin always passes the house ID.

### Notable: SSE waitlist queue ports unchanged

`WaitlistQueue.tsx` and the query-token SSE auth pattern (see `docs/solutions/architecture-patterns/query-token-sse-auth-pattern.md`) port verbatim — only imports change.

## 4. Auth + second OAuth client

Each app has its own OIDC client in `accounts`. No cross-app session sharing.

### Clients seeded by `apps/accounts/scripts/seed.ts`

Two `upsert`s by `clientId` (idempotent), plus a one-line delete of the old client:

```ts
const MEMBER = {
  clientId: 'organizer-member',
  name: 'OrganizerHub Member',
  redirectUris: ['http://localhost:3000/auth/callback'],
  postLogoutRedirectUris: ['http://localhost:3000/'],
  isPublic: true, pkceRequired: true,
  scopes: ['openid', 'profile', 'email', 'offline_access'],
  grantTypes: ['authorization_code', 'refresh_token'],
  responseTypes: ['code'],
};

const ADMIN = {
  clientId: 'organizer-admin',
  name: 'OrganizerHub Admin',
  redirectUris: ['http://localhost:3003/auth/callback'],
  postLogoutRedirectUris: ['http://localhost:3003/'],
  isPublic: true, pkceRequired: true,
  scopes: ['openid', 'profile', 'email', 'offline_access'],
  grantTypes: ['authorization_code', 'refresh_token'],
  responseTypes: ['code'],
};

await prisma.oAuthClient.deleteMany({ where: { clientId: 'organizer-web' } });
```

The existing client `organizer-web` is removed in the same seed pass. There is no live production for this app, so no session migration is needed. If a prod environment exists at the time of the migration, swap `clientId` on any `Grant`/`Session` rows from `organizer-web` to `organizer-member` before delete.

### Per-app OIDC config

`apps/member/src/lib/oidc.ts`:

```ts
import { buildOidcConfig } from "@organizer-hub/web-shared";
export const oidc = buildOidcConfig({
  defaultClientId: "organizer-member",
  defaultRedirectUri: "http://localhost:3000/auth/callback",
  defaultPostLogoutRedirectUri: "http://localhost:3000/",
});
```

`apps/admin/src/lib/oidc.ts` is the same shape with `organizer-admin` and port 3003 defaults.

`OAUTH_CLIENT_ID`, `OAUTH_REDIRECT_URI`, `OAUTH_POST_LOGOUT_REDIRECT_URI` env vars still win when set.

### Cookie scoping

Modern browsers ignore port for cookie scope: a cookie set by `localhost:3000` is visible to `localhost:3003`. To prevent member's session cookie from being read or rotated by admin's middleware:

- Member uses prefix `oh_member_` → `oh_member_session` (id_token), `oh_member_refresh` (refresh_token), `oh_member_pkce` (PKCE verifier, transient), `oh_member_state` (OAuth `state` param, transient).
- Admin uses prefix `oh_admin_` → same four cookies under the admin prefix.

The shared `readSession`, callback handler, and refresh middleware factory take a `cookiePrefix` parameter. Each app's thin `oidc.ts` (above) sets its prefix once.

In prod the two apps run on separate subdomains, which gives domain-level cookie isolation; the prefix scheme stays as defense-in-depth.

### Accounts service code

No changes. The OIDC provider in `apps/accounts/src/oidc/oidc.service.ts` already loads clients dynamically from the `OAuthClient` table — the seed change is the only edit needed.

## 5. Per-app `.env.local` layout + `setup:env` script

### Root `.env` keeps only shared infra

```
DATABASE_URL=...
ACCOUNTS_DATABASE_URL=...
REDIS_URL=...
```

Anything that root-level Prisma scripts or workspace-wide tooling touches.

### Per-app `.env.local` files (checked-in `.env.example` siblings)

- `apps/api/.env.local` — `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `JWKS_URL`, mailer creds, etc.
- `apps/accounts/.env.local` — JWT signing keys, OIDC issuer URL.
- `apps/member/.env.local` — `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_ACCOUNTS_URL`, optional `OAUTH_*` overrides (usually empty in dev; in-code defaults win).
- `apps/admin/.env.local` — same as member plus `HOUSE_ORG_ID`.

### Loading

- Next.js auto-loads `apps/<app>/.env.local` from the app directory.
- Nest apps point `ConfigModule.forRoot({ envFilePath: 'apps/<app>/.env.local', ... })` at the local file (was a path to the monorepo root).

### `scripts/setup-env.mjs`

For each `.env.example` found under `apps/*` and the root, copy → sibling `.env.local` if (and only if) the local file does not already exist. Never overwrite. Runs via `pnpm setup:env` at the root.

`README.md` documents the layout and the `pnpm setup:env` step. A onboarding section near "Getting started" calls it out.

## 6. Dashboard chrome (nav structure)

### Member (`apps/member/src/app/dashboard/layout.tsx`)

Top bar:

- Logo / brand → `/` (landing).
- Browse Events → `/events`.
- Membership → `/dashboard/membership`.
- My Requests → `/dashboard/requests`.
- Dashboard (home) → `/dashboard`.
- User menu (right) → email + Sign out → `/auth/logout`.

Active link highlighting follows current pathname.

### Admin (`apps/admin/src/app/layout.tsx`)

Admin root is the dashboard; chrome lives in the root layout (no separate `dashboard/layout.tsx`). Top bar:

- Logo / brand → `/` (events list).
- Events → `/events`.
- Labels → `/labels`.
- Waitlist → `/requests`.
- User menu (right) → email + Sign out → `/auth/logout`.

A subtle "Admin" wordmark or chip near the brand makes it obvious which app a logged-in user is in.

### Logged-out state

- **Member**: `/` is public (existing landing page content moves as-is). `/events` and `/events/[eventId]` are also public (read-only; already use `publicApiFetch`).
- **Admin**: `/` is gated. Middleware redirects unauthenticated users to `/auth/login` → accounts. No public surface.

### Shared bits

- Both top bars are server components that read the session via `readSession()` from `@organizer-hub/web-shared`.
- Both apps copy `globals.css` independently (drift is acceptable; redesign work may push them apart).
- Each app owns its own `tailwind.config.ts`. They start identical.

## Migration phases

Six phases. Each ends at a green state and is independently shippable.

### Phase A — Extract `packages/web-shared`

- Create the package per §1. Move `apps/web/src/lib/*` and `apps/web/src/middleware.ts` over.
- Convert `oidc/config.ts` → `buildOidcConfig` builder; convert `middleware.ts` → `createAuthRefreshMiddleware()` factory; thread `cookiePrefix` through `readSession` / callback / refresh helpers.
- Update `apps/web` to consume the shared package. Leave a thin `apps/web/src/middleware.ts` shim that calls the factory with prefix `oh_member_` (forward-compatible with the rename in Phase D).
- **Gate:** `pnpm -F web build && pnpm -F web lint && pnpm -F web typecheck && pnpm -F api exec jest --config ./test/jest-e2e.json --runInBand`. Manual smoke: login → browse events → buy ticket → cancel → logout on port 3000 with no behavioral change. The cookie-prefix change invalidates any existing dev session (a one-time effect of introducing the prefix scheme); re-login works.

### Phase B — Per-app `.env.local` split + `setup:env` script

- Root `.env` keeps only shared infra (`DATABASE_URL`, `ACCOUNTS_DATABASE_URL`, `REDIS_URL`).
- Create `apps/api/.env.local`, `apps/accounts/.env.local`, `apps/web/.env.local` (renamed in Phase D), each with a sibling `.env.example`.
- Point each Nest app's `ConfigModule.forRoot({ envFilePath: '…' })` at its local file.
- Add `scripts/setup-env.mjs` + `pnpm setup:env` at the root.
- Update setup docs (`docs/phase-4-setup.md` renamed to `docs/setup.md` since it is no longer Phase-4-specific) with the new layout.
- **Gate:** fresh-clone simulation (`rm apps/*/.env.local && pnpm setup:env`, fill in secrets, `pnpm dev`). All four services start and reach steady state.

### Phase C — `EventLabel` backend (DB + API)

- Hand-write SQL migration: `EventLabel` table + `Event.labelId` nullable FK + `@@unique([organizationId, slug])`. `pnpm prisma migrate deploy`, never `migrate dev`.
- New `EventLabelsModule` in `apps/api`: list, create, rename/reorder, delete (delete blocked with 409 + count if any event references the label).
- Extend `Event` create/update DTOs with optional `labelId`; validate it belongs to the same org.
- Extend `GET /api/events` (and the public org-scoped variant) with `?labelId=` filter.
- e2e tests: CRUD, filter, delete-blocked path.
- Seed: house org gets `Concerts`, `Workshops`, `Community` defaults.
- **Gate:** `pnpm -F api exec jest --config ./test/jest-e2e.json --runInBand` green; migration applied and reflected in `schema.prisma`.

### Phase D — Rename `apps/web` → `apps/member` (rename only)

- `git mv apps/web apps/member`. Update `apps/member/package.json` name to `@organizer-hub/member`. Dev script stays `next dev -p 3000`.
- Update Turborepo config and any cross-app references; verify `pnpm-workspace.yaml` globs catch the new path.
- Update `apps/accounts/scripts/seed.ts`: rename existing client `organizer-web` → `organizer-member` (admin client lands in Phase E).
- No route changes, no new features, no middleware changes (cookie prefix was already set in Phase A). Pure rename.
- **Gate:** same as Phase A. App runs on port 3000 unchanged.

### Phase E — Scaffold `apps/admin` (port 3003)

- New Next.js 16 app with the same baseline as member: Tailwind, Turbopack, App Router. Depends on `@organizer-hub/web-shared`.
- `apps/admin/src/middleware.ts` uses cookie prefix `oh_admin_`.
- **Copy** (not move) organizer routes from `apps/member/src/app/dashboard/organizations/**` and `apps/member/src/app/dashboard/page.tsx` to `apps/admin/src/app/`, flattening to the route shape in §3 (no `[orgId]` segments).
- Wire admin server actions to use `getHouseOrgId()`; strip `[orgId]` from URLs.
- Add `/labels` page wired to the Phase C API.
- Add `labelId` dropdown to event editor and create form.
- Update `apps/accounts/scripts/seed.ts`: add `organizer-admin` client; keep `organizer-member`; delete `organizer-web`.
- Extend `apps/api`'s existing seed script to upsert the house `Organization` row with a deterministic `id` (so the value can be checked into `apps/admin/.env.example` as the default). The seed prints the id on stdout for first-time setup.
- Document `HOUSE_ORG_ID` in `apps/admin/.env.example` with the seeded id as the default value.
- Add `apps/admin/.env.local` per Phase B's pattern.
- Add `apps/admin` to root `pnpm dev` Turborepo pipeline.
- **Gate:** admin builds, lints, typechecks. Manual smoke: login → see events list → CRUD a label → create an event with a label → edit an event → view the waitlist SSE queue. Member app still works on port 3000 (organizer routes still vestigially present but unlinked in nav).

### Phase F — Clean up member + add label UI to member

- Strip organizer routes from member: delete `apps/member/src/app/dashboard/organizations/**`, replace `apps/member/src/app/dashboard/page.tsx` with the member home (§2: membership card, requests card, browse-events CTA).
- Update `apps/member/src/app/dashboard/layout.tsx` nav: links to `/dashboard`, `/dashboard/membership`, `/dashboard/requests` only.
- Add label filter chips/dropdown to `apps/member/src/app/events/page.tsx` (calls `GET /api/event-labels`).
- Add label badge to `apps/member/src/app/events/[eventId]/page.tsx`.
- Update `README.md` with the new app layout, dev ports, and `pnpm setup:env`.
- **Gate:** both apps green end-to-end. Run the capacity + waitlist smoke flow through member; run the organizer-side waitlist queue through admin; verify nothing regressed.

### Order rationale

A is foundational (shared package unlocks both apps). B is independent infra but lands early so the rest builds on per-app envs. C is backend-only — can land any time after B but must precede E (admin's `/labels` page needs the API). D is a tightly-scoped rename, kept separate from feature work so any rename breakage is easy to bisect. E adds the admin app fully but leaves member untouched. F finalizes member and adds the consumer-facing label UI.

## Gotchas to carry forward

- **e2e tests** share a Postgres instance; always run with `--runInBand`: `pnpm -F api exec jest --config ./test/jest-e2e.json --runInBand`.
- **Migrations:** hand-write SQL + `pnpm prisma migrate deploy`. Never `migrate dev` (a partial unique index in the existing schema does not round-trip through `migrate dev`).
- **No prettier in the web apps** — lint is eslint only: `pnpm -F member lint && pnpm -F member typecheck && pnpm -F member build` (same for admin).
- **Turbopack stale cache:** after branch switches that change app layout, `rm -rf apps/<app>/.next` if Turbopack crash-loops with "Next.js package not found".

## Open questions deferred to follow-up specs

- Subdomain layout for prod (`admin.example.com` / `app.example.com`), cookie domain scoping, and reverse-proxy / CDN configuration.
- Admin analytics, audit log, bulk operations.
- Whether to surface `EventLabel` color/icon and per-label visibility rules.
- Multi-label per event (intentionally deferred).
