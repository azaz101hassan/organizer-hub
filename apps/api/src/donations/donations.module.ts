import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { DonationsFeatureFlagGuard } from './donations-feature-flag.guard';
import { DonationsService } from './donations.service';
import { DonationsController } from './donations.controller';
import { DonationManagementController } from './donation-management.controller';
import { DonationsOrgResolverMiddleware } from './donations-org-resolver.middleware';
import { CoalitionsController } from './coalitions.controller';
import { CoalitionsService } from './coalitions.service';

// PrismaModule and BillingModule are both @Global, so their providers
// (PrismaService, StripeClient, BillingService) are available without
// an explicit import here.
@Module({
  controllers: [DonationsController, DonationManagementController, CoalitionsController],
  providers: [DonationsService, DonationsFeatureFlagGuard, DonationsOrgResolverMiddleware, CoalitionsService],
  exports: [DonationsService, DonationsFeatureFlagGuard],
})
export class DonationsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Resolve the campaign's organization onto req.organization before the
    // DonationsFeatureFlagGuard runs so it can gate by donationsEnabled.
    // The middleware also falls back to the house org for public reads
    // (GET /coalitions) where no campaign or donation id is present.
    consumer
      .apply(DonationsOrgResolverMiddleware)
      .forRoutes(
        { path: 'billing/checkout/donation', method: RequestMethod.POST },
        { path: 'billing/donation/:id/cancel', method: RequestMethod.POST },
        { path: 'coalitions', method: RequestMethod.GET },
        { path: 'coalitions/:slug', method: RequestMethod.GET },
      );
  }
}
