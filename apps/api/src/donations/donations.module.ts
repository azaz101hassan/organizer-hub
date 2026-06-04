import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { DonationsService } from './donations.service';
import { DonationsController } from './donations.controller';
import { DonationManagementController } from './donation-management.controller';
import { DonationsReadController } from './donations-read.controller';
import { DonationsOrgResolverMiddleware } from './donations-org-resolver.middleware';
import { CoalitionsController } from './coalitions.controller';
import { CoalitionsService } from './coalitions.service';
import { AdminCoalitionsController } from './admin-coalitions.controller';
import { AdminCampaignsController } from './admin-campaigns.controller';
import { AdminDonationsController } from './admin-donations.controller';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';

// PrismaModule and BillingModule are both @Global, so their providers
// (PrismaService, StripeClient, BillingService) are available without
// an explicit import here.
@Module({
  controllers: [
    DonationsController,
    DonationManagementController,
    DonationsReadController,
    CoalitionsController,
    AdminCoalitionsController,
    CampaignsController,
    AdminCampaignsController,
    AdminDonationsController,
  ],
  providers: [
    DonationsService,
    DonationsOrgResolverMiddleware,
    CoalitionsService,
    CampaignsService,
  ],
  exports: [DonationsService, CampaignsService],
})
export class DonationsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Resolve the campaign's organization onto req.organization so controllers
    // can scope reads by org. Falls back to the house org for public reads
    // (GET /coalitions, GET /campaigns/:slug) where no campaign or donation
    // id is present.
    consumer
      .apply(DonationsOrgResolverMiddleware)
      .forRoutes(
        { path: 'billing/checkout/donation', method: RequestMethod.POST },
        { path: 'billing/donation/:id/cancel', method: RequestMethod.POST },
        { path: 'donations/mine', method: RequestMethod.GET },
        { path: 'donations/by-session/:id', method: RequestMethod.GET },
        { path: 'coalitions', method: RequestMethod.GET },
        { path: 'coalitions/:slug', method: RequestMethod.GET },
        { path: 'campaigns/:slug', method: RequestMethod.GET },
      );
  }
}
