# Phase 3 — Stripe setup

This doc walks through the Stripe-side configuration OrganizerHub depends on. Local code reads three secrets from `.env` (`STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`) and six Stripe Prices configured with specific `lookup_key`s. Get those in place and the local mirror (`MembershipPlan` + `Membership`) does the rest.

This file is filled in progressively across U3–U10. As of U3 it covers membership SKUs and the dashboard toggle. Webhook + CLI wiring is added in U4; the prod rotation procedure lands in U10.

## Test-mode keys

1. Open the Stripe Dashboard → toggle to **Test mode** in the top bar.
2. **Developers → API keys**. Copy the **Secret key** (`sk_test_…`) into `.env` as `STRIPE_SECRET_KEY` and the **Publishable key** (`pk_test_…`) as `STRIPE_PUBLISHABLE_KEY`. Never commit either.
3. The webhook signing secret comes later — `stripe listen` issues a fresh `whsec_…` per session for local dev.

## Required Dashboard setting: limit one subscription per customer

OrganizerHub's mirror assumes at most one live subscription per Stripe Customer. `syncStripeData` defends against the multi-subscription case (picks highest `tier_level`), but the canonical fix is to set Stripe up that way:

1. **Settings → Subscriptions and emails → Subscriptions**.
2. Enable **Limit customers to one subscription** (test mode and prod). The Customer Portal will then automatically swap-not-add when a user changes tier.

## Six membership SKUs (Products + Prices)

OrganizerHub's local catalog (`MembershipPlan`) keys off Stripe Price `lookup_key`s. Create three Products (BRONZE / SILVER / GOLD) with two Prices each (monthly / yearly), and assign these exact `lookup_key`s on the Prices:

| Local lookup_key             | Tier   | Cadence | Suggested price (test mode) |
|------------------------------|--------|---------|-----------------------------|
| `membership_bronze_monthly`  | BRONZE | monthly | $5.00 / month               |
| `membership_bronze_yearly`   | BRONZE | yearly  | $50.00 / year               |
| `membership_silver_monthly`  | SILVER | monthly | $15.00 / month              |
| `membership_silver_yearly`   | SILVER | yearly  | $150.00 / year              |
| `membership_gold_monthly`    | GOLD   | monthly | $40.00 / month              |
| `membership_gold_yearly`     | GOLD   | yearly  | $400.00 / year              |

Steps in the Dashboard for each Product:

1. **Catalog → Add product**. Name it (e.g., `OrganizerHub Bronze`). Skip image, tax, etc. for portfolio scope.
2. Under **Recurring**, add two Prices: one with billing period **Monthly**, one **Yearly**.
3. After creating each Price, open it and set the **lookup_key** to the value from the table above (test mode and prod use the same keys so the seed file stays unchanged).

The local catalog (`MembershipPlan`) is seeded by:

```bash
pnpm -F db seed:api
```

Running it on a fresh DB inserts the six rows; subsequent runs upsert in place (idempotent — verified by U3's e2e specs).

The seed never calls Stripe — Stripe Prices are authoritative for amount and currency, and the local table only carries the `tier`, `tierLevel`, `cadence`, and display copy used by the `/membership` pricing page and `syncStripeData`.

## Webhooks (filled in by U4)

Once U4 lands the `/webhooks/stripe` controller you'll add an endpoint in the Dashboard listening for `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`, and `checkout.session.completed`, plus a `stripe listen --forward-to localhost:3001/webhooks/stripe` loop for local dev. The doc will be amended then.

## Rotation procedure (filled in by U10)

The webhook signing secret rotation runbook (two-active-secrets technique to avoid a rotation outage) is documented in U10 once the webhook path is wired and operational.
