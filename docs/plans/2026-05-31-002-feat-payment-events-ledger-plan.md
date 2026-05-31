---
title: "feat: payment-events ledger"
type: feat
status: planned
date: 2026-05-31
origin: docs/specs/2026-05-31-payment-events-ledger-design.md
---

# feat: payment-events ledger

> **For implementers:** Each Unit (U#) is one commit unless explicitly grouped. Steps use checkbox (`- [ ]`) syntax — check off as you complete. Phases are independently shippable: stop after any Phase boundary and the codebase is in a working state. Lands in 10 dependency-ordered units across six phases.

## Summary

Add a `PaymentEvent` table to the api bounded context as a local mirror of Stripe money-movement. One row per Stripe PaymentIntent (charge), separate negative rows per `Refund` / `Dispute` object. Insert `PENDING` on `checkout.session.created`, transition to terminal states via `payment_intent.*` webhooks, append renewals via `invoice.payment_succeeded`, append refunds/disputes via `charge.refunded` / `charge.dispute.created`. Backfill historical data from existing `Ticket` / `Membership` / `TicketRequest` / `RefundLog` rows. Expose at member `/dashboard/payments` and admin `/transactions` (with CSV export).

## Problem Frame

See the design doc origin spec. Briefly: Stripe references are scattered across `Ticket`, `Membership`, `TicketRequest`, `RefundLog`. There's no unified view of money-in/money-out, no donation concept, no in-flight visibility. Build a minimal local mirror — Stripe stays the source of truth.

## Scope Boundaries

Carried from the spec — out of scope here:
- The donation **intake** flow (the schema reserves `kind=DONATION`; a follow-up adds the Checkout flow).
- Stripe fee / net tracking (no `BalanceTransaction` wiring).
- Recurring donations as Stripe Subscriptions.
- Multi-currency display logic.
- Tax-reportable outputs.
- Multi-tenant org switching.

## Phase boundaries

- **Phase A** ships the schema; existing app behavior unchanged.
- **Phase B** ships live ledger writes; new transactions populate the table; existing rows remain empty until Phase C.
- **Phase C** backfills history.
- **Phase D** ships read APIs.
- **Phase E** ships the admin surface.
- **Phase F** ships the member surface.

A team could ship A–C, then pause; the rest is read-side and not user-blocking.

---

## Phase A — Schema and migration

### U1: Add `PaymentEvent` model + enums + migration

**Files:**
- Modify: `packages/db/api/schema.prisma` (append two enums + one model)
- Create: `packages/db/api/migrations/<timestamp>_add_payment_events/migration.sql`

- [ ] **Step 1: Append to `packages/db/api/schema.prisma`** (end of file, before the closing brace of the last model)

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

// Local mirror of Stripe money-movement. One row per PaymentIntent (kind in
// {TICKET, MEMBERSHIP, DONATION}); separate negative-amount rows per Refund /
// Dispute object. amountCents is signed: refunds/disputes negative. Net per
// PaymentIntent = SUM(amount_cents) of all rows sharing stripe_payment_intent_id.
//
// stripePaymentIntentId is NOT @unique because refund rows reference the same
// PI as the charge they refund. The (stripePaymentIntentId, kind) composite
// unique gates the single charge row per PI; refund rows are gated by the
// @unique stripeRefundId.
model PaymentEvent {
  id                       String              @id @default(cuid())
  organizationId           String              @map("organization_id")
  userId                   String              @map("user_id")
  kind                     PaymentEventKind
  status                   PaymentEventStatus
  amountCents              Int                 @map("amount_cents")
  currency                 String
  description              String?

  stripeCustomerId         String?             @map("stripe_customer_id")
  stripePaymentIntentId    String?             @map("stripe_payment_intent_id")
  stripeCheckoutSessionId  String?             @map("stripe_checkout_session_id")
  stripeInvoiceId          String?             @map("stripe_invoice_id")
  stripeRefundId           String?             @unique @map("stripe_refund_id")
  stripeChargeId           String?             @map("stripe_charge_id")

  ticketId                 String?             @map("ticket_id")
  ticketRequestId          String?             @map("ticket_request_id")
  membershipId             String?             @map("membership_id")
  refundsPaymentIntentId   String?             @map("refunds_payment_intent_id")

  failureReason            String?             @map("failure_reason")
  succeededAt              DateTime?           @map("succeeded_at")
  canceledAt               DateTime?           @map("canceled_at")
  createdAt                DateTime            @default(now()) @map("created_at")
  updatedAt                DateTime            @updatedAt       @map("updated_at")

  @@unique([stripePaymentIntentId, kind], map: "payment_events_pi_kind_key")
  @@index([organizationId, createdAt])
  @@index([userId, createdAt])
  @@index([stripePaymentIntentId])
  @@index([stripeCheckoutSessionId])
  @@map("payment_events")
}
```

- [ ] **Step 2: Generate the migration**

```bash
pnpm --filter @organizer-hub/db migrate:api:dev --name add_payment_events
```

Expected: prints "Applying migration `<ts>_add_payment_events`", regenerates `packages/db/client/api/`. Inspect the generated SQL — it should create the two enums and `payment_events` with the four indexes and two unique constraints.

- [ ] **Step 3: Generate types**

```bash
pnpm --filter @organizer-hub/db generate:api
```

- [ ] **Step 4: Confirm typecheck still passes**

```bash
pnpm -F api typecheck
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/db/api/schema.prisma packages/db/api/migrations packages/db/client
git commit -m "feat(db): add PaymentEvent model and enums

- new payment_events table mirrors Stripe money-movement: one row per
  PaymentIntent (TICKET/MEMBERSHIP/DONATION kinds) plus separate
  negative rows per Refund/Dispute object (REFUND/DISPUTE kinds)
- amountCents is signed so a PI's net = SUM(amount_cents) of all rows
  sharing its stripe_payment_intent_id"
```

---

## Phase B — Webhook write paths

### U2: Stamp `source` metadata on every Checkout Session

The `checkout.session.created` handler needs to know whether a session is a ticket purchase, membership signup, or (future) donation. Add a `source` field to the metadata at both creation sites.

**Files:**
- Modify: `apps/api/src/billing/checkout-session.factory.ts:40-44`
- Modify: `apps/api/src/billing/billing.service.ts:125-133`

- [ ] **Step 1: Add `source` to ticket session metadata**

In `apps/api/src/billing/checkout-session.factory.ts`, change the metadata object (around line 40):

```ts
    const metadata: Record<string, string> = {
      source: 'ticket',
      userId: params.userSub,
      eventId: params.eventId,
      ticketTypeId: params.ticketTypeId,
    };
```

- [ ] **Step 2: Add `metadata.source` to membership session**

In `apps/api/src/billing/billing.service.ts`, change the `sessions.create` call (around line 125):

```ts
    const session = await this.stripeClient.stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customer.stripeCustomerId,
      client_reference_id: userSub,
      line_items: [{ price: price.id, quantity: 1 }],
      metadata: { source: 'membership', userId: userSub },
      subscription_data: {
        metadata: { source: 'membership', userId: userSub },
      },
      success_url: `${webOrigin}/dashboard/membership?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${webOrigin}/membership?checkout=canceled`,
    });
```

(The `subscription_data.metadata` copy ensures the Subscription — and therefore every later renewal Invoice — also carries `source=membership`, so `invoice.payment_succeeded` can resolve the kind without a Stripe API round-trip.)

- [ ] **Step 3: Update unit tests for both factories**

Check existing tests and add an assertion that `metadata.source` is set:

```bash
pnpm -F api test -- billing/checkout-session.factory billing/billing.service
```

Add `expect(call.metadata.source).toBe('ticket')` (or `'membership'`) in the matching `it(...)` blocks.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/billing/checkout-session.factory.ts apps/api/src/billing/billing.service.ts apps/api/src/billing/*.spec.ts
git commit -m "feat(billing): stamp source on Checkout Sessions

- ticket sessions get metadata.source='ticket'; membership sessions
  get metadata.source='membership' on the session AND the subscription
  it creates, so invoice.payment_succeeded renewals can resolve the
  ledger kind without a Stripe API call"
```

### U3: Insert `PENDING` row on `checkout.session.created`

**Files:**
- Create: `apps/api/src/payment-events/payment-events.module.ts`
- Create: `apps/api/src/payment-events/payment-events.service.ts`
- Create: `apps/api/src/payment-events/payment-events.service.spec.ts`
- Modify: `apps/api/src/webhooks/stripe-webhook.service.ts` (top: import + ctor injection; body: new handler)
- Modify: `apps/api/src/webhooks/webhooks.module.ts` (import PaymentEventsModule)
- Modify: `apps/api/src/app.module.ts` (register PaymentEventsModule)

- [ ] **Step 1: Create the module + write-only service**

`apps/api/src/payment-events/payment-events.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PaymentEventsService } from './payment-events.service';

@Module({
  imports: [PrismaModule],
  providers: [PaymentEventsService],
  exports: [PaymentEventsService],
})
export class PaymentEventsModule {}
```

`apps/api/src/payment-events/payment-events.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import {
  Prisma,
  PaymentEventKind,
  PaymentEventStatus,
} from '@organizer-hub/db/api';
import { PrismaService } from '../prisma/prisma.service';

const HOUSE_ORG_ID = 'org_house_000000000000000001';

export interface PendingChargeInput {
  userId: string;
  kind: PaymentEventKind; // TICKET | MEMBERSHIP | DONATION
  amountCents: number;
  currency: string;
  stripeCustomerId?: string | null;
  stripePaymentIntentId?: string | null;
  stripeCheckoutSessionId: string;
  description?: string;
  ticketRequestId?: string | null;
}

export interface TerminalChargeUpdate {
  status: PaymentEventStatus; // SUCCEEDED | FAILED | CANCELED
  succeededAt?: Date;
  canceledAt?: Date;
  failureReason?: string;
  ticketId?: string | null;
  membershipId?: string | null;
}

export interface RenewalRowInput {
  userId: string;
  amountCents: number;
  currency: string;
  stripeCustomerId: string;
  stripePaymentIntentId: string;
  stripeInvoiceId: string;
  membershipId?: string | null;
}

export interface RefundRowInput {
  userId: string;
  amountCents: number; // pass as positive; service negates
  currency: string;
  stripeCustomerId?: string | null;
  stripePaymentIntentId: string; // the PI being refunded
  stripeRefundId: string;
  stripeChargeId?: string | null;
  description?: string;
}

export interface DisputeRowInput {
  userId: string;
  amountCents: number; // positive; service negates
  currency: string;
  stripeCustomerId?: string | null;
  stripeChargeId: string;
  stripePaymentIntentId?: string | null;
  description?: string;
}

// All writes happen inside the same transaction as the webhook handler's
// other side-effects so a ledger-write failure aborts the webhook ack
// and Stripe retries.
@Injectable()
export class PaymentEventsService {
  private readonly logger = new Logger(PaymentEventsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async upsertPendingCharge(
    tx: Prisma.TransactionClient | PrismaService,
    input: PendingChargeInput,
  ): Promise<void> {
    if (!input.stripePaymentIntentId) {
      this.logger.debug(
        `upsertPendingCharge: session ${input.stripeCheckoutSessionId} has no PI yet; storing checkout-session-only row`,
      );
    }
    try {
      await tx.paymentEvent.create({
        data: {
          organizationId: HOUSE_ORG_ID,
          userId: input.userId,
          kind: input.kind,
          status: PaymentEventStatus.PENDING,
          amountCents: input.amountCents,
          currency: input.currency,
          description: input.description,
          stripeCustomerId: input.stripeCustomerId ?? null,
          stripePaymentIntentId: input.stripePaymentIntentId ?? null,
          stripeCheckoutSessionId: input.stripeCheckoutSessionId,
          ticketRequestId: input.ticketRequestId ?? null,
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        // Replay; the row already exists.
        return;
      }
      throw err;
    }
  }

  async finalizeCharge(
    tx: Prisma.TransactionClient | PrismaService,
    stripePaymentIntentId: string,
    update: TerminalChargeUpdate,
  ): Promise<void> {
    // Find the row by PI, kind != REFUND/DISPUTE. There can be at most one
    // such row by the composite unique.
    const row = await tx.paymentEvent.findFirst({
      where: {
        stripePaymentIntentId,
        kind: { in: [PaymentEventKind.TICKET, PaymentEventKind.MEMBERSHIP, PaymentEventKind.DONATION] },
      },
      select: { id: true },
    });
    if (!row) {
      this.logger.warn(
        `finalizeCharge: no charge row for PI ${stripePaymentIntentId}; out-of-order webhook?`,
      );
      return;
    }
    await tx.paymentEvent.update({
      where: { id: row.id },
      data: {
        status: update.status,
        succeededAt: update.succeededAt,
        canceledAt: update.canceledAt,
        failureReason: update.failureReason,
        ticketId: update.ticketId ?? undefined,
        membershipId: update.membershipId ?? undefined,
      },
    });
  }

  async insertRenewal(
    tx: Prisma.TransactionClient | PrismaService,
    input: RenewalRowInput,
  ): Promise<void> {
    try {
      await tx.paymentEvent.create({
        data: {
          organizationId: HOUSE_ORG_ID,
          userId: input.userId,
          kind: PaymentEventKind.MEMBERSHIP,
          status: PaymentEventStatus.SUCCEEDED,
          amountCents: input.amountCents,
          currency: input.currency,
          stripeCustomerId: input.stripeCustomerId,
          stripePaymentIntentId: input.stripePaymentIntentId,
          stripeInvoiceId: input.stripeInvoiceId,
          membershipId: input.membershipId ?? null,
          succeededAt: new Date(),
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return; // renewal row already exists for this PI
      }
      throw err;
    }
  }

  async insertRefund(
    tx: Prisma.TransactionClient | PrismaService,
    input: RefundRowInput,
  ): Promise<void> {
    try {
      await tx.paymentEvent.create({
        data: {
          organizationId: HOUSE_ORG_ID,
          userId: input.userId,
          kind: PaymentEventKind.REFUND,
          status: PaymentEventStatus.SUCCEEDED,
          amountCents: -Math.abs(input.amountCents),
          currency: input.currency,
          description: input.description,
          stripeCustomerId: input.stripeCustomerId ?? null,
          stripePaymentIntentId: input.stripePaymentIntentId,
          stripeRefundId: input.stripeRefundId,
          stripeChargeId: input.stripeChargeId ?? null,
          refundsPaymentIntentId: input.stripePaymentIntentId,
          succeededAt: new Date(),
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return; // refund row exists (unique on stripeRefundId)
      }
      throw err;
    }
  }

  async insertDispute(
    tx: Prisma.TransactionClient | PrismaService,
    input: DisputeRowInput,
  ): Promise<void> {
    try {
      await tx.paymentEvent.create({
        data: {
          organizationId: HOUSE_ORG_ID,
          userId: input.userId,
          kind: PaymentEventKind.DISPUTE,
          status: PaymentEventStatus.SUCCEEDED,
          amountCents: -Math.abs(input.amountCents),
          currency: input.currency,
          description: input.description,
          stripeCustomerId: input.stripeCustomerId ?? null,
          stripeChargeId: input.stripeChargeId,
          stripePaymentIntentId: input.stripePaymentIntentId ?? null,
          succeededAt: new Date(),
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return;
      }
      throw err;
    }
  }
}
```

- [ ] **Step 2: Write unit tests for the service**

`apps/api/src/payment-events/payment-events.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { PaymentEventKind, PaymentEventStatus } from '@organizer-hub/db/api';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentEventsService } from './payment-events.service';

describe('PaymentEventsService', () => {
  let service: PaymentEventsService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [PaymentEventsService, PrismaService],
    }).compile();
    service = mod.get(PaymentEventsService);
    prisma = mod.get(PrismaService);
    await prisma.paymentEvent.deleteMany();
  });
  afterAll(async () => prisma.$disconnect());

  it('upsertPendingCharge inserts a PENDING TICKET row', async () => {
    await service.upsertPendingCharge(prisma, {
      userId: 'user_1',
      kind: PaymentEventKind.TICKET,
      amountCents: 2500,
      currency: 'usd',
      stripePaymentIntentId: 'pi_1',
      stripeCheckoutSessionId: 'cs_1',
    });
    const row = await prisma.paymentEvent.findFirst({ where: { stripePaymentIntentId: 'pi_1' } });
    expect(row?.status).toBe(PaymentEventStatus.PENDING);
    expect(row?.amountCents).toBe(2500);
  });

  it('upsertPendingCharge is idempotent on the (PI, kind) unique', async () => {
    const input = { userId: 'user_1', kind: PaymentEventKind.TICKET, amountCents: 2500, currency: 'usd', stripePaymentIntentId: 'pi_dup', stripeCheckoutSessionId: 'cs_dup' };
    await service.upsertPendingCharge(prisma, input);
    await service.upsertPendingCharge(prisma, input);
    const count = await prisma.paymentEvent.count({ where: { stripePaymentIntentId: 'pi_dup' } });
    expect(count).toBe(1);
  });

  it('finalizeCharge transitions PENDING -> SUCCEEDED', async () => {
    await service.upsertPendingCharge(prisma, { userId: 'u', kind: PaymentEventKind.TICKET, amountCents: 100, currency: 'usd', stripePaymentIntentId: 'pi_2', stripeCheckoutSessionId: 'cs_2' });
    await service.finalizeCharge(prisma, 'pi_2', { status: PaymentEventStatus.SUCCEEDED, succeededAt: new Date() });
    const row = await prisma.paymentEvent.findFirst({ where: { stripePaymentIntentId: 'pi_2' } });
    expect(row?.status).toBe(PaymentEventStatus.SUCCEEDED);
    expect(row?.succeededAt).toBeTruthy();
  });

  it('insertRefund stores a negative-amount REFUND row keyed on stripeRefundId', async () => {
    await service.insertRefund(prisma, { userId: 'u', amountCents: 100, currency: 'usd', stripePaymentIntentId: 'pi_3', stripeRefundId: 're_1' });
    const row = await prisma.paymentEvent.findUnique({ where: { stripeRefundId: 're_1' } });
    expect(row?.amountCents).toBe(-100);
    expect(row?.kind).toBe(PaymentEventKind.REFUND);
  });

  it('insertRefund is idempotent on stripeRefundId', async () => {
    const input = { userId: 'u', amountCents: 100, currency: 'usd', stripePaymentIntentId: 'pi_4', stripeRefundId: 're_dup' };
    await service.insertRefund(prisma, input);
    await service.insertRefund(prisma, input);
    const count = await prisma.paymentEvent.count({ where: { stripeRefundId: 're_dup' } });
    expect(count).toBe(1);
  });
});
```

- [ ] **Step 3: Run the new tests**

```bash
pnpm -F api test -- payment-events
```

Expected: all pass.

- [ ] **Step 4: Wire the module into the webhook handler and app module**

`apps/api/src/webhooks/webhooks.module.ts` — add `PaymentEventsModule` to the imports list.

`apps/api/src/app.module.ts` — add `PaymentEventsModule` to the imports list.

`apps/api/src/webhooks/stripe-webhook.service.ts` — add to the imports block at the top:

```ts
import { PaymentEventKind } from '@organizer-hub/db/api';
import { PaymentEventsService } from '../payment-events/payment-events.service';
```

Add to the constructor:

```ts
  constructor(
    private readonly memberships: MembershipsService,
    private readonly prisma: PrismaService,
    private readonly stripeClient: StripeClient,
    private readonly stream: WaitlistStream,
    private readonly paymentEvents: PaymentEventsService,
  ) {}
```

Add a new branch to `handle()` (before the `SUBSCRIPTION_EVENTS` check):

```ts
    if (event.type === 'checkout.session.created') {
      return this.handleCheckoutCreated(event);
    }
```

Add the handler method (place after `handleCheckoutExpired`):

```ts
  // Insert a PENDING PaymentEvent row reflecting the session the user just
  // started. The kind is derived from metadata.source set in
  // checkout-session.factory.ts / billing.service.ts. PI may not yet be set
  // by Stripe at this point — that's fine, we resolve it on succeeded.
  private async handleCheckoutCreated(
    event: Stripe.Event,
  ): Promise<WebhookHandleResult> {
    const session = event.data.object as CheckoutSessionLike & {
      amount_total?: number | null;
      currency?: string | null;
    };
    const source = session.metadata?.source;
    const userId = session.metadata?.userId ?? session.client_reference_id;
    if (!source || !userId) {
      this.logger.debug(
        `checkout.session.created ${event.id} missing source/userId metadata; ignoring`,
      );
      return { recorded: false };
    }
    const kindMap: Record<string, PaymentEventKind> = {
      ticket: PaymentEventKind.TICKET,
      membership: PaymentEventKind.MEMBERSHIP,
      donation: PaymentEventKind.DONATION,
    };
    const kind = kindMap[source];
    if (!kind) {
      this.logger.warn(
        `checkout.session.created ${event.id} unknown source=${source}`,
      );
      return { recorded: false };
    }
    await this.paymentEvents.upsertPendingCharge(this.prisma, {
      userId,
      kind,
      amountCents: session.amount_total ?? 0,
      currency: session.currency ?? 'usd',
      stripeCustomerId: this.unwrapId(session.customer),
      stripePaymentIntentId: this.unwrapId(session.payment_intent),
      stripeCheckoutSessionId: session.id,
      ticketRequestId: session.metadata?.ticketRequestId ?? null,
    });
    return { recorded: false };
  }
```

- [ ] **Step 5: Subscribe to the new event type in the Stripe webhook endpoint**

Local dev: re-run `stripe listen --events checkout.session.created,checkout.session.completed,checkout.session.expired,payment_intent.succeeded,payment_intent.payment_failed,payment_intent.canceled,charge.refunded,charge.dispute.created,invoice.payment_succeeded,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.paid,invoice.payment_failed --forward-to localhost:3001/webhooks/stripe`.

(The production webhook endpoint config is out of scope for this plan — add a deployment doc note at the end of Phase B.)

- [ ] **Step 6: Run all api tests**

```bash
pnpm -F api test
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/payment-events apps/api/src/webhooks/stripe-webhook.service.ts apps/api/src/webhooks/webhooks.module.ts apps/api/src/app.module.ts
git commit -m "feat(api): PaymentEventsService and checkout.session.created handler

- new payment-events module with idempotent write helpers
  (upsertPendingCharge, finalizeCharge, insertRenewal, insertRefund,
  insertDispute) — all keyed on Stripe ids
- wire checkout.session.created into the webhook handler; insert a
  PENDING PaymentEvent row keyed on (stripe_payment_intent_id, kind)
  derived from metadata.source"
```

### U4: Transition `PENDING` rows on `payment_intent.*`

**Files:**
- Modify: `apps/api/src/webhooks/stripe-webhook.service.ts` (add three new branches in `handle()` and three handler methods)

- [ ] **Step 1: Add the three new branches in `handle()`**

After the `checkout.session.created` branch:

```ts
    if (
      event.type === 'payment_intent.succeeded' ||
      event.type === 'payment_intent.payment_failed' ||
      event.type === 'payment_intent.canceled'
    ) {
      return this.handlePaymentIntentTerminal(event);
    }
```

- [ ] **Step 2: Add the handler method**

```ts
  // Resolve the PENDING ledger row by PI and write its terminal status.
  // Ordering with checkout.session.completed: this is fine to fire either
  // before or after — the ticket/membership creation in completed sets
  // its own state; here we only touch the PaymentEvent row.
  private async handlePaymentIntentTerminal(
    event: Stripe.Event,
  ): Promise<WebhookHandleResult> {
    const pi = event.data.object as {
      id: string;
      last_payment_error?: { message?: string } | null;
    };
    if (event.type === 'payment_intent.succeeded') {
      await this.paymentEvents.finalizeCharge(this.prisma, pi.id, {
        status: PaymentEventStatus.SUCCEEDED,
        succeededAt: new Date(),
      });
    } else if (event.type === 'payment_intent.payment_failed') {
      await this.paymentEvents.finalizeCharge(this.prisma, pi.id, {
        status: PaymentEventStatus.FAILED,
        failureReason: pi.last_payment_error?.message ?? 'unknown',
      });
    } else {
      await this.paymentEvents.finalizeCharge(this.prisma, pi.id, {
        status: PaymentEventStatus.CANCELED,
        canceledAt: new Date(),
      });
    }
    return { recorded: false };
  }
```

Add `PaymentEventStatus` to the existing `@organizer-hub/db/api` import at the top of the file.

- [ ] **Step 3: Add tests in `stripe-webhook.service.spec.ts`** (or extend if it exists)

```ts
it('payment_intent.succeeded transitions PENDING row to SUCCEEDED', async () => {
  // arrange: insert a PENDING row, then dispatch event
  await prisma.paymentEvent.create({ data: { organizationId: HOUSE_ORG_ID, userId: 'u', kind: 'TICKET', status: 'PENDING', amountCents: 100, currency: 'usd', stripePaymentIntentId: 'pi_t', stripeCheckoutSessionId: 'cs_t' } });
  await service.handle({ id: 'evt_1', type: 'payment_intent.succeeded', data: { object: { id: 'pi_t' } } } as any);
  const row = await prisma.paymentEvent.findFirst({ where: { stripePaymentIntentId: 'pi_t' } });
  expect(row?.status).toBe('SUCCEEDED');
});
```

(Add analogous tests for `payment_failed` and `canceled`.)

- [ ] **Step 4: Run tests**

```bash
pnpm -F api test -- webhooks/stripe-webhook
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/webhooks/stripe-webhook.service.ts apps/api/src/webhooks/stripe-webhook.service.spec.ts
git commit -m "feat(api): transition PaymentEvent rows on payment_intent.*

- payment_intent.succeeded -> status=SUCCEEDED, succeededAt
- payment_intent.payment_failed -> status=FAILED, failureReason
- payment_intent.canceled -> status=CANCELED, canceledAt"
```

### U5: Refunds, disputes, renewals

**Files:**
- Modify: `apps/api/src/webhooks/stripe-webhook.service.ts` (three new branches + handlers)

- [ ] **Step 1: Add the three new branches in `handle()`**

```ts
    if (event.type === 'charge.refunded') {
      return this.handleChargeRefunded(event);
    }
    if (event.type === 'charge.dispute.created') {
      return this.handleChargeDisputed(event);
    }
    if (event.type === 'invoice.payment_succeeded') {
      return this.handleInvoicePaid(event);
    }
```

- [ ] **Step 2: Add the three handler methods**

```ts
  // For every Refund object on the Charge, insert one PaymentEvent row.
  // Idempotent on stripeRefundId — Stripe sends charge.refunded for every
  // refund created, including replays.
  private async handleChargeRefunded(
    event: Stripe.Event,
  ): Promise<WebhookHandleResult> {
    const charge = event.data.object as {
      id: string;
      currency: string;
      customer?: string | null;
      payment_intent?: string | null;
      metadata?: Record<string, string | undefined> | null;
      refunds?: { data: Array<{ id: string; amount: number }> } | null;
    };
    const userId = charge.metadata?.userId;
    const piId = charge.payment_intent;
    if (!userId || !piId) {
      this.logger.warn(`charge.refunded ${event.id} missing userId/PI; skipping`);
      return { recorded: false };
    }
    const refunds = charge.refunds?.data ?? [];
    for (const r of refunds) {
      await this.paymentEvents.insertRefund(this.prisma, {
        userId,
        amountCents: r.amount,
        currency: charge.currency,
        stripeCustomerId: charge.customer ?? null,
        stripePaymentIntentId: piId,
        stripeRefundId: r.id,
        stripeChargeId: charge.id,
      });
    }
    return { recorded: false };
  }

  private async handleChargeDisputed(
    event: Stripe.Event,
  ): Promise<WebhookHandleResult> {
    const dispute = event.data.object as {
      id: string;
      amount: number;
      currency: string;
      charge: string;
      payment_intent?: string | null;
      metadata?: Record<string, string | undefined> | null;
    };
    // Stripe sometimes doesn't propagate metadata onto the dispute — fall back
    // to looking up the charge.
    let userId = dispute.metadata?.userId;
    if (!userId) {
      try {
        const charge = await this.stripeClient.stripe.charges.retrieve(dispute.charge);
        userId = (charge.metadata as Record<string, string>)?.userId;
      } catch {
        // fall through to skip
      }
    }
    if (!userId) {
      this.logger.warn(`charge.dispute.created ${event.id} could not resolve userId; skipping`);
      return { recorded: false };
    }
    await this.paymentEvents.insertDispute(this.prisma, {
      userId,
      amountCents: dispute.amount,
      currency: dispute.currency,
      stripeChargeId: dispute.charge,
      stripePaymentIntentId: dispute.payment_intent ?? null,
      description: `Dispute ${dispute.id}`,
    });
    return { recorded: false };
  }

  // Subscription renewals. The first invoice for a new subscription rides
  // through checkout.session.completed -> a brand-new PaymentEvent row is
  // NOT created here for the first invoice (it was created on
  // session.created). For renewal invoices (the subscription already
  // existed), we insert a new MEMBERSHIP row keyed on PI.
  private async handleInvoicePaid(
    event: Stripe.Event,
  ): Promise<WebhookHandleResult> {
    const inv = event.data.object as {
      id: string;
      amount_paid: number;
      currency: string;
      customer: string;
      payment_intent?: string | null;
      subscription?: string | null;
      billing_reason?: string;
      metadata?: Record<string, string | undefined> | null;
    };
    // billing_reason='subscription_create' is the first invoice — skip,
    // session.created already inserted the row.
    if (inv.billing_reason === 'subscription_create') {
      return { recorded: false };
    }
    if (!inv.payment_intent) {
      this.logger.warn(`invoice.payment_succeeded ${event.id} has no PI; skipping`);
      return { recorded: false };
    }
    // Resolve userId from the subscription metadata stamped in U2.
    let userId: string | undefined = inv.metadata?.userId;
    if (!userId && inv.subscription) {
      try {
        const sub = await this.stripeClient.stripe.subscriptions.retrieve(inv.subscription);
        userId = (sub.metadata as Record<string, string>)?.userId;
      } catch {
        // fall through
      }
    }
    if (!userId) {
      this.logger.warn(`invoice.payment_succeeded ${event.id} could not resolve userId; skipping`);
      return { recorded: false };
    }
    await this.paymentEvents.insertRenewal(this.prisma, {
      userId,
      amountCents: inv.amount_paid,
      currency: inv.currency,
      stripeCustomerId: inv.customer,
      stripePaymentIntentId: inv.payment_intent,
      stripeInvoiceId: inv.id,
    });
    return { recorded: false };
  }
```

- [ ] **Step 3: Add tests for each handler**

`stripe-webhook.service.spec.ts` — three new `it(...)` blocks covering refund, dispute, and renewal happy paths plus one idempotency test (replay `charge.refunded` twice; assert exactly one REFUND row).

- [ ] **Step 4: Run tests**

```bash
pnpm -F api test
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/webhooks/stripe-webhook.service.ts apps/api/src/webhooks/stripe-webhook.service.spec.ts
git commit -m "feat(api): record refund / dispute / renewal PaymentEvent rows

- charge.refunded -> one REFUND row per Stripe Refund (negative amount,
  idempotent on stripeRefundId)
- charge.dispute.created -> one DISPUTE row (negative)
- invoice.payment_succeeded with billing_reason!=subscription_create
  -> one MEMBERSHIP renewal row keyed on PI"
```

---

## Phase C — Backfill

### U6: One-time backfill script

**Files:**
- Create: `apps/api/scripts/backfill-payment-events.ts`
- Modify: `apps/api/package.json` (add `"backfill:payment-events": "tsx scripts/backfill-payment-events.ts"`)

- [ ] **Step 1: Write the backfill script**

`apps/api/scripts/backfill-payment-events.ts`:

```ts
import { config } from 'dotenv';
import path from 'node:path';
config({ path: path.resolve(__dirname, '../../../.env') });
config({ path: path.resolve(__dirname, '../.env.local'), override: false });

import {
  PrismaClient,
  PaymentEventKind,
  PaymentEventStatus,
  TicketSource,
  TicketRequestStatus,
} from '@organizer-hub/db/api';

const HOUSE_ORG_ID = 'org_house_000000000000000001';
const dryRun = process.argv.includes('--dry-run');

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  let inserted = 0, skipped = 0;

  try {
    // 1. Paid Tickets -> TICKET rows
    const tickets = await prisma.ticket.findMany({
      where: { source: TicketSource.PAID, stripePaymentIntentId: { not: null } },
      select: {
        id: true, userId: true, stripeCheckoutSessionId: true, stripePaymentIntentId: true, issuedAt: true,
        ticketType: { select: { priceCents: true } },
      },
    });
    for (const t of tickets) {
      if (!t.stripePaymentIntentId) { skipped++; continue; }
      const exists = await prisma.paymentEvent.findFirst({
        where: { stripePaymentIntentId: t.stripePaymentIntentId, kind: { in: [PaymentEventKind.TICKET, PaymentEventKind.MEMBERSHIP, PaymentEventKind.DONATION] } },
      });
      if (exists) { skipped++; continue; }
      if (dryRun) { inserted++; continue; }
      await prisma.paymentEvent.create({
        data: {
          organizationId: HOUSE_ORG_ID, userId: t.userId, kind: PaymentEventKind.TICKET,
          status: PaymentEventStatus.SUCCEEDED, amountCents: t.ticketType.priceCents, currency: 'usd',
          stripePaymentIntentId: t.stripePaymentIntentId,
          stripeCheckoutSessionId: t.stripeCheckoutSessionId,
          ticketId: t.id, succeededAt: t.issuedAt,
        },
      });
      inserted++;
    }

    // 2. TicketRequests with Stripe session but no Ticket -> PENDING/CANCELED/FAILED TICKET rows
    const reqs = await prisma.ticketRequest.findMany({
      where: { stripeCheckoutSessionId: { not: null }, ticket: null },
      select: {
        id: true, userId: true, status: true, stripeCheckoutSessionId: true,
        ticketType: { select: { priceCents: true } },
      },
    });
    for (const r of reqs) {
      if (!r.stripeCheckoutSessionId) { skipped++; continue; }
      const exists = await prisma.paymentEvent.findFirst({
        where: { stripeCheckoutSessionId: r.stripeCheckoutSessionId, kind: PaymentEventKind.TICKET },
      });
      if (exists) { skipped++; continue; }
      const status: PaymentEventStatus =
        r.status === TicketRequestStatus.APPROVED ? PaymentEventStatus.PENDING :
        r.status === TicketRequestStatus.CANCELLED_BY_USER ? PaymentEventStatus.CANCELED :
        r.status === TicketRequestStatus.EXPIRED ? PaymentEventStatus.CANCELED :
        PaymentEventStatus.PENDING;
      if (dryRun) { inserted++; continue; }
      await prisma.paymentEvent.create({
        data: {
          organizationId: HOUSE_ORG_ID, userId: r.userId, kind: PaymentEventKind.TICKET,
          status, amountCents: r.ticketType.priceCents, currency: 'usd',
          stripeCheckoutSessionId: r.stripeCheckoutSessionId, ticketRequestId: r.id,
        },
      });
      inserted++;
    }

    // 3. Memberships -> one MEMBERSHIP row per subscription (most recent invoice)
    //    Historical renewals are NOT reconstructed in v1.
    const memberships = await prisma.membership.findMany({
      select: { id: true, userId: true, stripeCustomerId: true, stripeSubscriptionId: true, tier: true, updatedAt: true },
    });
    for (const m of memberships) {
      // Use the subscription id as the proxy PI key; live writes will use the
      // real PI. This is a best-effort backfill — the row appears in the
      // ledger but won't reconcile with Stripe by PI.
      const proxy = `backfill_sub_${m.stripeSubscriptionId}`;
      const exists = await prisma.paymentEvent.findFirst({
        where: { stripePaymentIntentId: proxy, kind: PaymentEventKind.MEMBERSHIP },
      });
      if (exists) { skipped++; continue; }
      if (dryRun) { inserted++; continue; }
      await prisma.paymentEvent.create({
        data: {
          organizationId: HOUSE_ORG_ID, userId: m.userId, kind: PaymentEventKind.MEMBERSHIP,
          status: PaymentEventStatus.SUCCEEDED, amountCents: 0, currency: 'usd',
          description: `Membership (${m.tier}) — historical`,
          stripeCustomerId: m.stripeCustomerId, stripePaymentIntentId: proxy,
          membershipId: m.id, succeededAt: m.updatedAt,
        },
      });
      inserted++;
    }

    // 4. RefundLog -> REFUND rows
    const refunds = await prisma.refundLog.findMany();
    for (const r of refunds) {
      const exists = await prisma.paymentEvent.findFirst({
        where: { stripeCheckoutSessionId: r.stripeCheckoutSessionId, kind: PaymentEventKind.REFUND },
      });
      if (exists) { skipped++; continue; }
      if (dryRun) { inserted++; continue; }
      await prisma.paymentEvent.create({
        data: {
          organizationId: HOUSE_ORG_ID, userId: 'backfill_unknown', kind: PaymentEventKind.REFUND,
          status: PaymentEventStatus.SUCCEEDED, amountCents: -r.amountCents, currency: 'usd',
          description: `Refund (${r.reason}) — historical`,
          stripeCheckoutSessionId: r.stripeCheckoutSessionId,
          stripePaymentIntentId: r.stripePaymentIntentId, succeededAt: r.createdAt,
        },
      });
      inserted++;
    }

    console.log(`${dryRun ? '[dry-run] ' : ''}inserted=${inserted} skipped=${skipped}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
```

- [ ] **Step 2: Wire up the script**

In `apps/api/package.json`, add to `"scripts"`:

```json
    "backfill:payment-events": "tsx scripts/backfill-payment-events.ts"
```

- [ ] **Step 3: Dry-run on local db**

```bash
pnpm -F api backfill:payment-events -- --dry-run
```

Expected: prints inserted/skipped counts; no rows actually written. Sanity-check the numbers against direct SQL counts (`SELECT COUNT(*) FROM tickets WHERE source='PAID';` etc).

- [ ] **Step 4: Real run**

```bash
pnpm -F api backfill:payment-events
```

- [ ] **Step 5: Verify**

```bash
psql $API_DATABASE_URL -c "SELECT kind, status, COUNT(*) FROM payment_events GROUP BY 1,2;"
```

Expected counts roughly match the source tables.

- [ ] **Step 6: Commit**

```bash
git add apps/api/scripts/backfill-payment-events.ts apps/api/package.json
git commit -m "feat(api): backfill payment_events from existing rows

- one-time idempotent script that derives PaymentEvent rows from
  Ticket (PAID), TicketRequest (with session), Membership, RefundLog
- supports --dry-run
- membership rows use a proxy 'backfill_sub_*' PI id; historical
  renewals are not reconstructed in v1"
```

---

## Phase D — API read paths

### U7: `PaymentEventsReadService` + DTOs

**Files:**
- Modify: `apps/api/src/payment-events/payment-events.module.ts` (export read service too)
- Create: `apps/api/src/payment-events/payment-events.read.service.ts`
- Create: `apps/api/src/payment-events/dto/query-payment-events.dto.ts`
- Create: `apps/api/src/payment-events/dto/payment-event-view.ts`

- [ ] **Step 1: Write the DTOs**

`apps/api/src/payment-events/dto/payment-event-view.ts`:

```ts
import type { PaymentEvent, PaymentEventKind, PaymentEventStatus } from '@organizer-hub/db/api';

export interface PaymentEventView {
  id: string;
  organizationId: string;
  userId: string;
  kind: PaymentEventKind;
  status: PaymentEventStatus;
  amountCents: number;
  currency: string;
  description: string | null;
  stripePaymentIntentId: string | null;
  stripeCheckoutSessionId: string | null;
  stripeInvoiceId: string | null;
  stripeRefundId: string | null;
  stripeChargeId: string | null;
  ticketId: string | null;
  ticketRequestId: string | null;
  membershipId: string | null;
  refundsPaymentIntentId: string | null;
  failureReason: string | null;
  succeededAt: string | null;
  canceledAt: string | null;
  createdAt: string;
}

export function toPaymentEventView(row: PaymentEvent): PaymentEventView {
  return {
    id: row.id,
    organizationId: row.organizationId,
    userId: row.userId,
    kind: row.kind,
    status: row.status,
    amountCents: row.amountCents,
    currency: row.currency,
    description: row.description,
    stripePaymentIntentId: row.stripePaymentIntentId,
    stripeCheckoutSessionId: row.stripeCheckoutSessionId,
    stripeInvoiceId: row.stripeInvoiceId,
    stripeRefundId: row.stripeRefundId,
    stripeChargeId: row.stripeChargeId,
    ticketId: row.ticketId,
    ticketRequestId: row.ticketRequestId,
    membershipId: row.membershipId,
    refundsPaymentIntentId: row.refundsPaymentIntentId,
    failureReason: row.failureReason,
    succeededAt: row.succeededAt?.toISOString() ?? null,
    canceledAt: row.canceledAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
```

`apps/api/src/payment-events/dto/query-payment-events.dto.ts`:

```ts
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { PaymentEventKind, PaymentEventStatus } from '@organizer-hub/db/api';

export class QueryPaymentEventsDto {
  @IsOptional() @IsString() cursor?: string;
  @Type(() => Number) @IsOptional() @IsInt() @Min(1) @Max(100) limit?: number = 20;
  @IsOptional() @IsEnum(PaymentEventKind) kind?: PaymentEventKind;
  @IsOptional() @IsEnum(PaymentEventStatus) status?: PaymentEventStatus;
  @IsOptional() @IsString() organizationId?: string; // admin only
  @IsOptional() @IsString() userEmail?: string;       // admin only
  @IsOptional() @IsString() from?: string;            // ISO date
  @IsOptional() @IsString() to?: string;
}
```

- [ ] **Step 2: Write the read service**

`apps/api/src/payment-events/payment-events.read.service.ts`:

```ts
import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { OrganizationRole, PaymentEventKind, Prisma } from '@organizer-hub/db/api';
import { PrismaService } from '../prisma/prisma.service';
import { QueryPaymentEventsDto } from './dto/query-payment-events.dto';
import { PaymentEventView, toPaymentEventView } from './dto/payment-event-view';

const WRITE_ROLES = new Set<OrganizationRole>([OrganizationRole.OWNER, OrganizationRole.ADMIN]);

@Injectable()
export class PaymentEventsReadService {
  constructor(private readonly prisma: PrismaService) {}

  // User-scoped list: caller sees only their own rows.
  async listForUser(userId: string, q: QueryPaymentEventsDto): Promise<{ items: PaymentEventView[]; nextCursor: string | null }> {
    const where: Prisma.PaymentEventWhereInput = { userId };
    if (q.kind) where.kind = q.kind;
    if (q.status) where.status = q.status;
    if (q.from || q.to) {
      where.createdAt = {};
      if (q.from) (where.createdAt as Prisma.DateTimeFilter).gte = new Date(q.from);
      if (q.to) (where.createdAt as Prisma.DateTimeFilter).lte = new Date(q.to);
    }
    return this.paginate(where, q);
  }

  // Admin-scoped list: requires WRITE_ROLES on the org. Reuses requireRole
  // shape from EventLabelsService.
  async listForAdmin(userId: string, q: QueryPaymentEventsDto): Promise<{ items: PaymentEventView[]; nextCursor: string | null }> {
    if (!q.organizationId) throw new ForbiddenException('organizationId required');
    await this.requireRole(userId, q.organizationId);
    const where: Prisma.PaymentEventWhereInput = { organizationId: q.organizationId };
    if (q.kind) where.kind = q.kind;
    if (q.status) where.status = q.status;
    if (q.from || q.to) {
      where.createdAt = {};
      if (q.from) (where.createdAt as Prisma.DateTimeFilter).gte = new Date(q.from);
      if (q.to) (where.createdAt as Prisma.DateTimeFilter).lte = new Date(q.to);
    }
    return this.paginate(where, q);
  }

  async getDetail(userId: string, id: string): Promise<PaymentEventView> {
    const row = await this.prisma.paymentEvent.findUnique({ where: { id } });
    if (!row) throw new NotFoundException();
    if (row.userId !== userId) {
      // Admin can read any row in their org
      try { await this.requireRole(userId, row.organizationId); }
      catch { throw new NotFoundException(); }
    }
    return toPaymentEventView(row);
  }

  // Returns an async iterable of view rows for CSV streaming, no pagination.
  async *adminStream(userId: string, organizationId: string, q: Omit<QueryPaymentEventsDto, 'cursor' | 'limit'>): AsyncGenerator<PaymentEventView> {
    await this.requireRole(userId, organizationId);
    const where: Prisma.PaymentEventWhereInput = { organizationId };
    if (q.kind) where.kind = q.kind;
    if (q.status) where.status = q.status;
    if (q.from || q.to) {
      where.createdAt = {};
      if (q.from) (where.createdAt as Prisma.DateTimeFilter).gte = new Date(q.from);
      if (q.to) (where.createdAt as Prisma.DateTimeFilter).lte = new Date(q.to);
    }
    const BATCH = 500;
    let cursor: string | undefined;
    while (true) {
      const rows = await this.prisma.paymentEvent.findMany({
        where, take: BATCH,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      for (const r of rows) yield toPaymentEventView(r);
      if (rows.length < BATCH) return;
      cursor = rows[rows.length - 1].id;
    }
  }

  private async paginate(where: Prisma.PaymentEventWhereInput, q: QueryPaymentEventsDto) {
    const take = q.limit ?? 20;
    const rows = await this.prisma.paymentEvent.findMany({
      where, take: take + 1,
      ...(q.cursor ? { skip: 1, cursor: { id: q.cursor } } : {}),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const hasMore = rows.length > take;
    const items = (hasMore ? rows.slice(0, -1) : rows).map(toPaymentEventView);
    return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
  }

  private async requireRole(userId: string, organizationId: string): Promise<void> {
    const m = await this.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { role: true },
    });
    if (!m) throw new NotFoundException();
    if (!WRITE_ROLES.has(m.role)) throw new ForbiddenException('insufficient role');
  }
}
```

- [ ] **Step 3: Update the module**

`apps/api/src/payment-events/payment-events.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PaymentEventsService } from './payment-events.service';
import { PaymentEventsReadService } from './payment-events.read.service';
import { PaymentEventsController } from './payment-events.controller';

@Module({
  imports: [PrismaModule],
  providers: [PaymentEventsService, PaymentEventsReadService],
  controllers: [PaymentEventsController],
  exports: [PaymentEventsService, PaymentEventsReadService],
})
export class PaymentEventsModule {}
```

(`PaymentEventsController` is added in U8.)

- [ ] **Step 4: Tests**

`apps/api/src/payment-events/payment-events.read.service.spec.ts` covers:
- user-scoped list returns only the caller's rows
- admin list requires membership with OWNER/ADMIN role (404 for non-member, 403 for MEMBER)
- pagination produces a `nextCursor` when more rows exist
- filter by `kind`, `status`, `from`, `to`

(Test code mirrors the EventLabelsService.spec patterns — see that file as a template.)

```bash
pnpm -F api test -- payment-events
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/payment-events
git commit -m "feat(api): payment-events read service + DTOs

- PaymentEventsReadService.listForUser / listForAdmin / getDetail
  with cursor pagination + (kind, status, date range) filters
- requireRole mirrors EventLabelsService (OWNER/ADMIN for admin reads;
  404 vs 403 vs 200 semantics)
- adminStream is an AsyncGenerator for CSV export in U8"
```

### U8: Controller + CSV endpoint

**Files:**
- Create: `apps/api/src/payment-events/payment-events.controller.ts`
- Modify: `packages/web-shared/src/api/payment-events.ts` (new — public typed client helpers)
- Modify: `apps/api/src/payment-events/payment-events.module.ts` (export controller)

- [ ] **Step 1: Write the controller**

`apps/api/src/payment-events/payment-events.controller.ts`:

```ts
import {
  Controller, Get, Param, Query, Req, Res, UseGuards, HttpStatus, HttpException,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PaymentEventsReadService } from './payment-events.read.service';
import { QueryPaymentEventsDto } from './dto/query-payment-events.dto';

interface AuthenticatedReq extends Request { user: { sub: string } }

@UseGuards(JwtAuthGuard)
@Controller()
export class PaymentEventsController {
  constructor(private readonly reads: PaymentEventsReadService) {}

  // Member surface: caller's own rows
  @Get('payment-events')
  async list(@Req() req: AuthenticatedReq, @Query() q: QueryPaymentEventsDto) {
    // If organizationId is supplied, route to the admin path
    if (q.organizationId) {
      return this.reads.listForAdmin(req.user.sub, q);
    }
    return this.reads.listForUser(req.user.sub, q);
  }

  @Get('payment-events/:id')
  async detail(@Req() req: AuthenticatedReq, @Param('id') id: string) {
    return this.reads.getDetail(req.user.sub, id);
  }

  // Admin CSV export. Streams rows; admin role is enforced inside the stream.
  @Get('transactions.csv')
  async csv(
    @Req() req: AuthenticatedReq,
    @Query() q: QueryPaymentEventsDto,
    @Res() res: Response,
  ): Promise<void> {
    if (!q.organizationId) throw new HttpException('organizationId required', HttpStatus.BAD_REQUEST);
    res.setHeader('content-type', 'text/csv');
    res.setHeader('content-disposition', `attachment; filename="transactions-${q.organizationId}.csv"`);
    const cols = ['id','createdAt','kind','status','amountCents','currency','userId','stripePaymentIntentId','stripeRefundId','stripeChargeId','description'];
    res.write(cols.join(',') + '\n');
    try {
      for await (const row of this.reads.adminStream(req.user.sub, q.organizationId, q)) {
        const line = cols.map((c) => csvEscape((row as Record<string, unknown>)[c])).join(',');
        res.write(line + '\n');
      }
    } finally {
      res.end();
    }
  }
}

function csvEscape(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
```

- [ ] **Step 2: Write the web-shared client**

`packages/web-shared/src/api/payment-events.ts`:

```ts
import type { PaymentEventView } from "../api/types";
import { apiFetch } from "../api/client";

export interface PaymentEventListPage {
  items: PaymentEventView[];
  nextCursor: string | null;
}

export interface ListPaymentEventsParams {
  cursor?: string;
  limit?: number;
  kind?: string;
  status?: string;
  organizationId?: string; // admin
  userEmail?: string;       // admin
  from?: string;
  to?: string;
}

export function listPaymentEvents(params: ListPaymentEventsParams = {}): Promise<PaymentEventListPage> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null) qs.set(k, String(v));
  return apiFetch<PaymentEventListPage>(`/payment-events?${qs.toString()}`);
}

export function getPaymentEvent(id: string): Promise<PaymentEventView> {
  return apiFetch<PaymentEventView>(`/payment-events/${encodeURIComponent(id)}`);
}
```

Add `PaymentEventView` to `packages/web-shared/src/api/types.ts` (export it alongside the existing view types — mirror the structure from `apps/api/src/payment-events/dto/payment-event-view.ts`). Re-export from `packages/web-shared/src/api/payment-events.ts` is not required; the existing `export type * from "./api/types"` line in `packages/web-shared/src/index.ts` picks it up automatically.

- [ ] **Step 3: e2e tests**

`apps/api/test/payment-events.e2e-spec.ts` covers:
- `GET /payment-events` as a regular user returns only own rows
- `GET /payment-events?organizationId=...` as an admin returns org rows
- `GET /payment-events?organizationId=...` as a non-member returns 404
- `GET /payment-events?organizationId=...` as a MEMBER (not OWNER/ADMIN) returns 403
- `GET /transactions.csv?organizationId=...` returns a `text/csv` body whose row count matches the underlying query

(Mirror `apps/api/test/event-labels.e2e-spec.ts` for setup helpers — signup a user, grant role, insert rows.)

```bash
pnpm -F api exec jest --config ./test/jest-e2e.json --runInBand --testPathPattern payment-events
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/payment-events/payment-events.controller.ts apps/api/src/payment-events/payment-events.module.ts apps/api/test/payment-events.e2e-spec.ts packages/web-shared/src/api/payment-events.ts packages/web-shared/src/api/types.ts
git commit -m "feat(api): payment-events controller + CSV export

- GET /payment-events (user or admin via organizationId param)
- GET /payment-events/:id (member-or-admin gated)
- GET /transactions.csv (admin streaming export)
- packages/web-shared exposes typed listPaymentEvents/getPaymentEvent"
```

---

## Phase E — Admin /transactions UI

### U9: Admin transactions page + filter chips

**Files:**
- Create: `apps/admin/src/app/transactions/page.tsx`
- Create: `apps/admin/src/app/transactions/TransactionsTable.tsx`
- Create: `apps/admin/src/app/transactions/Filters.tsx`
- Modify: `apps/admin/src/app/layout.tsx` or wherever the admin nav lives — add "Transactions" link

- [ ] **Step 1: Server page**

`apps/admin/src/app/transactions/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import {
  ApiError,
  UnauthorizedError,
  getHouseOrgId,
  listPaymentEvents,
  type PaymentEventListPage,
} from "@organizer-hub/web-shared";
import TransactionsTable from "./TransactionsTable";
import Filters from "./Filters";

interface SearchParams {
  cursor?: string;
  kind?: string;
  status?: string;
  userEmail?: string;
  from?: string;
  to?: string;
}

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const orgId = getHouseOrgId();
  const params = await searchParams;
  let page: PaymentEventListPage;
  try {
    page = await listPaymentEvents({ organizationId: orgId, ...params });
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login");
    if (err instanceof ApiError && err.status === 404) {
      page = { items: [], nextCursor: null };
    } else {
      throw err;
    }
  }
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Transactions</h1>
        <p className="mt-1 text-sm text-zinc-500">All payments, refunds, and disputes mirrored from Stripe.</p>
      </div>
      <Filters params={params} orgId={orgId} />
      <TransactionsTable items={page.items} nextCursor={page.nextCursor} params={params} />
    </div>
  );
}
```

- [ ] **Step 2: Filters component**

`apps/admin/src/app/transactions/Filters.tsx`:

```tsx
"use client";
import Link from "next/link";

const KINDS = ["TICKET", "MEMBERSHIP", "DONATION", "REFUND", "DISPUTE"] as const;
const STATUSES = ["PENDING", "SUCCEEDED", "FAILED", "CANCELED"] as const;

export default function Filters({ params, orgId }: { params: Record<string, string | undefined>; orgId: string }) {
  function hrefWith(key: string, value: string | undefined) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v && k !== key) qs.set(k, v);
    if (value) qs.set(key, value);
    qs.delete("cursor");
    return `/transactions?${qs.toString()}`;
  }
  const csvHref = (() => {
    const qs = new URLSearchParams({ organizationId: orgId });
    for (const [k, v] of Object.entries(params)) if (v && k !== "cursor") qs.set(k, v);
    return `${process.env.NEXT_PUBLIC_API_URL}/transactions.csv?${qs.toString()}`;
  })();
  return (
    <div className="mb-6 space-y-3">
      <div className="flex flex-wrap gap-2">
        <Chip href={hrefWith("kind", undefined)} active={!params.kind}>All kinds</Chip>
        {KINDS.map((k) => (
          <Chip key={k} href={hrefWith("kind", k)} active={params.kind === k}>{k}</Chip>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Chip href={hrefWith("status", undefined)} active={!params.status}>All statuses</Chip>
        {STATUSES.map((s) => (
          <Chip key={s} href={hrefWith("status", s)} active={params.status === s}>{s}</Chip>
        ))}
      </div>
      <a href={csvHref} download className="inline-block text-xs font-medium text-blue-600 hover:underline">Export CSV →</a>
    </div>
  );
}

function Chip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`rounded-full px-3 py-1 text-xs font-medium border ${
        active
          ? "bg-zinc-900 text-white border-zinc-900 dark:bg-zinc-50 dark:text-zinc-900"
          : "bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-200 dark:border-zinc-800"
      }`}
    >
      {children}
    </Link>
  );
}
```

- [ ] **Step 3: Table component**

`apps/admin/src/app/transactions/TransactionsTable.tsx`:

```tsx
import Link from "next/link";
import type { PaymentEventView } from "@organizer-hub/web-shared";

function fmtAmount(cents: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleString();
}

export default function TransactionsTable({
  items,
  nextCursor,
  params,
}: {
  items: PaymentEventView[];
  nextCursor: string | null;
  params: Record<string, string | undefined>;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-zinc-500">No transactions match the current filters.</p>;
  }
  const nextHref = (() => {
    if (!nextCursor) return null;
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v && k !== "cursor") qs.set(k, v);
    qs.set("cursor", nextCursor);
    return `/transactions?${qs.toString()}`;
  })();
  return (
    <div>
      <ul className="divide-y divide-zinc-200 dark:divide-zinc-800 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        {items.map((p) => (
          <li key={p.id} className="px-5 py-4 grid grid-cols-[100px_1fr_120px_100px_140px] items-baseline gap-4">
            <span className="text-xs text-zinc-500">{fmtDate(p.createdAt)}</span>
            <span className="text-sm truncate">{p.description ?? `${p.kind} ${p.stripePaymentIntentId ?? ""}`}</span>
            <span className="text-xs uppercase tracking-wide text-zinc-500">{p.kind}</span>
            <StatusBadge status={p.status} />
            <span className={`text-sm text-right font-mono ${p.amountCents < 0 ? "text-red-600" : "text-zinc-900 dark:text-zinc-50"}`}>{fmtAmount(p.amountCents, p.currency)}</span>
          </li>
        ))}
      </ul>
      {nextHref && (
        <div className="mt-4">
          <Link href={nextHref} className="text-sm text-blue-600 hover:underline">Next page →</Link>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "SUCCEEDED" ? "bg-green-100 text-green-800" :
    status === "PENDING"   ? "bg-amber-100 text-amber-800" :
    status === "FAILED"    ? "bg-red-100 text-red-800" :
                              "bg-zinc-100 text-zinc-700";
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{status}</span>;
}
```

- [ ] **Step 4: Add nav link**

In `apps/admin/src/app/layout.tsx`, after the existing `<Link href="/requests">Waitlist</Link>` block (around line 51), add:

```tsx
              <Link
                href="/transactions"
                className="text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-50 transition"
              >
                Transactions
              </Link>
```

- [ ] **Step 5: Verify build + lint**

```bash
pnpm -F admin typecheck && pnpm -F admin lint && pnpm -F admin build
```

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/app/transactions apps/admin/src/app/layout.tsx
git commit -m "feat(admin): /transactions page with filters and CSV export

- server-rendered list of payment_events for the house org, filterable
  by kind and status; cursor pagination
- 'Export CSV' link points at GET /transactions.csv on the api
- adds 'Transactions' to the admin nav"
```

---

## Phase F — Member /dashboard/payments UI

### U10: Member payments page

**Files:**
- Create: `apps/member/src/app/dashboard/payments/page.tsx`
- Create: `apps/member/src/app/dashboard/payments/PaymentsList.tsx`
- Modify: `apps/member/src/app/dashboard/page.tsx` (add a fourth card linking to /dashboard/payments)

- [ ] **Step 1: Server page**

`apps/member/src/app/dashboard/payments/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import {
  ApiError, UnauthorizedError, listPaymentEvents,
  type PaymentEventListPage,
} from "@organizer-hub/web-shared";
import PaymentsList from "./PaymentsList";

interface SearchParams { cursor?: string; kind?: string }

export default async function MyPaymentsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  let page: PaymentEventListPage;
  try {
    page = await listPaymentEvents(params);
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login");
    if (err instanceof ApiError && err.status === 404) {
      page = { items: [], nextCursor: null };
    } else {
      throw err;
    }
  }
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">My payments</h1>
        <p className="mt-1 text-sm text-zinc-500">Every charge, renewal, refund, and dispute on your account.</p>
      </div>
      <PaymentsList items={page.items} nextCursor={page.nextCursor} params={params} />
    </div>
  );
}
```

- [ ] **Step 2: List component**

`apps/member/src/app/dashboard/payments/PaymentsList.tsx`:

```tsx
import Link from "next/link";
import type { PaymentEventView } from "@organizer-hub/web-shared";

function fmtAmount(cents: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
function kindLabel(kind: string) {
  return ({
    TICKET: "Ticket",
    MEMBERSHIP: "Membership",
    DONATION: "Donation",
    REFUND: "Refund",
    DISPUTE: "Dispute",
  } as const)[kind as "TICKET"] ?? kind;
}

export default function PaymentsList({
  items,
  nextCursor,
  params,
}: {
  items: PaymentEventView[];
  nextCursor: string | null;
  params: Record<string, string | undefined>;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-zinc-500">No payments yet.</p>;
  }
  const nextHref = (() => {
    if (!nextCursor) return null;
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v && k !== "cursor") qs.set(k, v);
    qs.set("cursor", nextCursor);
    return `/dashboard/payments?${qs.toString()}`;
  })();
  return (
    <div>
      <ul className="divide-y divide-zinc-200 dark:divide-zinc-800 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        {items.map((p) => (
          <li key={p.id} className="px-5 py-4 grid grid-cols-[110px_1fr_100px_120px] items-baseline gap-4">
            <span className="text-xs text-zinc-500">{fmtDate(p.createdAt)}</span>
            <span className="text-sm">
              <span className="font-medium text-zinc-900 dark:text-zinc-50">{kindLabel(p.kind)}</span>
              {p.description ? <span className="text-zinc-500"> — {p.description}</span> : null}
            </span>
            <StatusBadge status={p.status} />
            <span className={`text-sm text-right font-mono ${p.amountCents < 0 ? "text-red-600" : "text-zinc-900 dark:text-zinc-50"}`}>
              {fmtAmount(p.amountCents, p.currency)}
            </span>
          </li>
        ))}
      </ul>
      {nextHref && (
        <div className="mt-4">
          <Link href={nextHref} className="text-sm text-blue-600 hover:underline">Next page →</Link>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "SUCCEEDED" ? "bg-green-100 text-green-800" :
    status === "PENDING"   ? "bg-amber-100 text-amber-800" :
    status === "FAILED"    ? "bg-red-100 text-red-800" :
                              "bg-zinc-100 text-zinc-700";
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{status}</span>;
}
```

- [ ] **Step 3: Link the page from the dashboard home**

In `apps/member/src/app/dashboard/page.tsx`, find the three-card grid (Membership / My requests / Browse) and append a fourth `<Card title="Payments">…<Link href="/dashboard/payments">View all →</Link></Card>`.

- [ ] **Step 4: Verify build**

```bash
pnpm -F member typecheck && pnpm -F member lint && pnpm -F member build
```

- [ ] **Step 5: Commit**

```bash
git add apps/member/src/app/dashboard/payments apps/member/src/app/dashboard/page.tsx
git commit -m "feat(member): /dashboard/payments page and dashboard card

- server-rendered list of the signed-in user's payment_events with
  date / description / status / amount; cursor pagination + kind
  filter
- new 'Payments' card on the dashboard home"
```

---

## End-to-end verification

After all units land:

- [ ] Boot the four-app stack and seed.
- [ ] Sign up a fresh user; `pnpm setup:owner you@example.com`.
- [ ] As that user, sign in to member, buy a ticket via Stripe test card `4242 4242 4242 4242`.
  - Expect: a SUCCEEDED `TICKET` row appears in `/dashboard/payments` and `/transactions`.
- [ ] Subscribe to a membership.
  - Expect: a SUCCEEDED `MEMBERSHIP` row.
- [ ] Trigger a renewal in the Stripe Dashboard ("Charge now" on the subscription).
  - Expect: a second `MEMBERSHIP` row keyed on the renewal PI.
- [ ] Refund the ticket purchase in the Stripe Dashboard.
  - Expect: a SUCCEEDED `REFUND` row with negative amount.
- [ ] Open a test dispute (`stripe trigger charge.dispute.created`).
  - Expect: a `DISPUTE` row.
- [ ] Replay any webhook event via `stripe events resend evt_…`.
  - Expect: row counts unchanged.
- [ ] Export the admin CSV and confirm row count matches `SELECT COUNT(*) FROM payment_events`.

## Production notes

- The Stripe webhook endpoint in the production dashboard must subscribe to the new event types added in Phase B: `checkout.session.created`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`, `charge.refunded`, `charge.dispute.created`, `invoice.payment_succeeded`. Existing subscribers stay.
- Re-run the backfill (`pnpm -F api backfill:payment-events`) in prod after the migration applies and before announcing the read surface.
