import { Module } from '@nestjs/common';
import { MembershipsModule } from '../memberships/memberships.module';
import { StripeWebhookController } from './stripe-webhook.controller';
import { StripeWebhookService } from './stripe-webhook.service';

// StripeClient + StripeWebhookVerifier are exposed by the @Global
// BillingModule, so no explicit import here.
@Module({
  imports: [MembershipsModule],
  controllers: [StripeWebhookController],
  providers: [StripeWebhookService],
})
export class WebhooksModule {}
