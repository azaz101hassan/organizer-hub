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
| `apps/member` | 3000 | Next.js — consumer surface: public events, ticket purchase, membership (OAuth client `organizer-member`) |
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
pnpm setup:env
pnpm dev
```

Run `pnpm setup:env` to scaffold per-app `.env.local` files from each `.env.example`, then fill in any sentinel values.

## Phases

- **Phase 0** — Monorepo scaffold + tooling ✅
- **Phase 1** — Accounts service (OIDC IdP) with signup/login ✅
- **Phase 2** — Organizer onboarding + event CRUD (OAuth client) ✅
- **Phase 3** — Stripe billing: tiered memberships + tiered tickets + per-event coverage ✅
- **Phase 4** — Capacity caps + waitlist (request → approve/reject),
  transactional email, live SSE admin queue ✅

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
- `apps/member` dashboard at `/dashboard` for signed-in users: org list,
  create org, per-org events list, create event, edit event, publish,
  cancel. (Organizer-only routes move out to `apps/admin` in a later phase.)
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

## What Phase 4 ships

- Optional per-tier **capacity cap** (`TicketType.cap`). Under cap, the
  Phase 3 instant buy + claim paths are unchanged; at cap, purchases and
  member claims become moderated **waitlist requests** instead of issuing
  a ticket. The cap is a *soft* cap — organizers may approve over it.
- A thin `TicketRequest` lifecycle (`PENDING → APPROVED / REJECTED /
  EXPIRED / CANCELLED_BY_USER`) on a single compare-and-set + audit core,
  with a partial unique index enforcing at most one open request per
  user per tier.
- Requester surface: a public **Request a spot** affordance on the event
  page at cap, and a `/dashboard/requests` list + detail with a pay CTA
  for approved paid requests and an idempotent self-cancel.
- Organizer surface: a live `/dashboard/organizations/:orgId/requests`
  queue that approves (paid → Stripe Checkout link, free → instant
  claim) or rejects, updating in real time.
- **Transactional email** (Resend) behind a swappable seam — approval
  (paid + claim) and rejection notices, sent best-effort *after* the DB
  transition commits, never blocking the response.
- **Live admin queue over SSE**: a per-org emit hub fans every transition
  to connected admins, authenticated by a single-use, opaque,
  ~60s-lived query token minted from a role-gated, throttled endpoint
  (EventSource can't send an Authorization header).
- A row-locked **webhook reconciliation** that re-checks payability at
  payment time and auto-refunds a charge landing against a dead request,
  plus a `@Cron` **auto-reject** sweep that rejects still-pending
  requests once their event starts.

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

For the Phase 4 waitlist additions, see `docs/phase-4-setup.md` for the
Resend account + DNS (SPF/DKIM/DMARC) setup, the SSE production posture
(proxy buffering, heartbeat, query-token redaction), and the
single-instance operational constraints on the scheduler and SSE token
store. Drive `docs/phase-4-browser-smoke.md` for the end-to-end
at-cap → request → approve/reject → pay → email click-through plus the
two-tab live-SSE check. No new env vars beyond `RESEND_API_KEY`,
`MAIL_FROM`, and `WEB_ORIGIN` (already in `.env.example`).

## Beyond Phase 4 (future hardening)

- General refunds, chargebacks, dispute handling. Phases 3–4 issue but
  never cancel a Ticket; the only automatic refund is the Phase 4
  webhook auto-refund for a charge landing against a dead waitlist
  request (tampered metadata or a no-longer-payable request).
- Hard capacity enforcement. Phase 4's cap is a *soft* cap — organizers
  can approve over it; there is no counted, locked check at issue time.
- Sold-out states / per-tier inventory display beyond the cap signal.
- Organizer payouts / revenue-share (Stripe Connect).
- Member invitations and removal from the dashboard.
- Image uploads, search, custom receipt emails beyond Stripe defaults,
  RP-initiated logout parity.
- SSE / scheduler horizontal scale-up (shared token store,
  `pg_try_advisory_lock` around the sweep) — see `docs/phase-4-setup.md`.
