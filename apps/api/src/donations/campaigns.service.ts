import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CampaignStatus, Prisma } from '@organizer-hub/db/api';
import { PrismaService } from '../prisma/prisma.service';

const LEGAL_TRANSITIONS: Record<CampaignStatus, readonly CampaignStatus[]> = {
  DRAFT:    ['ACTIVE', 'ARCHIVED'],
  ACTIVE:   ['COMPLETE', 'ARCHIVED'],
  COMPLETE: ['ACTIVE', 'ARCHIVED'],
  ARCHIVED: ['DRAFT'],
};

// Narrow Prisma's known-error to the slug-uniqueness violation. The Campaign
// table has @@unique([organizationId, slug]); future migrations might add
// other unique constraints, and we don't want to mislabel those as slug.
function isSlugUniqueViolation(err: unknown): boolean {
  if (
    !(err instanceof Prisma.PrismaClientKnownRequestError) ||
    err.code !== 'P2002'
  ) {
    return false;
  }
  const target = err.meta?.target;
  if (Array.isArray(target)) return target.includes('slug');
  if (typeof target === 'string') return target.includes('slug');
  return false;
}

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

    // raisedCents nets refunds and disputes (their amountCents is signed negative
    // in the schema). donorCount is distinct userIds across all SUCCEEDED rows.
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);
    const [totals, recentGiftCount] = await Promise.all([
      this.campaignTotals(campaign.id),
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
    const { raisedCents, donorCount } = totals;

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
        raisedCents,
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

  // ── Shared aggregate helpers ─────────────────────────────────────────────────

  // raisedCents: sum of all SUCCEEDED amountCents for the campaign (refunds and
  // disputes have negative amountCents and automatically net the total).
  // donorCount: number of distinct userIds across all SUCCEEDED payment events
  // (a recurring donor who later canceled is still counted).
  private async campaignTotals(
    campaignId: string,
  ): Promise<{ raisedCents: number; donorCount: number }> {
    const [raised, donorRows] = await Promise.all([
      this.prisma.paymentEvent.aggregate({
        _sum: { amountCents: true },
        where: { donation: { campaignId }, status: 'SUCCEEDED' },
      }),
      this.prisma.paymentEvent.groupBy({
        by: ['userId'],
        where: { donation: { campaignId }, status: 'SUCCEEDED', kind: 'DONATION' },
      }),
    ]);
    return {
      raisedCents: raised._sum.amountCents ?? 0,
      donorCount: donorRows.length,
    };
  }

  // ── Admin methods ────────────────────────────────────────────────────────────

  private readonly coalitionSelect = {
    select: { id: true, slug: true, name: true, status: true },
  } as const;

  async listAllForAdmin(organizationId: string, filters: { coalitionId?: string } = {}) {
    return this.prisma.campaign.findMany({
      where: { organizationId, ...(filters.coalitionId ? { coalitionId: filters.coalitionId } : {}) },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
      include: { coalition: this.coalitionSelect },
    });
  }

  async getForAdmin(organizationId: string, id: string) {
    const existing = await this.prisma.campaign.findUnique({
      where: { id },
      include: { coalition: this.coalitionSelect },
    });
    if (!existing || existing.organizationId !== organizationId) {
      throw new NotFoundException();
    }

    const [totals, activeRecurringCount] = await Promise.all([
      this.campaignTotals(existing.id),
      this.prisma.donation.count({
        where: {
          campaignId: existing.id,
          mode: 'RECURRING',
          status: 'ACTIVE',
        },
      }),
    ]);

    return {
      ...existing,
      raisedCents: totals.raisedCents,
      donorCount: totals.donorCount,
      activeRecurringCount,
    };
  }

  async createForAdmin(
    organizationId: string,
    data: {
      coalitionId: string;
      name: string;
      slug: string;
      description?: string;
      coverImageUrl?: string;
      targetAmountCents: number;
      currency?: string;
      deadline?: string;
      status?: 'DRAFT';
      displayOrder?: number;
    },
  ) {
    const coalition = await this.prisma.coalition.findUnique({
      where: { id: data.coalitionId },
    });
    if (!coalition || coalition.organizationId !== organizationId) {
      throw new NotFoundException('coalition not found');
    }
    if (coalition.status === 'ARCHIVED') {
      throw new ConflictException('parent coalition is archived');
    }

    try {
      return await this.prisma.campaign.create({
        data: {
          organizationId,
          coalitionId: data.coalitionId,
          name: data.name,
          slug: data.slug,
          description: data.description ?? null,
          coverImageUrl: data.coverImageUrl ?? null,
          targetAmountCents: data.targetAmountCents,
          currency: data.currency ?? 'usd',
          deadline: data.deadline ? new Date(data.deadline) : null,
          status: data.status ?? 'DRAFT',
          displayOrder: data.displayOrder ?? 0,
        },
        include: { coalition: this.coalitionSelect },
      });
    } catch (err) {
      if (isSlugUniqueViolation(err)) {
        throw new ConflictException('a campaign with that slug already exists');
      }
      throw err;
    }
  }

  async updateForAdmin(
    organizationId: string,
    id: string,
    data: {
      name?: string;
      slug?: string;
      description?: string | null;
      coverImageUrl?: string | null;
      targetAmountCents?: number;
      currency?: string;
      deadline?: string | null;
      displayOrder?: number;
    },
  ) {
    const existing = await this.prisma.campaign.findUnique({ where: { id } });
    if (!existing || existing.organizationId !== organizationId) {
      throw new NotFoundException();
    }
    try {
      return await this.prisma.campaign.update({
        where: { id },
        data: {
          ...data,
          deadline:
            data.deadline === null
              ? null
              : data.deadline !== undefined
              ? new Date(data.deadline)
              : undefined,
        },
        include: { coalition: this.coalitionSelect },
      });
    } catch (err) {
      if (isSlugUniqueViolation(err)) {
        throw new ConflictException('a campaign with that slug already exists');
      }
      throw err;
    }
  }

  async transition(organizationId: string, id: string, to: CampaignStatus) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.campaign.findUnique({ where: { id } });
      if (!existing || existing.organizationId !== organizationId) {
        throw new NotFoundException();
      }

      const allowed = LEGAL_TRANSITIONS[existing.status];
      if (!allowed || !allowed.includes(to)) {
        throw new BadRequestException(
          `illegal transition ${existing.status} -> ${to}`,
        );
      }

      // Block activating a campaign whose parent coalition is archived.
      // U20 lets archive proceed past DRAFT/COMPLETE children; without this
      // check, an admin could later activate one and surface it on donor
      // pages with an archived parent.
      if (to === 'ACTIVE') {
        const parent = await tx.coalition.findUnique({
          where: { id: existing.coalitionId },
        });
        if (parent && parent.status === 'ARCHIVED') {
          throw new ConflictException(
            'cannot activate a campaign whose parent coalition is archived',
          );
        }
      }

      // Optimistic concurrency: only apply the write if the from-status is
      // still what we just read. Two concurrent transitions on the same row
      // would otherwise both pass their reads and the second would silently
      // overwrite the first.
      const result = await tx.campaign.updateMany({
        where: { id, status: existing.status },
        data: { status: to },
      });
      if (result.count === 0) {
        throw new ConflictException(
          'campaign status changed during transition; refresh and retry',
        );
      }

      return tx.campaign.findUnique({
        where: { id },
        include: { coalition: this.coalitionSelect },
      });
    });
  }
}
