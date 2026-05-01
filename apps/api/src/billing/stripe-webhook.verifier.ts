import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Stripe } from './stripe-types';
import { StripeClient } from './stripe.client';

// Thin wrapper around stripe.webhooks.constructEvent that hides the SDK error
// shape and translates signature failures into a generic 400. The handler
// never echoes the underlying Stripe SDK error message to the client — that
// would leak parser internals and (in some Stripe SDK versions) the raw body
// excerpt back to whoever posted it.
@Injectable()
export class StripeWebhookVerifier {
  private readonly logger = new Logger(StripeWebhookVerifier.name);
  private readonly secret: string;

  constructor(
    config: ConfigService,
    private readonly stripeClient: StripeClient,
  ) {
    this.secret = config.get<string>('STRIPE_WEBHOOK_SECRET') ?? '';
    if (!this.secret) {
      this.logger.warn(
        'STRIPE_WEBHOOK_SECRET not set — incoming webhooks will be rejected. Set it in .env (use `stripe listen` for local dev).',
      );
    }
  }

  construct(
    rawBody: Buffer | string,
    signature: string | undefined,
  ): Stripe.Event {
    if (!signature) {
      throw new BadRequestException('Missing Stripe-Signature header');
    }
    try {
      return this.stripeClient.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        this.secret,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Webhook signature verification failed: ${msg}`);
      throw new BadRequestException('Invalid webhook signature');
    }
  }
}
