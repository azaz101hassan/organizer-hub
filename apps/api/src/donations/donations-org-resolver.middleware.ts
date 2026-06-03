import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { HOUSE_ORG_ID } from '../common/house-org';

// Resolves the campaign's organization and attaches `req.organization = { id }`
// so controllers can scope reads by org without an extra DB query.
//
// Handles three route patterns:
//   POST /billing/checkout/donation — resolve via req.body.campaignId
//   POST /billing/donation/:id/cancel — resolve via donationId extracted from
//     the URL path. Route params (req.params) are not populated by Express at
//     middleware time, so the id is parsed manually from req.originalUrl.
//   GET  /coalitions and GET /coalitions/:slug and GET /campaigns/:slug —
//     single-tenant public reads; fall back to the house org.
@Injectable()
export class DonationsOrgResolverMiddleware implements NestMiddleware {
  constructor(private readonly prisma: PrismaService) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    // Cancel route: /billing/donation/<id>/cancel
    const cancelMatch = /\/billing\/donation\/([^/?#]+)\/cancel(?:[/?#]|$)/.exec(req.originalUrl);
    if (cancelMatch) {
      const donationId = cancelMatch[1];
      const donation = await this.prisma.donation.findUnique({
        where: { id: donationId },
        select: { organizationId: true },
      });
      if (donation?.organizationId) {
        const org = await this.prisma.organization.findUnique({
          where: { id: donation.organizationId },
          select: { id: true },
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
          select: { id: true },
        });
        if (org) {
          (req as any).organization = org;
          return next();
        }
      }
    }

    // Fallback: single-tenant public reads (e.g. GET /coalitions).
    // Scoped to GET only: POST routes that fail to resolve an explicit
    // identifier (e.g. missing campaignId) must not fall through to the house
    // org — the guard should 404 rather than letting the request reach the
    // controller via an unintended org.
    if (!(req as any).organization && req.method === 'GET') {
      const org = await this.prisma.organization.findUnique({
        where: { id: HOUSE_ORG_ID },
        select: { id: true, donationsEnabled: true },
      });
      if (org) {
        (req as any).organization = org;
      }
    }

    next();
  }
}
