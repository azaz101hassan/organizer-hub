---
title: "NestJS Stripe testing seam: inject the SDK so e2e tests don't touch the network"
tags: [billing, stripe, testing, nestjs, dependency-injection, conventions]
category: design-pattern
date: 2026-05-24
phase: 3
source: docs/plans/2026-05-21-001-feat-phase-3-stripe-billing-plan.md
---

## Problem

The Stripe SDK is a singleton constructed with `new Stripe(secretKey, {...})`.
Calling Stripe API methods is a thin wrapper over `fetch()`. If services
`new Stripe(...)` directly or call the static SDK, e2e specs either need
real network access (slow, flaky, billable) or have to monkey-patch the
global module (brittle). Worse: the Stripe `webhooks.constructEvent`
verifier reads `process.env.STRIPE_WEBHOOK_SECRET` indirectly through the
SDK's `Stripe.Webhooks` namespace, so signature-verification paths can't
be stubbed at all without DI.

The same problem applies to NestJS bootstrap: tests want to inject a fake
implementation that records calls, but the fake has to match the SDK's
shape closely enough that production code (which uses the real SDK type)
compiles and runs against it.

## The pattern

Hide every Stripe SDK touchpoint behind two injectable providers:

1. **`StripeClient`** — wraps `new Stripe(...)` and pins the API version.
   Exposes `.stripe` as a typed handle that services compose against.
2. **`StripeWebhookVerifier`** — wraps `stripe.webhooks.constructEvent`.
   Returns `Stripe.Event` on success, throws `BadRequestException` on
   signature failure (so the controller surfaces 400, not 500).

E2e specs override both providers with hand-written fakes that track calls
in memory. No network. No global mocks. No `jest.mock('stripe')`.

## In this codebase

Production providers:

- `apps/api/src/billing/stripe.client.ts` — `StripeClient`, pins
  `apiVersion: '2026-04-22.dahlia'`, logs (but doesn't throw) on missing
  `STRIPE_SECRET_KEY` so the app can boot in tests.
- `apps/api/src/billing/stripe-webhook.verifier.ts` —
  `StripeWebhookVerifier.construct(rawBody, signature)`, throws
  `BadRequestException` (not raw `Error`) so NestJS's exception filter
  returns 400.

Test fakes:

- `apps/api/test/helpers/fake-stripe.ts` — `FakeStripeClient`,
  `FakeStripeWebhookVerifier`, plus shape types
  (`FakeCheckoutSession`, `FakeCustomerCreateParams`, etc.).
- `apps/api/test/helpers/boot-test-app.ts` — `bootTestApp({ providerOverrides })`
  accepts an array of NestJS `{ provide, useValue }` entries that override
  default providers. Every e2e spec passes
  `[{ provide: StripeClient, useValue: new FakeStripeClient() }, ...]`.

Usage pattern in an e2e spec:

```ts
const fakeStripe = new FakeStripeClient();
const fakeVerifier = new FakeStripeWebhookVerifier();
const { app, prisma } = await bootTestApp({
  providerOverrides: [
    { provide: StripeClient, useValue: fakeStripe },
    { provide: StripeWebhookVerifier, useValue: fakeVerifier },
  ],
});
// Now any service that DI-resolves StripeClient gets fakeStripe.
// Assert: fakeStripe.calls === [{ method: 'customers.create', args: {...} }]
```

Three small but load-bearing details:

- **Pin `apiVersion`.** Stripe's API behavior is version-locked at SDK
  construction. Without `apiVersion: '2026-04-22.dahlia'`, the SDK uses
  whatever the account default is — which can change out from under you
  via a Stripe dashboard toggle. The pinned version also matters because
  `current_period_end` moved off the top-level Subscription onto items
  in `2025-03-31.basil`+, and `syncStripeData()` reads from items.
- **`BadRequestException` (not `Error`) in the verifier.** A raw `Error`
  becomes HTTP 500 via NestJS's default exception filter, which both
  hides the real signature-failure path and (more importantly) tells
  Stripe to *retry* the webhook — which is wrong; bad signatures should
  give up immediately. `BadRequestException` → 400 → Stripe gives up.
- **Fake exposes its own param shapes.** Stripe's SDK types are
  inferred-with-undefined under our CJS-mode type shim, and the fake
  doesn't need to match the full SDK contract — just the methods the
  production code actually calls. The fake's params live next to the
  fake, in `fake-stripe.ts`, not imported from `stripe`. Keeps drift
  between SDK upgrades and test doubles loose enough to manage.

## Why this works

- **No network at test time.** 11 e2e suites / 106 tests / 2.5s.
- **Symmetric override surface.** Production code DI-resolves the same
  token the test overrides. There is no module-level `new Stripe(...)`
  anywhere in `apps/api/src/` — that's the invariant.
- **Catches type drift early.** When the Stripe SDK adds a method or
  changes a return shape, the fake doesn't auto-update — tests fail until
  the fake catches up. That's intentional: it forces a conscious decision
  about which new SDK behavior is in-scope for the new test.
- **Signature verification is testable end-to-end.** The fake verifier can
  return a hand-crafted `Stripe.Event` object whose `.data.object` is
  whatever shape the handler expects. AE7 (webhook replay) and AE8 (bad
  signature) live entirely in e2e tests because of this.

## When not to reach for this

- You're integrating Stripe at the framework boundary only (e.g., a static
  page that links to Stripe Checkout and nothing else server-side). Then
  there's no service to DI — just a config block.
- You have one Stripe call total and zero plans to add more. The
  injection ceremony costs more than it saves for one call.
- You're using a Stripe wrapper library that already wraps the SDK with
  its own DI primitives (rare; most Stripe wrappers don't).

## Where to apply

- Any time you're about to write `new Stripe(...)` more than once in the
  codebase. Pull it behind a single provider and inject from there.
- The same pattern applies to any third-party SDK that owns its own
  network calls — replace "Stripe" with "Twilio," "Sendgrid," "S3," etc.
  The "fake exposes its own param shapes" detail is especially useful for
  SDKs with verbose or unstable parameter types.

## Related

- Phase 3 U2 commit: `79c4ae2` (`feat(api): add Stripe billing seam, raw-body, and webhook dedupe`)
- NestJS custom providers docs: https://docs.nestjs.com/fundamentals/custom-providers
- Stripe SDK type-inference gotcha for CJS namespace: the helper at
  `apps/api/src/billing/stripe-types.ts` re-exports `Stripe` as a type
  from `stripe`'s CJS namespace; this is needed because the SDK's
  `import Stripe from 'stripe'` form returns the *factory* (a function),
  and `Stripe.Event` / `Stripe.Checkout.Session` resolve off the
  namespace, not the factory.
