import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@organizer-hub/db/api';
import { PrismaService } from '../prisma/prisma.service';
import { StripeClient } from './stripe.client';

export interface BillingCustomerView {
  userId: string;
  stripeCustomerId: string;
}

export interface CheckoutSessionView {
  id: string;
  url: string;
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeClient: StripeClient,
    private readonly config: ConfigService,
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
}
