---
title: "syncStripeData: keep Stripe as the source of truth and the DB as a mirror"
tags: [billing, stripe, architecture, design-pattern, idempotency, webhooks]
category: architecture
date: 2026-05-24
phase: 3
source: docs/plans/2026-05-21-001-feat-phase-3-stripe-billing-plan.md
---

## Problem

You're storing billing state — subscription tier, status, period end, customer
id — and you have two places it can drift: Stripe (the merchant of record)
and your DB (the cache the rest of your app reads). Webhooks can be
out-of-order, dropped, re-delivered, or lag minutes behind the user's UX.
If your DB is "the model" and Stripe is "the system that calls webhooks
into the model," you end up with two write paths into one row and they
disagree the first time anything goes wrong.

## The pattern (a.k.a. Theo Browne's stripe-recommendations approach)

Treat Stripe as the source of truth. The DB holds only references
(`stripeCustomerId`, `stripeSubscriptionId`, `stripePriceId`) plus a small
read-side cache. Every write to the cache flows through one function that:

1. Takes a `stripeCustomerId`.
2. Fetches the *current* subscription list from Stripe.
3. Picks the winning subscription (single-source rule).
4. Upserts the cached row to match.

Both the webhook handler and the user-facing `/success` page call the
**same** function. The webhook is no longer the only write path — and
neither path needs to know what the other has done.

## In this codebase

- `apps/api/src/memberships/memberships.service.ts` — `syncStripeData(stripeCustomerId)`
- `apps/api/src/webhooks/stripe-webhook.service.ts` — every subscription-relevant event ends in a `syncStripeData` call
- `apps/api/src/billing/billing.controller.ts` — `/success` page indirection also calls `syncStripeData`
- `apps/api/src/memberships/memberships.service.ts` — `getMembershipForUser` opportunistically calls it on every dashboard render (cheap self-heal)

The function's contract:

```ts
async syncStripeData(stripeCustomerId: string): Promise<MembershipView | null>
```

- Resolves `userId` from `billing_customers` first; falls back to the Stripe
  Customer's `metadata.userId` if the local row hasn't landed yet (first-checkout race).
- Returns `null` (not throws) for unbound customers so webhooks can still ack `200`.
- Reads `current_period_end` off `subscription.items.data[0].current_period_end`
  (it moved off the top level in Stripe API `2025-03-31.basil`+).
- Picks one subscription via `pickWinningSubscription` — handles the
  multi-sub corner case the "Limit customers to one subscription" dashboard
  toggle is supposed to prevent.
- Treats "no live subscription" as `status: CANCELED` rather than deleting
  the row — keeps the audit trail and lets coverage checks see "previously
  had GOLD" if a future feature needs it.

## Why this works

- **Race-resilient.** The webhook can land before the user gets back from
  Checkout, or three seconds after — both still upsert the same row to the
  same shape because both read from Stripe.
- **Idempotent by construction.** Re-running `syncStripeData(X)` with no
  Stripe-side change is a no-op upsert.
- **Self-healing.** If a webhook is missed (network blip, secret rotation
  window), the next user dashboard render re-syncs. No reconciliation job
  needed for Phase 3 scale.
- **One mental model.** "Stripe is the truth, DB is the cache, one function
  copies." Every reviewer of new billing code asks "does this go through
  syncStripeData?" — if not, it's adding a second write path.

## When not to reach for this

- You need millisecond-fresh state from a single Stripe write (you don't —
  Stripe Checkout's flow always involves a redirect, so the user takes
  hundreds of ms to land anyway; that's plenty of time for the call).
- You're storing transactional records that *must* be persisted before the
  external service knows about them (e.g., an outbox table for events you
  produce — opposite direction, this pattern doesn't apply).
- You have multiple subscriptions per customer as a real product feature.
  Then `pickWinningSubscription` becomes "list all" and the schema gains a
  one-to-many relation; the principle still holds but the code shape changes.

## Related

- Inbound webhook dedup: `apps/api/src/billing/webhook-event.helper.ts` —
  "process-first-then-INSERT" so duplicate deliveries don't double-execute
  even before the `WebhookEvent` PK conflict kicks in.
- Outbound idempotency: every `stripe.X.create()` call in
  `billing.service.ts` and `ticket-types.service.ts` passes a deterministic
  `idempotencyKey` built from domain ids — prevents duplicate Stripe
  objects from concurrent retries.
- External reference: https://github.com/t3dotgg/stripe-recommendations
