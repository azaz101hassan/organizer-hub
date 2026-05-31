# Payment-events ledger — design

**Status:** approved, ready for implementation plan
**Date:** 2026-05-31

## Problem

Stripe touches the API in five places today — paid `Ticket`s, `TicketRequest`
checkout sessions, `Membership` subscriptions, `MembershipPlan` lookup keys,
and the narrow `RefundLog` for the U7 auto-refund path. There is no single
view of "money moved between OrganizerHub and Stripe", and no way to surface
in-flight (pending) or terminal (refunded, failed, disputed) state to either
admins or members. Donations are not represented at all.

A minimal local **payment-events ledger** consolidates every charge,
renewal, refund, and dispute Stripe tells us about into one append-and-update
table, with stable references back to Stripe (the source of truth) and to
the local entities the charge fulfilled (Ticket / Membership / TicketRequest).

The ledger is a **mirror**, not an authority: every monetary number is what
Stripe sent. No card data, no PCI-bearing fields, nothing reconstructed
locally.

## Scope

In scope:
- New `PaymentEvent` model in the api bounded context.
- Webhook handlers that insert and update rows from Stripe events.
- Backfill script that derives rows from existing `Ticket`, `Membership`,
  and `TicketRequest` records.
- Member-facing page `apps/member/src/app/dashboard/payments/`.
- Admin-facing page `apps/admin/src/app/transactions/` with filters and CSV
  export.

Out of scope:
- A donation intake flow. Schema reserves `kind = DONATION`; the donation
  Checkout flow ships later.
- Stripe fee / net tracking (would require `BalanceTransaction` wiring and
  a 2-day settlement lag).
- Recurring donations (Stripe Subscription with non-membership product).
- Multi-currency display logic. Currency is stored verbatim; the UI assumes
  USD for now.
- Tax-reportable outputs and external accounting integrations.
- Multi-tenant org switching (admin remains pinned to the house org via
  `HOUSE_ORG_ID`).

## Data model

One new table in `packages/db/api/schema.prisma`:

```prisma
enum PaymentEventKind {
  TICKET
  MEMBERSHIP
  DONATION
  REFUND
  DISPUTE
}

enum PaymentEventStatus {
  PENDING
  SUCCEEDED
  FAILED
  CANCELED
}

model PaymentEvent {
  id                       String              @id @default(cuid())
  organizationId           String              @map("organization_id")
  userId                   String              @map("user_id") // sub from accounts
  kind                     PaymentEventKind
  status                   PaymentEventStatus
  amountCents              Int                 @map("amount_cents") // signed: refunds/disputes negative
  currency                 String              // verbatim from Stripe, e.g. "usd"
  description              String?

  // Stripe references — the mirror
  stripeCustomerId         String?             @map("stripe_customer_id")
  stripePaymentIntentId    String?             @map("stripe_payment_intent_id")
  stripeCheckoutSessionId  String?             @map("stripe_checkout_session_id")
  stripeInvoiceId          String?             @map("stripe_invoice_id")    // membership renewals
  stripeRefundId           String?             @unique @map("stripe_refund_id")
  stripeChargeId           String?             @map("stripe_charge_id")     // dispute rows

  // Local cross-references — nullable
  ticketId                 String?             @map("ticket_id")
  ticketRequestId          String?             @map("ticket_request_id")
  membershipId             String?             @map("membership_id")
  refundsPaymentIntentId   String?             @map("refunds_payment_intent_id")

  failureReason            String?             @map("failure_reason")
  succeededAt              DateTime?           @map("succeeded_at")
  canceledAt               DateTime?           @map("canceled_at")
  createdAt                DateTime            @default(now()) @map("created_at")
  updatedAt                DateTime            @updatedAt       @map("updated_at")

  // One CHARGE row per (PI, kind != REFUND). Refund rows key on stripeRefundId.
  @@unique([stripePaymentIntentId, kind], map: "payment_events_pi_kind_key")
  @@index([organizationId, createdAt])
  @@index([userId, createdAt])
  @@index([stripePaymentIntentId])
  @@index([stripeCheckoutSessionId])
  @@map("payment_events")
}
```

Notes:
- `amountCents` is signed. Refund / dispute rows store a negative number.
  Running net for a PaymentIntent is `sum(amount_cents)` over its rows.
- `stripePaymentIntentId` is not `@unique` because a refund row also points
  at the same PI; the `(stripe_payment_intent_id, kind)` compound is the
  uniqueness gate for the charge row.
- `refundsPaymentIntentId` is a logical FK to the original charge by Stripe
  PI id, not a Prisma relation. We don't index it through `PaymentEvent`
  because refund-by-original lookups are rare.

## Write paths

All writes happen inside `apps/api/src/webhooks/stripe-webhook.service.ts`,
inside the existing `WebhookEvent`-gated transaction. A ledger-write failure
aborts the webhook ack and Stripe retries.

| Stripe event | Action |
|---|---|
| `checkout.session.created` | Insert `PENDING` row. `kind` from session metadata (`ticket` / `membership` / `donation` — added at session-creation time). |
| `payment_intent.succeeded` | Update the row matched by `stripe_payment_intent_id` + `kind != REFUND`: set `status = SUCCEEDED`, `succeeded_at`, write `description` if empty, fill `ticketId` / `membershipId` once the fulfilling entity exists. |
| `payment_intent.payment_failed` | Same row → `status = FAILED`, `failure_reason`. |
| `payment_intent.canceled` | Same row → `status = CANCELED`, `canceled_at`. |
| `invoice.payment_succeeded` (membership renewals) | Insert a brand-new `MEMBERSHIP` row with the renewal's PI id + invoice id + amount. |
| `charge.refunded` | For every `Refund` object on the charge, insert a `REFUND` row: negative `amount_cents`, `stripeRefundId` set, `refundsPaymentIntentId` set, `kind = REFUND`. Partial refunds → multiple rows. Idempotent on `stripeRefundId`. |
| `charge.dispute.created` | Insert one `DISPUTE` row: negative amount, `stripeChargeId` set. |

Checkout session creation today produces a session with metadata like
`{ source: 'ticket', ticketTypeId: '…' }` (see `checkout-session.factory.ts`).
The session-created handler reads that metadata to populate `kind` and any
relevant local id at insert time.

## Read paths

### Member: `apps/member/src/app/dashboard/payments/page.tsx`

Server-rendered list of the signed-in user's `PaymentEvent` rows, newest
first, cursor-paginated by `(createdAt, id)` to match the existing public
events list pattern. Filters: kind (default all). Each row shows date,
description, signed amount, status badge. Detail page shows the Stripe
receipt URL fetched lazily (one Stripe API call on detail open).

### Admin: `apps/admin/src/app/transactions/page.tsx`

House-org-scoped list. Filters: date range, kind, status, user email, amount
range. CSV export at `GET /transactions.csv?<filters>` streams rows. Gated
by `WRITE_ROLES` (OWNER, ADMIN).

### API routes (new module `apps/api/src/payment-events/`)

```
GET /payment-events
    ?cursor=<id>&limit=20&kind=TICKET&status=SUCCEEDED
    # member surface: returns only the caller's rows

GET /payment-events?organizationId=<id>&... 
    # admin surface: same query shape + organizationId param
    # gated by EventLabelsService-style requireRole helper

GET /payment-events/:id
    # detail; includes a fresh Stripe receipt URL if available

GET /transactions.csv?organizationId=<id>&... 
    # admin-only CSV stream
```

Routes follow the flat shape introduced by the `event-labels` refactor
(`?organizationId=` query param, not nested under `/organizations/:orgId/`).

## Backfill

`apps/api/scripts/backfill-payment-events.ts`:

1. For every `Ticket` with `source = PAID` and a `stripeCheckoutSessionId`:
   upsert a `TICKET` `PaymentEvent` row by `stripePaymentIntentId`.
2. For every `TicketRequest` with a `stripeCheckoutSessionId`: upsert a
   `TICKET` row (status derived from the request's status — `APPROVED →
   PENDING`, `CANCELLED_BY_USER → CANCELED`, etc.).
3. For every `Membership`: upsert a `MEMBERSHIP` row keyed on the
   subscription's first invoice PI. Historical renewals are *not*
   reconstructed in v1 — we only seed the most recent invoice.
4. For every `RefundLog` row: upsert a `REFUND` row keyed on
   `stripeCheckoutSessionId`.

Idempotent re-runs. Logs a count of inserted vs skipped per source.

## Migration

One Prisma migration:
```
20260601_add_payment_events
```
Adds the two enums, the table, the indexes, the unique constraints. No
changes to existing tables; cross-refs are by string ids only.

## Failure modes and invariants

- **Out-of-order webhooks.** Stripe can deliver `payment_intent.succeeded`
  before `checkout.session.created`. The success handler does an upsert
  (insert with full data if no PENDING row exists yet) so order doesn't
  matter.
- **Replays.** Already handled by `WebhookEvent` dedupe at the outer layer.
  Ledger writes themselves are idempotent on the unique constraints.
- **Backfill collisions.** Backfill uses the same unique keys as live
  writes, so re-running backfill after some live traffic is safe.
- **Currency.** Stored as-sent (lowercase three-letter, e.g. `"usd"`). The
  member/admin UIs read currency from the row and render with
  `Intl.NumberFormat`. For now the codebase only configures `usd` Prices in
  Stripe; non-USD rows would still render correctly.

## Verification

After implementation:

1. **Backfill correctness.** Run backfill on a populated local db; manually
   compare counts against `tickets WHERE source = 'PAID'` etc.
2. **Live webhook coverage.** Drive the existing browser smoke flows
   (ticket buy, membership signup, membership renewal via Stripe CLI
   `stripe trigger`, refund via Stripe Dashboard, dispute via Stripe CLI).
   Each should produce the expected ledger row(s).
3. **Idempotency.** Replay the same webhook event twice via `stripe trigger
   --resend`; ensure no duplicate rows.
4. **Read surface.** Visit `/dashboard/payments` as the buying user — see
   the row. Visit `/transactions` as the admin — see all rows. Export CSV;
   confirm content matches the DB.
5. **Reconciliation.** Pick a Stripe PaymentIntent at random; query the
   Stripe API for it; assert local rows sum to its net.

## Alternatives considered

- **Per-Checkout-Session granularity.** Cheaper mapping from current code,
  but drops every subscription renewal after the first. Rejected.
- **Per-BalanceTransaction granularity.** Truer accounting (includes fees,
  net), but ~2-day settlement lag and heavier wiring. Defer until tax /
  financial outputs are needed.
- **Mutate the original row on refund.** Simpler "is this refunded?" query
  but breaks the Stripe-mirror property and complicates partial refunds.
  Rejected.
- **Insert only on terminal events (no PENDING).** Cleaner append-only but
  loses in-flight visibility — the user can't see "you started a checkout,
  it's still pending" after closing the tab. Rejected per product call.
