import {
  Injectable,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  DonationMode,
  OrganizationRole,
  Prisma,
} from '@organizer-hub/db/api';
import { PrismaService } from '../prisma/prisma.service';
import { QueryPaymentEventsDto } from './dto/query-payment-events.dto';
import {
  PaymentEventView,
  toPaymentEventView,
} from './dto/payment-event-view';

const WRITE_ROLES: ReadonlySet<OrganizationRole> = new Set([
  OrganizationRole.OWNER,
  OrganizationRole.ADMIN,
]);

export interface ListPage {
  items: PaymentEventView[];
  nextCursor: string | null;
}

@Injectable()
export class PaymentEventsReadService {
  constructor(private readonly prisma: PrismaService) {}

  // User-scoped list: caller sees only their own rows.
  async listForUser(
    userId: string,
    q: QueryPaymentEventsDto,
  ): Promise<ListPage> {
    const where: Prisma.PaymentEventWhereInput = { userId };
    this.applyOptionalFilters(where, q);
    return this.paginate(where, q);
  }

  // Admin-scoped list: requires OWNER/ADMIN on the org.
  async listForAdmin(
    userId: string,
    q: QueryPaymentEventsDto,
  ): Promise<ListPage> {
    if (!q.organizationId) {
      throw new ForbiddenException('organizationId required');
    }
    await this.requireRole(userId, q.organizationId);
    const where: Prisma.PaymentEventWhereInput = {
      organizationId: q.organizationId,
    };
    this.applyOptionalFilters(where, q);
    return this.paginate(where, q);
  }

  async getDetail(userId: string, id: string): Promise<PaymentEventView> {
    const row = await this.prisma.paymentEvent.findUnique({ where: { id } });
    if (!row) throw new NotFoundException();
    if (row.userId !== userId) {
      try {
        await this.requireRole(userId, row.organizationId);
      } catch {
        throw new NotFoundException();
      }
    }
    return toPaymentEventView(row);
  }

  // Streams rows for admin CSV export. Auth enforced upfront.
  async *adminStream(
    userId: string,
    organizationId: string,
    q: Omit<QueryPaymentEventsDto, 'cursor' | 'limit'>,
  ): AsyncGenerator<PaymentEventView> {
    await this.requireRole(userId, organizationId);
    const where: Prisma.PaymentEventWhereInput = { organizationId };
    this.applyOptionalFilters(where, q);
    const BATCH = 500;
    let cursor: string | undefined;
    while (true) {
      const rows = await this.prisma.paymentEvent.findMany({
        where,
        take: BATCH,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      for (const r of rows) yield toPaymentEventView(r);
      if (rows.length < BATCH) return;
      cursor = rows[rows.length - 1].id;
    }
  }

  private applyOptionalFilters(
    where: Prisma.PaymentEventWhereInput,
    q: Pick<QueryPaymentEventsDto, 'kind' | 'status' | 'from' | 'to' | 'campaignId' | 'recurringOnly'>,
  ): void {
    if (q.kind) where.kind = q.kind;
    if (q.status) where.status = q.status;
    if (q.from || q.to) {
      const range: Prisma.DateTimeFilter = {};
      if (q.from) range.gte = new Date(q.from);
      if (q.to) range.lte = new Date(q.to);
      where.createdAt = range;
    }
    const donation: Prisma.DonationWhereInput = {};
    if (q.campaignId) donation.campaignId = q.campaignId;
    if (q.recurringOnly === 'true') donation.mode = DonationMode.RECURRING;
    if (Object.keys(donation).length > 0) where.donation = { is: donation };
  }

  private async paginate(
    where: Prisma.PaymentEventWhereInput,
    q: QueryPaymentEventsDto,
  ): Promise<ListPage> {
    const take = q.limit ?? 20;
    const rows = await this.prisma.paymentEvent.findMany({
      where,
      take: take + 1,
      ...(q.cursor ? { skip: 1, cursor: { id: q.cursor } } : {}),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const hasMore = rows.length > take;
    const items = (hasMore ? rows.slice(0, -1) : rows).map(toPaymentEventView);
    return {
      items,
      nextCursor: hasMore ? items[items.length - 1].id : null,
    };
  }

  // Mirrors EventLabelsService.requireRole: 404 if not a member, 403 if member
  // but role insufficient.
  private async requireRole(
    userId: string,
    organizationId: string,
  ): Promise<void> {
    const member = await this.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { role: true },
    });
    if (!member) throw new NotFoundException();
    if (!WRITE_ROLES.has(member.role)) {
      throw new ForbiddenException('insufficient role');
    }
  }
}
