import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@organizer-hub/db/api';
import { PrismaService } from '../prisma/prisma.service';
import { StripeClient } from './stripe.client';

export interface BillingCustomerView {
  userId: string;
  stripeCustomerId: string;
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeClient: StripeClient,
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
}
