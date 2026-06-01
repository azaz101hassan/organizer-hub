import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';

// Reads the `campaignId` from the request body, looks up the campaign's
// organization, and attaches `req.organization = { id, donationsEnabled }` so
// the DonationsFeatureFlagGuard can gate the route without an extra DB query.
// Registered only for the POST /billing/checkout/donation route.
@Injectable()
export class DonationsOrgResolverMiddleware implements NestMiddleware {
  constructor(private readonly prisma: PrismaService) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
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
