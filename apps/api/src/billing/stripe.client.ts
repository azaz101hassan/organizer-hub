import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import StripeFactory from 'stripe';
import type { Stripe } from './stripe-types';

// Pinned API version. Stripe's API behavior is version-locked at construction;
// upgrading is opt-in. We track Stripe SDK v22's accepted `.dahlia` version
// (currently `2026-05-27.dahlia`) — `.dahlia` is the same release track as the
// earlier `2026-04-22.dahlia` we pinned for Phase 3, so the subscription shape
// stays the same (`current_period_end` on each subscription item, the layout
// that syncStripeData() reads); upgrading within the codename is non-breaking.
const STRIPE_API_VERSION = '2026-05-27.dahlia';

// Convention for outbound POSTs that this codebase makes against Stripe: every
// `stripe.X.create(...)` call passes an idempotency key derived deterministically
// from the domain identifiers involved (userSub, lookupKey, ticketTypeId, etc.).
// Concurrent retries from the user / browser produce one Stripe object, not many.
@Injectable()
export class StripeClient {
  private readonly logger = new Logger(StripeClient.name);
  readonly stripe: Stripe;

  constructor(config: ConfigService) {
    const secret = config.get<string>('STRIPE_SECRET_KEY') ?? '';
    if (!secret) {
      this.logger.warn(
        'STRIPE_SECRET_KEY not set — using a placeholder key so the app boots, but any outbound Stripe call will fail with 401. Set the real key in .env to enable billing.',
      );
    }
    // Stripe v22's constructor throws if neither apiKey nor authenticator is
    // provided; the placeholder lets the app (and tests with the seam stubbed)
    // boot without a real key. The fake StripeClient overrides this provider
    // entirely in e2e tests, so the placeholder is never exercised against the
    // live Stripe SDK there.
    this.stripe = new StripeFactory(secret || 'sk_test_placeholder_unused', {
      apiVersion: STRIPE_API_VERSION,
    });
  }
}
