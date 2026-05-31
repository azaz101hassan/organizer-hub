import { Injectable, Logger } from '@nestjs/common';
import {
  PaymentEventKind,
  Prisma,
  TicketRequestStatus,
  TicketSource,
} from '@organizer-hub/db/api';
import { MembershipsService } from '../memberships/memberships.service';
import { PrismaService } from '../prisma/prisma.service';
import { StripeClient } from '../billing/stripe.client';
import { recordProcessedWebhookEvent } from '../billing/webhook-event.helper';
import { PaymentEventsService } from '../payment-events/payment-events.service';
import { WaitlistStream } from '../realtime/waitlist-stream';
import type { Stripe } from '../billing/stripe-types';

// Subscription-relevant events all converge on syncStripeData. checkout
// completions branch on session.mode — 'subscription' goes through the
// same sync, 'payment' issues a Ticket row.
const SUBSCRIPTION_EVENTS = new Set([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
]);

const COMPLETED = 'checkout.session.completed';

interface CheckoutSessionLike {
  id: string;
  mode?: 'subscription' | 'payment' | 'setup' | null;
  customer?: string | { id: string } | null;
  client_reference_id?: string | null;
  payment_intent?: string | { id: string } | null;
  metadata?: Record<string, string | undefined> | null;
}

// `recorded: true` means the service already wrote the WebhookEvent dedupe row
// (the payment issuance tx, or the dead-request refund branch). The controller
// then skips recording so the row is never written twice.
export interface WebhookHandleResult {
  recorded: boolean;
}

// Row shape from the FOR UPDATE re-read of a waitlist request + its event/tier.
interface LockedWaitlistRow {
  id: string;
  status: string;
  user_id: string;
  ticket_type_id: string;
  event_id: string;
  organization_id: string;
  starts_at: Date;
  price_cents: number;
}

type ReconcileOutcome =
  | { kind: 'issued'; ctx: LockedWaitlistRow }
  | { kind: 'already_issued'; ctx: LockedWaitlistRow }
  | { kind: 'dead'; reason: string; ctx: LockedWaitlistRow | null };

@Injectable()
export class StripeWebhookService {
  private readonly logger = new Logger(StripeWebhookService.name);

  constructor(
    private readonly memberships: MembershipsService,
    private readonly prisma: PrismaService,
    private readonly stripeClient: StripeClient,
    private readonly stream: WaitlistStream,
    private readonly paymentEvents: PaymentEventsService,
  ) {}

  async handle(event: Stripe.Event): Promise<WebhookHandleResult> {
    if (event.type === COMPLETED) {
      return this.handleCheckoutCompleted(event);
    }
    if (event.type === 'checkout.session.expired') {
      return this.handleCheckoutExpired(event);
    }

    if ((event.type as string) === 'checkout.session.created') {
      return this.handleCheckoutCreated(event);
    }

    if (SUBSCRIPTION_EVENTS.has(event.type)) {
      const customerId = this.extractCustomerId(event);
      if (!customerId) {
        this.logger.warn(
          `${event.type} ${event.id} has no resolvable customer id; skipping sync`,
        );
        return { recorded: false };
      }
      await this.memberships.syncStripeData(customerId);
      return { recorded: false };
    }

    this.logger.debug(`Ignoring event type ${event.type}`);
    return { recorded: false };
  }

  private async handleCheckoutCompleted(
    event: Stripe.Event,
  ): Promise<WebhookHandleResult> {
    const session = event.data.object as CheckoutSessionLike;
    const customerId = this.unwrapId(session.customer);

    if (session.mode === 'payment') {
      return this.issueTicketFromSession(event.id, session);
    }

    // 'subscription' mode (and the legacy/unset case) flow through the
    // same membership sync as the subscription.* events.
    if (!customerId) {
      this.logger.warn(
        `checkout.session.completed ${event.id} has no customer id; skipping sync`,
      );
      return { recorded: false };
    }
    await this.memberships.syncStripeData(customerId);
    return { recorded: false };
  }

  // A waitlist session is identified by the server-written stripeCheckoutSessionId
  // back-link on a TicketRequest (authoritative — never the metadata flag alone,
  // so a metadata-stripped waitlist session can't fall through to the
  // unconditional path). With a back-link it goes through the row-locked
  // reconciliation; without one it is an under-cap direct purchase (unchanged
  // Phase 3 path).
  private async issueTicketFromSession(
    webhookEventId: string,
    session: CheckoutSessionLike,
  ): Promise<WebhookHandleResult> {
    const waitlist = await this.prisma.ticketRequest.findUnique({
      where: { stripeCheckoutSessionId: session.id },
      select: { id: true },
    });
    if (waitlist) {
      return this.reconcileWaitlistPayment(webhookEventId, session);
    }
    await this.issueDirectTicket(webhookEventId, session);
    return { recorded: false };
  }

  // Waitlist reconciliation (R24, R25, AE11, AE16): inside one tx, SELECT … FOR
  // UPDATE the request row and issue a Ticket ONLY IF it is still APPROVED and
  // the event has not started; otherwise issue nothing. The dedupe row is
  // recorded inside the same tx on the issue branch. On the dead-request
  // branch the refund runs FIRST (commit-then-refund, idempotency-keyed), then
  // the durable RefundLog, then the dedupe row last — so a crash anywhere
  // before the dedupe row leaves Stripe to redeliver and safely retry.
  private async reconcileWaitlistPayment(
    webhookEventId: string,
    session: CheckoutSessionLike,
  ): Promise<WebhookHandleResult> {
    const metaUserId = session.metadata?.userId;
    const metaTicketRequestId = session.metadata?.ticketRequestId;
    const clientRef = session.client_reference_id;
    const paymentIntentId = this.unwrapId(session.payment_intent);

    // client_reference_id is server-set and must match metadata.userId; a
    // mismatch is tampering — refund without ever touching the request.
    if (clientRef != null && metaUserId && clientRef !== metaUserId) {
      this.logger.error(
        `${COMPLETED} ${webhookEventId} session ${session.id} client_reference_id mismatch (ref=${clientRef} meta=${metaUserId}); refunding`,
      );
      await this.refundDeadRequest(
        paymentIntentId,
        session.id,
        null,
        0,
        'client_ref_mismatch',
      );
      await recordProcessedWebhookEvent(this.prisma, webhookEventId, COMPLETED);
      return { recorded: true };
    }

    const now = new Date();
    const outcome = await this.prisma.$transaction(
      async (tx): Promise<ReconcileOutcome> => {
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
        if (!locked) {
          return { kind: 'dead', reason: 'request_not_found', ctx: null };
        }
        if (metaUserId && locked.user_id !== metaUserId) {
          return { kind: 'dead', reason: 'user_mismatch', ctx: locked };
        }
        if (metaTicketRequestId && metaTicketRequestId !== locked.id) {
          return { kind: 'dead', reason: 'request_id_mismatch', ctx: locked };
        }
        const payable = locked.status === 'APPROVED' && locked.starts_at > now;
        if (!payable) {
          return {
            kind: 'dead',
            reason:
              locked.status !== 'APPROVED'
                ? `not_payable_${locked.status.toLowerCase()}`
                : 'event_started',
            ctx: locked,
          };
        }
        try {
          await tx.ticket.create({
            data: {
              userId: locked.user_id,
              eventId: locked.event_id,
              ticketTypeId: locked.ticket_type_id,
              source: TicketSource.PAID,
              ticketRequestId: locked.id,
              stripeCheckoutSessionId: session.id,
              stripePaymentIntentId: paymentIntentId,
            },
          });
          await recordProcessedWebhookEvent(tx, webhookEventId, COMPLETED);
          return { kind: 'issued', ctx: locked };
        } catch (err) {
          if (
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === 'P2002'
          ) {
            // Redelivery after the Ticket already exists — not a refund case.
            return { kind: 'already_issued', ctx: locked };
          }
          throw err;
        }
      },
    );

    if (outcome.kind === 'dead') {
      this.logger.error(
        `${COMPLETED} ${webhookEventId} session ${session.id} completed against a non-payable request (${outcome.reason}); refunding`,
      );
      await this.refundDeadRequest(
        paymentIntentId,
        session.id,
        outcome.ctx?.id ?? null,
        outcome.ctx?.price_cents ?? 0,
        outcome.reason,
      );
      await recordProcessedWebhookEvent(this.prisma, webhookEventId, COMPLETED);
    }
    return { recorded: true };
  }

  // commit-then-refund: refund first (idempotency key → at most one real refund
  // across redeliveries), then the durable RefundLog (UPSERT on the unique
  // session id → one record), then the caller records the dedupe row.
  private async refundDeadRequest(
    paymentIntentId: string | null,
    sessionId: string,
    ticketRequestId: string | null,
    amountCents: number,
    reason: string,
  ): Promise<void> {
    if (paymentIntentId) {
      try {
        await this.stripeClient.stripe.refunds.create(
          { payment_intent: paymentIntentId },
          { idempotencyKey: `waitlist-refund-${sessionId}` },
        );
      } catch (err) {
        this.logger.error(
          `Auto-refund failed for session ${sessionId} (pi ${paymentIntentId}): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    try {
      await this.prisma.refundLog.upsert({
        where: { stripeCheckoutSessionId: sessionId },
        create: {
          stripeCheckoutSessionId: sessionId,
          stripePaymentIntentId: paymentIntentId,
          ticketRequestId,
          reason,
          amountCents,
        },
        update: {},
      });
    } catch (err) {
      this.logger.error(
        `Failed to record RefundLog for session ${sessionId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    this.logger.warn(
      `Auto-refunded dead-request payment for session ${sessionId} (reason=${reason})`,
    );
  }

  // checkout.session.expired (R18): the PAID Checkout link lapsed unpaid. CAS
  // APPROVED -> EXPIRED and emit; no email. The scheduler (U9) is a backstop if
  // this event is missed. A non-waitlist (membership) expiry is a no-op here.
  private async handleCheckoutExpired(
    event: Stripe.Event,
  ): Promise<WebhookHandleResult> {
    const session = event.data.object as CheckoutSessionLike;
    const req = await this.prisma.ticketRequest.findUnique({
      where: { stripeCheckoutSessionId: session.id },
      include: { event: { select: { organizationId: true } } },
    });
    if (!req) return { recorded: false };

    const { count } = await this.prisma.ticketRequest.updateMany({
      where: { id: req.id, status: TicketRequestStatus.APPROVED },
      data: { status: TicketRequestStatus.EXPIRED },
    });
    if (count === 1) {
      this.stream.emit(req.event.organizationId, {
        type: 'request.updated',
        id: req.id,
        data: { id: req.id, status: TicketRequestStatus.EXPIRED },
      });
    }
    return { recorded: false };
  }

  // Insert a PENDING PaymentEvent row reflecting the session the user just
  // started. The kind is derived from metadata.source set on the Checkout
  // Session at creation time. PI may not yet be set by Stripe at this
  // point — that's fine, we resolve it on succeeded.
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

  // Under-cap direct purchase → Ticket row (unchanged Phase 3 path). Cross-
  // validates metadata.userId vs client_reference_id (tamper check), re-fetches
  // the TicketType to confirm existence + eventId match, then issues. Any
  // integrity mismatch logs + auto-refunds.
  private async issueDirectTicket(
    eventId: string,
    session: CheckoutSessionLike,
  ): Promise<void> {
    const metaUserId = session.metadata?.userId;
    const metaEventId = session.metadata?.eventId;
    const metaTicketTypeId = session.metadata?.ticketTypeId;
    const clientRef = session.client_reference_id;
    const paymentIntentId = this.unwrapId(session.payment_intent);

    if (!metaUserId || !metaEventId || !metaTicketTypeId) {
      this.logger.warn(
        `checkout.session.completed ${eventId} payment-mode session ${session.id} missing required metadata; not issuing`,
      );
      return;
    }
    if (
      clientRef !== undefined &&
      clientRef !== null &&
      clientRef !== metaUserId
    ) {
      this.logger.error(
        `checkout.session.completed ${eventId} session ${session.id} client_reference_id mismatch (ref=${clientRef} meta=${metaUserId}); refunding`,
      );
      await this.tryRefund(paymentIntentId);
      return;
    }

    const ticketType = await this.prisma.ticketType.findUnique({
      where: { id: metaTicketTypeId },
      select: { id: true, eventId: true },
    });
    if (!ticketType) {
      this.logger.warn(
        `checkout.session.completed ${eventId} references deleted TicketType ${metaTicketTypeId}; not issuing`,
      );
      return;
    }
    if (ticketType.eventId !== metaEventId) {
      this.logger.error(
        `checkout.session.completed ${eventId} eventId mismatch (ticketType.eventId=${ticketType.eventId} meta=${metaEventId}); refunding`,
      );
      await this.tryRefund(paymentIntentId);
      return;
    }

    try {
      await this.prisma.ticket.create({
        data: {
          userId: metaUserId,
          eventId: metaEventId,
          ticketTypeId: metaTicketTypeId,
          source: TicketSource.PAID,
          stripeCheckoutSessionId: session.id,
          stripePaymentIntentId: paymentIntentId,
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        // Either the same checkout.session.completed got redelivered, or
        // a separate session somehow reused the same payment_intent. Both
        // collapse to "the ticket already exists" — ack 200 quietly.
        this.logger.log(
          `Ticket for session ${session.id} already issued; treating as duplicate`,
        );
        return;
      }
      throw err;
    }
  }

  private async tryRefund(paymentIntentId: string | null): Promise<void> {
    if (!paymentIntentId) return;
    try {
      await this.stripeClient.stripe.refunds.create({
        payment_intent: paymentIntentId,
      });
    } catch (err) {
      this.logger.error(
        `Auto-refund failed for payment_intent ${paymentIntentId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  // Pull the Stripe customer id out of an event's data.object regardless of
  // its concrete type. Subscriptions, Customers, Checkout Sessions, and
  // Invoices all carry `customer` as either a string id or an expanded
  // object. We normalize to string-or-null.
  private extractCustomerId(event: Stripe.Event): string | null {
    const obj = event.data.object as {
      customer?: string | { id: string } | null;
    };
    return this.unwrapId(obj.customer);
  }

  private unwrapId(
    field: string | { id: string } | null | undefined,
  ): string | null {
    if (!field) return null;
    if (typeof field === 'string') return field;
    return field.id ?? null;
  }
}
