import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@organizer-hub/db/api';
import { PrismaService } from '../prisma/prisma.service';

export interface CoalitionListItem {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  coverImageUrl: string | null;
  childCampaignCount: number;
  totalRaisedCents: number;
}

export interface CampaignSummary {
  id: string;
  slug: string;
  name: string;
  coverImageUrl: string | null;
  targetAmountCents: number;
  raisedCents: number;
  donorCount: number;
  deadline: Date | null;
  status: 'ACTIVE' | 'COMPLETE';
}

interface StatsRow {
  coalition_id: string;
  child_count: bigint;
  total_raised: bigint | null;
}

@Injectable()
export class CoalitionsService {
  constructor(private readonly prisma: PrismaService) {}

  async listForOrg(orgId: string): Promise<CoalitionListItem[]> {
    const coalitions = await this.prisma.coalition.findMany({
      where: { organizationId: orgId, status: 'ACTIVE' },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });

    if (coalitions.length === 0) {
      return [];
    }

    const ids = coalitions.map((c) => c.id);

    // Single query aggregates child_count and total_raised for all coalitions
    // at once to avoid N+1 on the list endpoint.
    const rows = await this.prisma.$queryRaw<StatsRow[]>(
      Prisma.sql`
        SELECT
          c.coalition_id,
          COUNT(c.id)::bigint                          AS child_count,
          SUM(pe.amount_cents)::bigint                 AS total_raised
        FROM campaigns c
        LEFT JOIN donations d
          ON d.campaign_id = c.id
        LEFT JOIN payment_events pe
          ON pe.donation_id = d.id
         AND pe.status = 'SUCCEEDED'
        WHERE c.coalition_id IN (${Prisma.join(ids)})
          AND c.status IN ('ACTIVE', 'COMPLETE')
        GROUP BY c.coalition_id
      `,
    );

    const statsMap = new Map(
      rows.map((r) => [
        r.coalition_id,
        {
          childCampaignCount: Number(r.child_count),
          totalRaisedCents: Number(r.total_raised ?? 0),
        },
      ]),
    );

    return coalitions.map((c) => {
      const stats = statsMap.get(c.id) ?? {
        childCampaignCount: 0,
        totalRaisedCents: 0,
      };
      return {
        id: c.id,
        slug: c.slug,
        name: c.name,
        description: c.description,
        coverImageUrl: c.coverImageUrl,
        childCampaignCount: stats.childCampaignCount,
        totalRaisedCents: stats.totalRaisedCents,
      };
    });
  }

  async getBySlug(
    orgId: string,
    slug: string,
  ): Promise<{ coalition: CoalitionListItem; campaigns: CampaignSummary[] }> {
    const coalition = await this.prisma.coalition.findUnique({
      where: { organizationId_slug: { organizationId: orgId, slug } },
    });

    if (!coalition || coalition.status !== 'ACTIVE') {
      // 404 hides ARCHIVED coalitions from deep-linking
      throw new NotFoundException();
    }

    const campaigns = await this.prisma.campaign.findMany({
      where: {
        coalitionId: coalition.id,
        status: { in: ['ACTIVE', 'COMPLETE'] },
      },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });

    const summaries: CampaignSummary[] = await Promise.all(
      campaigns.map(async (cmp) => {
        const raised = await this.prisma.paymentEvent.aggregate({
          _sum: { amountCents: true },
          where: {
            donation: { campaignId: cmp.id },
            status: 'SUCCEEDED',
          },
        });

        const donorRows = await this.prisma.donation.groupBy({
          by: ['userId'],
          where: {
            campaignId: cmp.id,
            status: { in: ['ACTIVE', 'COMPLETED'] },
          },
        });

        return {
          id: cmp.id,
          slug: cmp.slug,
          name: cmp.name,
          coverImageUrl: cmp.coverImageUrl,
          targetAmountCents: cmp.targetAmountCents,
          raisedCents: raised._sum.amountCents ?? 0,
          donorCount: donorRows.length,
          deadline: cmp.deadline,
          status: cmp.status as 'ACTIVE' | 'COMPLETE',
        };
      }),
    );

    const totalRaisedCents = summaries.reduce(
      (acc, s) => acc + s.raisedCents,
      0,
    );

    return {
      coalition: {
        id: coalition.id,
        slug: coalition.slug,
        name: coalition.name,
        description: coalition.description,
        coverImageUrl: coalition.coverImageUrl,
        childCampaignCount: summaries.length,
        totalRaisedCents,
      },
      campaigns: summaries,
    };
  }
}
