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

## Webhooks

The api exposes `POST /webhooks/stripe` (see `apps/api/src/webhooks/stripe-webhook.controller.ts`). Every relevant Stripe event reduces to either calling `syncStripeData(customerId)` (subscription / invoice events) or issuing a `Ticket` (paid `checkout.session.completed`). Idempotency is enforced by the `WebhookEvent` table — Stripe redelivery of the same `evt_…` is dropped at the unique-constraint catch.

### Local dev (`stripe listen`)

1. Install the Stripe CLI: `brew install stripe/stripe-cli/stripe` (macOS) or follow the [official guide](https://docs.stripe.com/stripe-cli).
2. `stripe login` once per machine; it opens a browser to authenticate against your Stripe account.
3. Start the forwarder in its own terminal:
   ```bash
   stripe listen --forward-to http://localhost:3001/webhooks/stripe
   ```
   The first line of output is `Ready! Your webhook signing secret is whsec_…`. Copy that value into `.env` as `STRIPE_WEBHOOK_SECRET` and restart `pnpm dev` so the api picks it up.
4. The CLI prints every forwarded event. Trigger a sample with `stripe trigger checkout.session.completed` — the api log shows the verifier accepting the signature and the dispatch path running. Re-fire the same trigger to confirm the dedupe table swallows the duplicate.

### Production endpoint

1. **Developers → Webhooks → Add endpoint**.
2. Endpoint URL: `https://api.<your-domain>/webhooks/stripe`.
3. Events to send:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
   - `invoice.payment_failed`
4. Save. Stripe shows the signing secret once — copy it into the production deploy's `STRIPE_WEBHOOK_SECRET` env var. There is no way to retrieve the secret later (a new one must be generated).

### Rate limiting

The verifier rejects bad signatures with `400` after the HMAC check. For portfolio scope this is enough — a real production posture would add an application-layer throttler scoped to `/webhooks/stripe` (NestJS `@nestjs/throttler`) or restrict ingress to [Stripe's published egress CIDRs](https://docs.stripe.com/ips#webhook-notifications) at the LB. Left as a Phase 4+ hardening pass.

## Secret rotation

The webhook signing secret is the *only* thing standing between an attacker and a forged event landing in the dispatch path. Rotate it whenever:

- A laptop or CI runner that had it leaks (lost/stolen device, exposed env dump).
- A new operator joins or leaves the team.
- The doc says so (annual cadence is reasonable for Phase 3 scope).

Stripe supports two active signing secrets per endpoint so rotation is zero-downtime:

1. **Developers → Webhooks → <endpoint> → Roll signing secret**. The Dashboard prompts you to keep the old secret active for a grace window (default 24h). Confirm.
2. Stripe shows the new `whsec_…` value once. Copy it.
3. Deploy production with `STRIPE_WEBHOOK_SECRET` set to the new value. Verify webhooks still succeed (Stripe's Dashboard shows green checkmarks per delivery).
4. Return to the Dashboard and **Expire** the old secret. Future deliveries are signed with the new secret only.

If the rotation has to happen *now* (active compromise), skip step 1's grace window and expire the old secret immediately after the new one is in production. A short window of failed webhook deliveries is preferable to leaving a known-compromised secret valid.

## Security model

Stripe webhook authenticity in this app rests on three things, in order:

1. **HMAC signature verification** (`StripeWebhookVerifier.construct`) — checks every payload against `STRIPE_WEBHOOK_SECRET`. Invalid signatures return `400` before any business logic runs.
2. **`WebhookEvent` dedupe table** — prevents the same legitimate Stripe-redelivered event from running twice. **It does NOT prevent adversarial novel-event-ID forgery** — once the signing secret leaks, an attacker can craft arbitrary event IDs that haven't been seen before, and the dedupe table will happily insert them.
3. **`syncStripeData` semantics** — every subscription/invoice handler re-fetches state from Stripe by `customer.id`. An attacker who forges a `checkout.session.completed` cannot bypass `syncStripeData` returning whatever Stripe actually has, which limits the blast radius even if (1) is compromised — they would also need to convince Stripe to insert a real subscription. Paid-ticket issuance is more exposed (the webhook handler trusts the metadata it receives), so the `userId === client_reference_id` cross-check and the auto-refund fallback (U7) are the second line of defense.

Concrete operator implications:

- `STRIPE_WEBHOOK_SECRET` **must not** be checked into source control. It belongs in `.env` (local), the secret store (prod), and nowhere else.
- Treat the secret with the same care as `STRIPE_SECRET_KEY` — they are equivalently dangerous in different ways.
- The dedupe table is for idempotency, not authentication. Don't reason about it as a defense against forged events.
