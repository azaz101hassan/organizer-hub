import { Injectable, Logger } from '@nestjs/common';
import { MembershipsService } from '../memberships/memberships.service';
import type { Stripe } from '../billing/stripe-types';

// Event-types the webhook service understands. Anything else is acknowledged
// 200 with a no-op so Stripe doesn't retry forever for events we never asked
// to handle (extra endpoint filters in the Dashboard are the right place to
// silence those if they become noisy).
const SUBSCRIPTION_EVENTS = new Set([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
]);

@Injectable()
export class StripeWebhookService {
  private readonly logger = new Logger(StripeWebhookService.name);

  constructor(private readonly memberships: MembershipsService) {}

  // Dispatch a verified Stripe event. Every membership-relevant event lands
  // in the same syncStripeData call — Theo Browne pattern — so the local
  // mirror always converges to whatever Stripe currently says, independent
  // of which event woke us up.
  async handle(event: Stripe.Event): Promise<void> {
    const customerId = this.extractCustomerId(event);
    if (!customerId) {
      this.logger.warn(
        `${event.type} ${event.id} has no resolvable customer id; skipping sync`,
      );
      return;
    }

    if (
      SUBSCRIPTION_EVENTS.has(event.type) ||
      event.type === 'checkout.session.completed'
    ) {
      await this.memberships.syncStripeData(customerId);
      return;
    }

    this.logger.debug(`Ignoring event type ${event.type}`);
  }

  // Pull the Stripe customer id out of an event's data.object regardless of
  // its concrete type. Subscriptions and customers both carry `customer` as
  // a string-or-Customer; Checkout Sessions carry `customer` likewise;
  // Invoices carry `customer` and (sometimes) `subscription`. We unwrap the
  // `customer` field to a plain string and let callers route on it.
  private extractCustomerId(event: Stripe.Event): string | null {
    const obj = event.data.object as {
      customer?: string | { id: string } | null;
    };
    const c = obj.customer;
    if (!c) return null;
    if (typeof c === 'string') return c;
    return c.id ?? null;
  }
}
