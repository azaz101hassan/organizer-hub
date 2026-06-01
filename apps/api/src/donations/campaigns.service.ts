import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface CampaignDetail {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  coverImageUrl: string | null;
  targetAmountCents: number;
  currency: string;
  deadline: Date | null;
  status: 'ACTIVE' | 'COMPLETE';
  raisedCents: number;
  donorCount: number;
  recentGiftCount: number;
}

export interface CampaignDetailResponse {
  campaign: CampaignDetail;
  coalition: { id: string; slug: string; name: string };
}

@Injectable()
export class CampaignsService {
  constructor(private readonly prisma: PrismaService) {}

  async getBySlug(
    organizationId: string,
    slug: string,
  ): Promise<CampaignDetailResponse> {
    const campaign = await this.prisma.campaign.findUnique({
      where: { organizationId_slug: { organizationId, slug } },
      include: { coalition: true },
    });

    if (
      !campaign ||
      (campaign.status !== 'ACTIVE' && campaign.status !== 'COMPLETE')
    ) {
      // 404 on DRAFT and ARCHIVED — donors must not probe unpublished/hidden campaigns
      throw new NotFoundException();
    }

    const raised = await this.prisma.paymentEvent.aggregate({
      _sum: { amountCents: true },
      where: {
        donation: { campaignId: campaign.id },
        status: 'SUCCEEDED',
      },
    });

    // Count distinct userId from SUCCEEDED payment events (not donation status).
    // A recurring donor who later canceled their donation still has SUCCEEDED
    // PaymentEvents — their contribution is counted.
    const donorRows = await this.prisma.paymentEvent.groupBy({
      by: ['userId'],
      where: {
        donation: { campaignId: campaign.id },
        status: 'SUCCEEDED',
      },
    });
    const donorCount = donorRows.length;

    // 30-day momentum signal: only DONATION-kind events (excludes refunds/disputes).
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);
    const recentGiftCount = await this.prisma.paymentEvent.count({
      where: {
        donation: { campaignId: campaign.id },
        status: 'SUCCEEDED',
        kind: 'DONATION',
        succeededAt: { gte: thirtyDaysAgo },
      },
    });

    return {
      campaign: {
        id: campaign.id,
        slug: campaign.slug,
        name: campaign.name,
        description: campaign.description,
        coverImageUrl: campaign.coverImageUrl,
        targetAmountCents: campaign.targetAmountCents,
        currency: campaign.currency,
        deadline: campaign.deadline,
        status: campaign.status as 'ACTIVE' | 'COMPLETE',
        raisedCents: raised._sum.amountCents ?? 0,
        donorCount,
        recentGiftCount,
      },
      coalition: {
        id: campaign.coalition.id,
        slug: campaign.coalition.slug,
        name: campaign.coalition.name,
      },
    };
  }
}
