import { Global, Module } from '@nestjs/common';
import { BillingService } from './billing.service';
import { StripeClient } from './stripe.client';
import { StripeWebhookVerifier } from './stripe-webhook.verifier';

// BillingModule is @Global so memberships/, tickets/, and webhooks/ modules
// can inject StripeClient / StripeWebhookVerifier / BillingService without
// each one having to import BillingModule explicitly.
@Global()
@Module({
  providers: [StripeClient, StripeWebhookVerifier, BillingService],
  exports: [StripeClient, StripeWebhookVerifier, BillingService],
})
export class BillingModule {}
