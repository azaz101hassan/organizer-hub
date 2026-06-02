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

    // raisedCents/donorCount/recentGiftCount join PaymentEvent → Donation via
    // donation_id. Today, the webhook write path in payment-events.service.ts does
    // not populate donation_id on new PaymentEvent rows — Phase E (the donation
    // webhook arms) is the unit that wires that through. Until Phase E ships,
    // every campaign reads as 0/0/0; afterward, refunds and disputes net the
    // total correctly because they inherit donation_id from the original DONATION.
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);
    const [raised, donorRows, recentGiftCount] = await Promise.all([
      this.prisma.paymentEvent.aggregate({
        _sum: { amountCents: true },
        where: {
          donation: { campaignId: campaign.id },
          status: 'SUCCEEDED',
        },
      }),
      // Count distinct userId from SUCCEEDED payment events (not donation status).
      // A recurring donor who later canceled their donation still has SUCCEEDED
      // PaymentEvents — their contribution is counted.
      this.prisma.paymentEvent.groupBy({
        by: ['userId'],
        where: {
          donation: { campaignId: campaign.id },
          status: 'SUCCEEDED',
        },
      }),
      // 30-day momentum signal: only DONATION-kind events (excludes refunds/disputes).
      this.prisma.paymentEvent.count({
        where: {
          donation: { campaignId: campaign.id },
          status: 'SUCCEEDED',
          kind: 'DONATION',
          succeededAt: { gte: thirtyDaysAgo },
        },
      }),
    ]);
    const donorCount = donorRows.length;

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
