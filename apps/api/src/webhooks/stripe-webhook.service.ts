import { Injectable, Logger } from '@nestjs/common';
import { Prisma, TicketSource } from '@organizer-hub/db/api';
import { MembershipsService } from '../memberships/memberships.service';
import { PrismaService } from '../prisma/prisma.service';
import { StripeClient } from '../billing/stripe.client';
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

interface CheckoutSessionLike {
  id: string;
  mode?: 'subscription' | 'payment' | 'setup' | null;
  customer?: string | { id: string } | null;
  client_reference_id?: string | null;
  payment_intent?: string | { id: string } | null;
  metadata?: Record<string, string | undefined> | null;
}

@Injectable()
export class StripeWebhookService {
  private readonly logger = new Logger(StripeWebhookService.name);

  constructor(
    private readonly memberships: MembershipsService,
    private readonly prisma: PrismaService,
    private readonly stripeClient: StripeClient,
  ) {}

  async handle(event: Stripe.Event): Promise<void> {
    if (event.type === 'checkout.session.completed') {
      await this.handleCheckoutCompleted(event);
      return;
    }

    if (SUBSCRIPTION_EVENTS.has(event.type)) {
      const customerId = this.extractCustomerId(event);
      if (!customerId) {
        this.logger.warn(
          `${event.type} ${event.id} has no resolvable customer id; skipping sync`,
        );
        return;
      }
      await this.memberships.syncStripeData(customerId);
      return;
    }

    this.logger.debug(`Ignoring event type ${event.type}`);
  }

  private async handleCheckoutCompleted(event: Stripe.Event): Promise<void> {
    const session = event.data.object as CheckoutSessionLike;
    const customerId = this.unwrapId(session.customer);

    if (session.mode === 'payment') {
      await this.issueTicketFromSession(event.id, session);
      return;
    }

    // 'subscription' mode (and the legacy/unset case) flow through the
    // same membership sync as the subscription.* events.
    if (!customerId) {
      this.logger.warn(
        `checkout.session.completed ${event.id} has no customer id; skipping sync`,
      );
      return;
    }
    await this.memberships.syncStripeData(customerId);
  }

  // Payment-mode session → Ticket row. We cross-validate that the metadata
  // userId matches client_reference_id (a tamper check; both are set by the
  // server when we create the session), then re-fetch the TicketType from
  // the DB to confirm it still exists and that eventId matches what the
  // session was created with. Any mismatch logs and triggers an auto-refund
  // — the only safe response when the integrity check fails.
  private async issueTicketFromSession(
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
