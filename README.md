# OrganizerHub

Unified dashboard for event organizers — attacking the fragmented US ticketing stack with one pane of glass for sales, attendees, communications, and check-in.

## Stack

- **Monorepo:** Turborepo + pnpm workspaces
- **Frontend:** Next.js (App Router, TypeScript)
- **Backend:** NestJS (TypeScript)
- **Database:** PostgreSQL + Prisma
- **Auth:** OAuth2/OIDC — custom Identity Provider (`apps/accounts`) using `node-oidc-provider`
- **Payments:** Stripe Checkout (one-time tickets) + Stripe Subscriptions (memberships)

## Apps

| App | Port | Purpose |
|---|---|---|
| `apps/web` | 3000 | Next.js — organizer dashboard + public event pages (OAuth client) |
| `apps/api` | 3001 | NestJS — events, tickets, memberships, Stripe webhooks |
| `apps/accounts` | 3002 | NestJS — OAuth2/OIDC Identity Provider |

## Packages

| Package | Purpose |
|---|---|
| `packages/db` | Prisma schemas + clients (separate per bounded context) |
| `packages/types` | Shared DTOs and types |
| `packages/ui` | Shared React components |
| `packages/config` | ESLint, TSConfig, Prettier presets |

## Prerequisites

- Node 24+ (via `nvm install --lts`)
- pnpm (via `corepack enable`)
- PostgreSQL 16+ running locally (`brew install postgresql@16 && brew services start postgresql@16`)

## Getting started

```bash
pnpm install
cp .env.example .env
pnpm dev
```

## Phases

- **Phase 0** — Monorepo scaffold + tooling ✅
- **Phase 1** — Accounts service (OIDC IdP) with signup/login ✅
- **Phase 2** — Organizer onboarding + event CRUD (OAuth client) ✅
- **Phase 3** — Stripe Checkout for one-time tickets (planned)
- **Phase 4** — Stripe Subscriptions for memberships + coverage logic (planned)

## What Phase 2 ships

- `apps/api` as an OIDC resource server validating bearer tokens via JWKS
  (`aud=organizer-api`), with first-class organizations and events domains.
- Authenticated REST: `POST/GET/GET-by-id /organizations` and a nested
  `POST/GET/GET-by-id/PATCH /organizations/:orgId/events`. RBAC at the
  controller layer with `JwtAuthGuard` + `RolesGuard`. Members can read,
  owners and admins can mutate, non-members get 404 (no existence leak).
- Event lifecycle: `DRAFT → PUBLISHED → CANCELLED`. Publish stamps
  `publishedAt`; cancelled is terminal. Slugs auto-derived from titles
  and made unique within an org via collision retry.
- Public read API for anonymous browsing under `/public/events*` with
  cursor pagination over `(startsAt, id)`. Drafts, cancelled, and past
  events are never exposed.
- `apps/web` dashboard at `/dashboard` for organizers: org list, create
  org, per-org events list, create event, edit event, publish, cancel.
  Server-only `apiFetch` wrapper injects the access token from cookies;
  401 → redirect to `/auth/login`.
- Public pages at `/events` (list) and `/events/[id]` (detail) with
  cursor-based "Next page" navigation and a placeholder ticketing CTA.

## Local boot recipe

```bash
pnpm install
cp .env.example .env
pnpm --filter @organizer-hub/db migrate:accounts:dev
pnpm --filter @organizer-hub/db migrate:api:dev
pnpm dev
```

Then open `http://localhost:3000` and follow `docs/phase-2-browser-smoke.md`
to drive an end-to-end check.

## Phase 3 hardening notes (carried over from Phase 2)

- Refresh-token rotation on the web side. Today a 401 from the api kicks
  the user back to `/auth/login`; the refresh token is stored but unused.
- Member invitations and removal from the dashboard. The Membership
  schema and `RolesGuard` already support OWNER/ADMIN/MEMBER; only the
  creator gets a membership today.
- Image uploads, search, email notifications, RP-initiated logout
  parity. All explicitly out of Phase 2 scope.
