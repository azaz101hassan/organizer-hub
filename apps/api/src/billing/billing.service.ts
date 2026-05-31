import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventStatus, Prisma, TicketSource } from '@organizer-hub/db/api';
import { PrismaService } from '../prisma/prisma.service';
import { atCap } from '../tickets/capacity';
import { CheckoutSessionFactory } from './checkout-session.factory';
import { StripeClient } from './stripe.client';

export interface BillingCustomerView {
  userId: string;
  stripeCustomerId: string;
}

export interface CheckoutSessionView {
  id: string;
  url: string;
}

// Result of the pre-session intake gates: enough for the controller to branch
// into a Phase 3 checkout (under cap) or a waitlist request (at cap) without
// BillingService having to know about ticket-requests.
export interface TicketIntakeEvaluation {
  ticketType: { id: string; eventId: string; organizationId: string };
  atCap: boolean;
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeClient: StripeClient,
    private readonly config: ConfigService,
    private readonly checkoutSessions: CheckoutSessionFactory,
  ) {}

  // Lazy Stripe Customer creation. First-checkout flow calls this; on cold
  // path it creates the Stripe Customer + the local mapping row. On warm
  // path it just returns the mapping.
  //
  // Stripe-side idempotency key (deterministic on userSub) protects against
  // a true race where two concurrent first-checkouts for the same user both
  // call stripe.customers.create — Stripe collapses them into one Customer.
  // The local prisma.create P2002 path then becomes a pure no-op recovery:
  // re-read the winning row and return it.
  async getOrCreateStripeCustomer(
    userSub: string,
    email?: string,
  ): Promise<BillingCustomerView> {
    const existing = await this.prisma.billingCustomer.findUnique({
      where: { userId: userSub },
    });
    if (existing) {
      return {
        userId: existing.userId,
        stripeCustomerId: existing.stripeCustomerId,
      };
    }

    const customer = await this.stripeClient.stripe.customers.create(
      {
        email,
        metadata: { userId: userSub },
      },
      { idempotencyKey: `billing-customer-create-${userSub}` },
    );

    try {
      const row = await this.prisma.billingCustomer.create({
        data: { userId: userSub, stripeCustomerId: customer.id },
      });
      return { userId: row.userId, stripeCustomerId: row.stripeCustomerId };
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        // Race-recovery: a concurrent call landed the row first. Re-read.
        const winner = await this.prisma.billingCustomer.findUnique({
          where: { userId: userSub },
        });
        if (winner) {
          return {
            userId: winner.userId,
            stripeCustomerId: winner.stripeCustomerId,
          };
        }
      }
      throw err;
    }
  }

  // Build a Stripe Checkout Session for one of the six membership SKUs. The
  // DTO has already validated the lookupKey against the static set; we still
  // re-check Stripe (via prices.list) so a Stripe-side misconfiguration
  // (e.g., Price set to inactive) surfaces as a 404 instead of producing a
  // Checkout Session that 404s mid-flow in the browser.
  async createMembershipCheckoutSession(
    userSub: string,
    lookupKey: string,
    userEmail?: string,
  ): Promise<CheckoutSessionView> {
    const prices = await this.stripeClient.stripe.prices.list({
      lookup_keys: [lookupKey],
      active: true,
      limit: 1,
    });
    const price = prices.data[0];
    if (!price) {
      throw new NotFoundException(
        `No active Stripe Price for lookup_key=${lookupKey}`,
      );
    }

    const customer = await this.getOrCreateStripeCustomer(userSub, userEmail);
    const webOrigin =
      this.config.get<string>('WEB_ORIGIN') ?? 'http://localhost:3000';

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

    if (!session.url) {
      throw new Error(
        `Stripe Checkout Session ${session.id} returned without a url`,
      );
    }
    return { id: session.id, url: session.url };
  }

  // POST /billing/membership/cancel sets cancel_at_period_end on Stripe's
  // copy of the subscription; access is preserved until period end, after
  // which Stripe emits customer.subscription.deleted and syncStripeData
  // flips the local row to CANCELED.
  async cancelMembership(userSub: string): Promise<void> {
    const membership = await this.prisma.membership.findUnique({
      where: { userId: userSub },
    });
    if (!membership) {
      throw new NotFoundException('No active membership to cancel');
    }
    await this.stripeClient.stripe.subscriptions.update(
      membership.stripeSubscriptionId,
      { cancel_at_period_end: true },
    );
  }

  // Run the paid-intake gates WITHOUT minting a session, and report whether the
  // tier is at cap. Mirrors createTicketCheckoutSession's gate ordering (404 /
  // not-PUBLISHED hide-existence -> existing-PAID 409) so the controller can
  // run gates once, decide checkout vs. waitlist on `atCap`, and only then mint
  // a session. The shared atCap() predicate keeps the "is it full?" decision
  // from drifting across the paid / claim / public surfaces.
  async evaluateTicketIntake(
    userSub: string,
    ticketTypeId: string,
  ): Promise<TicketIntakeEvaluation> {
    const ticketType = await this.prisma.ticketType.findUnique({
      where: { id: ticketTypeId },
      include: {
        event: { select: { id: true, status: true, organizationId: true } },
      },
    });
    if (!ticketType) throw new NotFoundException();
    if (ticketType.event.status !== EventStatus.PUBLISHED) {
      throw new NotFoundException();
    }

    const existing = await this.prisma.ticket.findFirst({
      where: {
        userId: userSub,
        eventId: ticketType.event.id,
        ticketTypeId,
        source: TicketSource.PAID,
      },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(
        'You already have a ticket for this event tier.',
      );
    }

    const issuedCount = await this.prisma.ticket.count({
      where: { ticketTypeId },
    });
    return {
      ticketType: {
        id: ticketType.id,
        eventId: ticketType.event.id,
        organizationId: ticketType.event.organizationId,
      },
      atCap: atCap(ticketType, issuedCount),
    };
  }

  // Build a Stripe Checkout Session in PAYMENT mode for a single TicketType.
  // Pre-flight:
  //   - 404 if the TicketType, the parent Event, or a published parent
  //     don't all exist (hide-existence — same as a missing TicketType).
  //   - 409 if the user already holds a PAID ticket for this (event,
  //     ticketType). Idempotency for the actual webhook→Ticket write lives
  //     on stripeCheckoutSessionId; this guard is a UX nicety to stop a
  //     double-click from creating two Stripe Customers + Checkouts.
  //
  // Members CAN still buy paid tickets for covered events — coverage is a
  // UI-side affordance (U8/U9), not a hard refusal here.
  async createTicketCheckoutSession(
    userSub: string,
    ticketTypeId: string,
    userEmail?: string,
  ): Promise<CheckoutSessionView> {
    const ticketType = await this.prisma.ticketType.findUnique({
      where: { id: ticketTypeId },
      include: {
        event: { select: { id: true, status: true, title: true } },
      },
    });
    if (!ticketType) throw new NotFoundException();
    if (ticketType.event.status !== EventStatus.PUBLISHED) {
      // Hide DRAFT/CANCELLED — buyers shouldn't be able to enumerate them.
      throw new NotFoundException();
    }

    const existing = await this.prisma.ticket.findFirst({
      where: {
        userId: userSub,
        eventId: ticketType.event.id,
        ticketTypeId,
        source: TicketSource.PAID,
      },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(
        'You already have a ticket for this event tier.',
      );
    }

    const customer = await this.getOrCreateStripeCustomer(userSub, userEmail);

    // Under-cap direct purchase: no expiry, no request back-link. The webhook
    // reads userId from metadata AND verifies it against client_reference_id
    // (tamper check); a session with no TicketRequest back-link takes the
    // unconditional Phase 3 issue path.
    return this.checkoutSessions.mintTicketSession({
      userSub,
      customerId: customer.stripeCustomerId,
      eventId: ticketType.event.id,
      ticketTypeId,
      stripePriceId: ticketType.stripePriceId,
    });
  }
}
