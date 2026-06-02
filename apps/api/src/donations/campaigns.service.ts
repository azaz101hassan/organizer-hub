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

  // ── Admin methods ────────────────────────────────────────────────────────────

  private readonly coalitionSelect = {
    select: { id: true, slug: true, name: true, status: true },
  } as const;

  async listAllForAdmin(organizationId: string) {
    return this.prisma.campaign.findMany({
      where: { organizationId },
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
    return existing;
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
      description?: string;
      coverImageUrl?: string;
      targetAmountCents?: number;
      currency?: string;
      deadline?: string;
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
          deadline: data.deadline !== undefined ? new Date(data.deadline) : undefined,
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
