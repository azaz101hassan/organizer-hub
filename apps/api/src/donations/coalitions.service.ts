import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@organizer-hub/db/api';
import { PrismaService } from '../prisma/prisma.service';
import { paginateById } from '../common/paginate';
import type { ListCoalitionsAdminDto } from './dto/list-coalitions-admin.dto';

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
          COUNT(DISTINCT c.id)::bigint                 AS child_count,
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

        const donorRows = await this.prisma.paymentEvent.groupBy({
          by: ['userId'],
          where: {
            donation: { campaignId: cmp.id },
            status: 'SUCCEEDED',
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

  // ── Admin methods ────────────────────────────────────────────────────────────

  async listAllForAdmin(
    organizationId: string,
    q: ListCoalitionsAdminDto = {},
  ) {
    if (q.cursor) {
      const cursorRow = await this.prisma.coalition.findUnique({
        where: { id: q.cursor },
        select: { organizationId: true },
      });
      if (!cursorRow || cursorRow.organizationId !== organizationId) {
        throw new BadRequestException('invalid cursor');
      }
    }

    return paginateById(
      (args) =>
        this.prisma.coalition.findMany(
          args as Parameters<typeof this.prisma.coalition.findMany>[0],
        ),
      {
        where: {
          organizationId,
          ...(q.status ? { status: q.status } : {}),
          ...(q.q
            ? { name: { contains: q.q, mode: 'insensitive' } }
            : {}),
        },
        orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
        include: { _count: { select: { campaigns: true } } },
        cursor: q.cursor,
        limit: q.limit,
      },
    );
  }

  async getForAdmin(organizationId: string, id: string) {
    const existing = await this.prisma.coalition.findUnique({
      where: { id },
      include: { _count: { select: { campaigns: true } } },
    });
    if (!existing || existing.organizationId !== organizationId) {
      throw new NotFoundException();
    }
    return existing;
  }

  async createForAdmin(
    organizationId: string,
    data: {
      name: string;
      slug: string;
      description?: string;
      coverImageUrl?: string;
      status?: 'ACTIVE';
      displayOrder?: number;
    },
  ) {
    try {
      return await this.prisma.coalition.create({
        data: {
          organizationId,
          name: data.name,
          slug: data.slug,
          description: data.description ?? null,
          coverImageUrl: data.coverImageUrl ?? null,
          status: data.status ?? 'ACTIVE',
          displayOrder: data.displayOrder ?? 0,
        },
        include: { _count: { select: { campaigns: true } } },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'a coalition with that slug already exists',
        );
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
      displayOrder?: number;
    },
  ) {
    const existing = await this.prisma.coalition.findUnique({ where: { id } });
    if (!existing || existing.organizationId !== organizationId) {
      throw new NotFoundException();
    }
    try {
      return await this.prisma.coalition.update({
        where: { id },
        data,
        include: { _count: { select: { campaigns: true } } },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'a coalition with that slug already exists',
        );
      }
      throw err;
    }
  }

  // Archive blocks ONLY on ACTIVE child campaigns. DRAFT and COMPLETE campaigns
  // are intentionally allowed to persist under an ARCHIVED parent — DRAFTs are
  // admin-only and never reach donors; COMPLETE campaigns are historical and
  // already absent from donor surfaces (the public list filters status=ACTIVE).
  // The read and the write run in a transaction so a concurrent campaign
  // activation can't slip past the check.
  async archiveForAdmin(organizationId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.coalition.findUnique({
        where: { id },
        include: {
          _count: { select: { campaigns: { where: { status: 'ACTIVE' } } } },
        },
      });
      if (!existing || existing.organizationId !== organizationId) {
        throw new NotFoundException();
      }
      if (existing._count.campaigns > 0) {
        throw new ConflictException(
          'coalition has active campaigns — archive or complete them first',
        );
      }
      return tx.coalition.update({
        where: { id },
        data: { status: 'ARCHIVED' },
        include: { _count: { select: { campaigns: true } } },
      });
    });
  }

  // Flips an ARCHIVED coalition back to ACTIVE. Rejects with 409 when the
  // coalition is not currently ARCHIVED (e.g. already ACTIVE or a concurrent
  // restore raced ahead). Child campaigns are NOT touched — admins re-activate
  // them individually via the campaign transition surface (see
  // CampaignsService.transition). This matches the asymmetry in archiveForAdmin,
  // which also does not reach into child campaigns.
  async restoreForAdmin(organizationId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.coalition.findUnique({ where: { id } });
      if (!existing || existing.organizationId !== organizationId) {
        throw new NotFoundException();
      }
      // Optimistic concurrency: only flip if still ARCHIVED at write time.
      // Mirrors campaigns.service.ts transition's count===0 -> 409 pattern.
      const result = await tx.coalition.updateMany({
        where: { id, status: 'ARCHIVED' },
        data: { status: 'ACTIVE' },
      });
      if (result.count === 0) {
        throw new ConflictException('coalition is not archived');
      }
      return tx.coalition.findUnique({
        where: { id },
        include: { _count: { select: { campaigns: true } } },
      });
    });
  }
}
