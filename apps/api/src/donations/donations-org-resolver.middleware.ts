import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';

// Resolves the campaign's organization and attaches
// `req.organization = { id, donationsEnabled }` so DonationsFeatureFlagGuard
// can gate routes without an extra DB query.
//
// Handles two routes:
//   POST /billing/checkout/donation — resolve via req.body.campaignId
//   POST /billing/donation/:id/cancel — resolve via donationId extracted from
//     the URL path. Route params (req.params) are not populated by Express at
//     middleware time, so the id is parsed manually from req.originalUrl.
@Injectable()
export class DonationsOrgResolverMiddleware implements NestMiddleware {
  constructor(private readonly prisma: PrismaService) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    // Cancel route: /billing/donation/<id>/cancel
    const cancelMatch = /\/billing\/donation\/([^/]+)\/cancel/.exec(req.originalUrl);
    if (cancelMatch) {
      const donationId = cancelMatch[1];
      const donation = await this.prisma.donation.findUnique({
        where: { id: donationId },
        select: { organizationId: true },
      });
      if (donation?.organizationId) {
        const org = await this.prisma.organization.findUnique({
          where: { id: donation.organizationId },
          select: { id: true, donationsEnabled: true },
        });
        if (org) {
          (req as any).organization = org;
        }
      }
      return next();
    }

    // Checkout route: /billing/checkout/donation
    const campaignId = req.body?.campaignId as string | undefined;
    if (campaignId) {
      const campaign = await this.prisma.campaign.findUnique({
        where: { id: campaignId },
        select: { organizationId: true },
      });
      if (campaign?.organizationId) {
        const org = await this.prisma.organization.findUnique({
          where: { id: campaign.organizationId },
          select: { id: true, donationsEnabled: true },
        });
        if (org) {
          (req as any).organization = org;
        }
      }
    }
    next();
  }
}
