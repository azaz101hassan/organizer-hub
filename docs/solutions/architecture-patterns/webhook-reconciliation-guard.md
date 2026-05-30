---
title: "Webhook reconciliation guard: row-locked re-check before issuing"
date: 2026-05-30
category: architecture-patterns
module: webhooks
problem_type: architecture_pattern
component: payments
severity: high
applies_when:
  - A webhook finalizes a multi-step workflow where an earlier authorization may have been revoked
  - The finalization step creates a durable resource (ticket, entitlement) that must not exist for revoked authorizations
  - Multiple concurrent actors can change the authorization state while async payment is in flight
  - The webhook source guarantees at-least-once delivery and the handler must be idempotent
tags: [webhook, reconciliation, for-update, auto-refund, idempotency, stripe, toctou]
---

# Webhook reconciliation guard: row-locked re-check before issuing

## Context

In a capacity-gated waitlist flow, there is a time gap between an admin approving a ticket request (which creates a Stripe Checkout Session) and the requester actually paying. During that window the request can die: the user self-cancels, another admin rejects it, the scheduler auto-expires it, or the event starts. If the webhook handler naively trusts the payload and issues a Ticket, the system issues tickets for dead requests. If it reads the request row without locking, a concurrent status change slips through between the read and the write (TOCTOU).

## Guidance

Three layers: **route discrimination** by server-written back-link, **FOR UPDATE reconciliation** inside a transaction, and **commit-then-refund** with triple idempotency.

### 1. Route by back-link, not metadata

The handler does NOT use attacker-influenceable session metadata to decide whether a payment is a waitlist payment. It queries `TicketRequest` for a row whose `stripeCheckoutSessionId` matches `session.id` — a server-written, `@unique` back-link that cannot be forged.

### 2. FOR UPDATE reconciliation

Once routed to the waitlist path, the handler opens a transaction and re-reads the request row with `FOR UPDATE`, joining to the event (for `starts_at`) and ticket type (for `price_cents`):

```typescript
const outcome = await this.prisma.$transaction(async (tx) => {
  const rows = await tx.$queryRaw<LockedWaitlistRow[]>`
    SELECT tr.id, tr.status::text AS status, tr.user_id,
           tr.ticket_type_id, tr.event_id,
           e.starts_at, e.organization_id, tt.price_cents
    FROM ticket_requests tr
    JOIN events e ON e.id = tr.event_id
    JOIN ticket_types tt ON tt.id = tr.ticket_type_id
    WHERE tr.stripe_checkout_session_id = ${session.id}
    FOR UPDATE OF tr
  `;
  const locked = rows[0];
  // metadata cross-validation...
  const payable = locked.status === 'APPROVED' && locked.starts_at > now;
  if (!payable) return { kind: 'dead', reason: '...', ctx: locked };
  await tx.ticket.create({ data: { ... } });
  await recordProcessedWebhookEvent(tx, webhookEventId, COMPLETED);
  return { kind: 'issued', ctx: locked };
});
```

The row lock prevents a concurrent cancel/reject/expire from committing until the issuance decision is made. If `ticket.create` hits P2002 (unique violation), the ticket already exists from a prior delivery — NOT a refund case.

### 3. Commit-then-refund with triple idempotency

When the outcome is `dead`:

```typescript
// Layer 1: Stripe idempotency key — at most one real refund
await this.stripeClient.stripe.refunds.create(
  { payment_intent: paymentIntentId },
  { idempotencyKey: `waitlist-refund-${sessionId}` },
);

// Layer 2: Durable RefundLog — UPSERT on unique stripeCheckoutSessionId
await this.prisma.refundLog.upsert({
  where: { stripeCheckoutSessionId: sessionId },
  create: { stripeCheckoutSessionId: sessionId, ..., reason, amountCents },
  update: {},
});

// Layer 3: warn-level log line (operator alert)
this.logger.warn(`Auto-refunded dead-request payment for session ${sessionId} (reason=${reason})`);
```

The WebhookEvent dedupe row is recorded AFTER the refund + RefundLog. If the process crashes between the Stripe refund and the dedupe row, Stripe redelivers, the idempotency key prevents a double refund, and the RefundLog UPSERT is a no-op.

## Why This Matters

Without the FOR UPDATE guard:
- **Ticket issued for dead request:** Between approval and webhook, the user cancels. Without the lock, READ COMMITTED sees APPROVED (the cancel hasn't committed yet), issues the ticket — user has a ticket they tried to cancel.
- **Money taken, no ticket:** Handler checks status without locking, request is already cancelled, skips issuance but doesn't refund. Customer paid, got nothing.
- **Double refund:** Without the Stripe idempotency key, a redelivered webhook for a dead request issues a second refund.
- **Double ticket:** Without the P2002 catch, a redelivered event for a still-APPROVED request creates a second Ticket row.

The pattern ensures exactly-once semantics: one ticket OR one refund per checkout session.

## When to Apply

- A webhook arrives to finalize a multi-step workflow where approval may have been revoked
- The finalization creates a durable resource (ticket, entitlement) that must not exist for revoked authorizations
- The resource involves money — issuing against a dead authorization means customer paid for nothing (no refund path)
- Multiple concurrent actors can change the authorization state while payment is in flight
- The webhook source guarantees at-least-once delivery

**Signals you need this pattern:** "approved" and "paid" are separate steps with a user-facing delay; an admin, scheduler, or user can revoke approval while payment is pending; the webhook handler creates durable state that is hard to undo.

## Examples

| Test scenario | Expected |
|---|---|
| APPROVED, event in future | Ticket created, no refund |
| CANCELLED_BY_USER status | No ticket, 1 refund with idempotency key, 1 RefundLog row |
| APPROVED but event started | No ticket, 1 refund |
| Redelivery after ticket exists | 1 ticket (P2002 catch), 0 refunds |
| Two deliveries for REJECTED request | 0 tickets, exactly 1 refund (idempotency dedupes), 1 RefundLog row |

| File | Role |
|---|---|
| `apps/api/src/webhooks/stripe-webhook.service.ts` | `reconcileWaitlistPayment()` + `refundDeadRequest()` |
| `packages/db/api/schema.prisma` | `RefundLog` model (unique on `stripeCheckoutSessionId`) |
| `apps/api/src/billing/webhook-event.helper.ts` | Process-first-then-INSERT dedupe pattern |

## Related

- Phase 4 commit U7 (`1b3515c`)
- `docs/solutions/billing/sync-stripe-data-pattern.md` — the sync pattern this guard extends; syncStripeData is insufficient for payment-critical paths where the guard is required
- `docs/solutions/design-patterns/cas-partial-unique-concurrency-model.md` — CAS transitions that the FOR UPDATE guard supplements for cross-table operations
- `docs/solutions/billing/nestjs-stripe-testing-seam.md` — the DI seam that makes the refund path testable without hitting Stripe
