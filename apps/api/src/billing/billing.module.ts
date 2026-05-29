import { Global, Module } from '@nestjs/common';
import { MembershipsModule } from '../memberships/memberships.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { CheckoutSessionFactory } from './checkout-session.factory';
import { StripeClient } from './stripe.client';
import { StripeWebhookVerifier } from './stripe-webhook.verifier';

// BillingModule is @Global so memberships/, tickets/, ticket-requests/, and
// webhooks/ can inject StripeClient / StripeWebhookVerifier / BillingService /
// CheckoutSessionFactory without importing BillingModule. The exported
// CheckoutSessionFactory is how ticket-requests' approvePaid mints a session
// (the one-way ticket-requests -> billing dependency, no forwardRef).
@Global()
@Module({
  imports: [MembershipsModule],
  controllers: [BillingController],
  providers: [
    StripeClient,
    StripeWebhookVerifier,
    BillingService,
    CheckoutSessionFactory,
  ],
  exports: [
    StripeClient,
    StripeWebhookVerifier,
    BillingService,
    CheckoutSessionFactory,
  ],
})
export class BillingModule {}
