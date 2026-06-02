# Payment Events and Donation Erasure Policy

## FK behavior

The `payment_events.donation_id` foreign key references `donations.id` with
`ON DELETE SET NULL ON UPDATE CASCADE`. This was the constraint definition
from the beginning (migration `20260601142449_add_donations`); the Prisma
schema annotation was updated in migration `20260603000100_payment_events_donation_id_set_null`
to reflect what the database already enforced.

Concretely: deleting a `Donation` row nulls `donation_id` on every dependent
`PaymentEvent`, but leaves those rows intact. The money they represent
continues to exist in the ledger.

## When donations can be deleted

No deletion flow exists today. The current codebase only soft-archives
donations by setting `status = 'CANCELED'` and `canceledAt`. Hard deletion
of a `Donation` row is deferred until a formal GDPR right-to-erasure flow
is designed and reviewed.

Donation rows should only be hard-deleted as part of a deliberate erasure
flow that:

1. Has a clear legal basis (user erasure request, DBA cleanup, test data purge).
2. Applies only to donations that carry no outstanding financial obligations
   (e.g. no active Stripe subscription, no pending refunds).
3. Is preceded by the code-path hardening described below.

## What happens to PaymentEvent history when a donation is deleted

When a `Donation` row is deleted:

- Every `PaymentEvent` that previously had `donation_id = <id>` retains its
  row but has `donation_id` set to NULL.
- The `amountCents`, `status`, `kind`, `organizationId`, and `userId` columns
  are unchanged — the money-movement record is durable.
- Org-level revenue totals (e.g. the raw `payment_events` ledger) remain
  accurate because those totals aggregate directly on `PaymentEvent.amountCents`.
- Campaign-level totals become inaccurate: `campaignTotals()` in
  `apps/api/src/donations/campaigns.service.ts` queries via the relation
  `donation: { campaignId }`. Once `donation_id` is NULL, those payment events
  are invisible to that query, so `raisedCents` and `donorCount` will
  undercount.

## Code paths that must be hardened before a real erasure flow ships

The following areas assume `donation_id IS NOT NULL` or use the Prisma
relation join that breaks when `donation_id` is nulled:

**`campaigns.service.ts` — `campaignTotals`**

```ts
// apps/api/src/donations/campaigns.service.ts
where: { donation: { campaignId }, status: 'SUCCEEDED' }
```

This join traverses the `donation` relation. After erasure the payment events
are invisible. An erasure-safe implementation must aggregate campaign totals
from a snapshot (e.g. a `campaign_totals` materialized view or a denormalized
`raised_cents` column on `Campaign`) rather than reconstructing them at
query-time from the live payment-event join.

**`campaigns.service.ts` — `getForAdmin` / `activeRecurringCount`**

```ts
// apps/api/src/donations/campaigns.service.ts
this.prisma.donation.count({
  where: { campaignId: existing.id, mode: 'RECURRING', status: 'ACTIVE' },
})
```

This queries `Donation` directly. If the donation row is deleted, the count
drops to zero for the erased donor, which is correct — a deleted donation is
no longer active. No change required here.

**`transactions` list endpoint (if it filters by `donationId`)**

Any endpoint that joins or filters on `payment_events.donationId` will silently
exclude erased-donation payment events. Review whether those endpoints should
also accept NULL-donation rows before shipping an erasure flow.

## Summary

The FK change is safe to ship now and introduces no behavior change for any
current code path. It only removes the Postgres-level barrier that would
prevent future deletion of a `Donation` row. The campaign-totals aggregation
in `campaigns.service.ts` is the primary area that needs redesign before
hard deletion is actually exercised in production.
