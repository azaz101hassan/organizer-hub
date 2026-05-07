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
- **Phase 3** — Stripe billing: tiered memberships + tiered tickets + per-event coverage ✅
- **Phase 4** — Refunds, payouts, capacity, multi-currency (planned)

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

## What Phase 3 ships

- Stripe billing layered onto the existing stack as a thin **mirror
  ledger**: Stripe owns Customer, Product, Price, Subscription,
  PaymentIntent, Invoice; OrganizerHub stores only the references plus
  the read-side caches the dashboard and event detail need.
- Platform-defined tiered memberships (`Bronze / Silver / Gold` ×
  `monthly / yearly` = six SKUs). Public `/membership` pricing page,
  Stripe Checkout subscription flow, `/dashboard/membership` status page
  with cancel-at-period-end.
- Webhook controller (`POST /webhooks/stripe`) with raw-body signature
  verification, `WebhookEvent` dedupe table, and the Theo Browne
  `syncStripeData(customerId)` pattern — every relevant event reduces
  to one re-fetch + upsert, making event ordering irrelevant.
- Per-event tiered ticket types — organizer dashboard CRUD under
  `/dashboard/organizations/:orgId/events/:eventId/ticket-types`, with
  Stripe Product + Price mirroring (immutable Price → archive + recreate
  on edit) and a `members_excluded` toggle on the event.
- Paid ticket purchase end-to-end (`POST /billing/checkout/ticket` →
  Stripe Checkout in payment mode → webhook issues a `Ticket` row).
- Free member-claim flow (`POST /tickets/claim`) gated by the coverage
  rule: active membership + tier ≥ `minTierLevel` + event not excluded
  + no prior claim. Concurrent claims caught at the unique constraint.
- Public event detail page renders per-ticket-type coverage verdicts
  (`CLAIMABLE` / `OWNED` / `BUY`) from a single `/memberships/me/coverage`
  call — never trusts the client's button.
- Phase 2 `Membership` (user↔org role) renamed to `OrganizationMember`
  in a standalone migration so the term is free for the new platform
  subscription model.

## Local boot recipe

```bash
pnpm install
cp .env.example .env  # fill in STRIPE_SECRET_KEY + STRIPE_PUBLISHABLE_KEY
pnpm --filter @organizer-hub/db migrate:accounts:dev
pnpm --filter @organizer-hub/db migrate:api:dev
pnpm --filter @organizer-hub/db seed:api      # seeds the 6 MembershipPlan rows
pnpm dev
```

In a separate terminal, forward Stripe webhooks to the local api:

```bash
stripe listen --forward-to http://localhost:3001/webhooks/stripe
```

Copy the printed `whsec_…` into `.env` as `STRIPE_WEBHOOK_SECRET` and
restart `pnpm dev`. See `docs/phase-3-stripe-setup.md` for the full
Stripe Dashboard recipe (six Prices with their `lookup_key`s, the
"Limit customers to one subscription" toggle, secret rotation, security
model). Drive `docs/phase-3-browser-smoke.md` for an end-to-end check.

## Phase 4 hardening notes (carried over from Phase 3)

- Refunds, chargebacks, dispute handling. Phase 3 issues but never
  cancels a Ticket; the only failure mode covered is the webhook
  auto-refund for tampered checkout metadata.
- Capacity, sold-out states, per-tier inventory, waitlists.
- Organizer payouts / revenue-share (Stripe Connect).
- Refresh-token rotation on the web side. Today a 401 from the api kicks
  the user back to `/auth/login`; the refresh token is stored but unused.
- Member invitations and removal from the dashboard.
- Image uploads, search, email notifications, custom receipt emails
  beyond Stripe defaults, RP-initiated logout parity.
- `docs/solutions/billing/` capture — the `syncStripeData` pattern,
  rename-before-reuse migration ordering, and the NestJS Stripe testing
  seam are worth writing up as institutional learnings.
