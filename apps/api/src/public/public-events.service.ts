import { Injectable, NotFoundException } from '@nestjs/common';
import { EventStatus, Prisma } from '@organizer-hub/db/api';
import {
  decodeEventCursor,
  encodeEventCursor,
} from '../common/cursor';
import { PrismaService } from '../prisma/prisma.service';

export interface PublicEventView {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  startsAt: Date;
  endsAt: Date | null;
  venue: string | null;
  publishedAt: Date | null;
  organization: { name: string; slug: string };
}

export interface PublicEventsPage {
  items: PublicEventView[];
  nextCursor: string | null;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

type EventWithOrg = Prisma.EventGetPayload<{
  include: { organization: { select: { name: true; slug: true } } };
}>;

function toView(e: EventWithOrg): PublicEventView {
  return {
    id: e.id,
    title: e.title,
    slug: e.slug,
    description: e.description,
    startsAt: e.startsAt,
    endsAt: e.endsAt,
    venue: e.venue,
    publishedAt: e.publishedAt,
    organization: { name: e.organization.name, slug: e.organization.slug },
  };
}

@Injectable()
export class PublicEventsService {
  constructor(private readonly prisma: PrismaService) {}

  async listUpcoming(opts: {
    cursor?: string;
    limit?: number;
  }): Promise<PublicEventsPage> {
    const limit = Math.min(
      Math.max(1, opts.limit ?? DEFAULT_LIMIT),
      MAX_LIMIT,
    );
    const now = new Date();

    const tupleFilter: Prisma.EventWhereInput = opts.cursor
      ? (() => {
          const c = decodeEventCursor(opts.cursor);
          return {
            OR: [
              { startsAt: { gt: c.startsAt } },
              { startsAt: c.startsAt, id: { gt: c.id } },
            ],
          };
        })()
      : {};

    const rows = await this.prisma.event.findMany({
      where: {
        status: EventStatus.PUBLISHED,
        startsAt: { gte: now },
        ...tupleFilter,
      },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      include: {
        organization: { select: { name: true, slug: true } },
      },
    });

    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, limit) : rows).map(toView);
    const last = items[items.length - 1];
    return {
      items,
      nextCursor:
        hasMore && last
          ? encodeEventCursor({ startsAt: last.startsAt, id: last.id })
          : null,
    };
  }

  async getById(id: string): Promise<PublicEventView> {
    const event = await this.prisma.event.findFirst({
      where: { id, status: EventStatus.PUBLISHED },
      include: { organization: { select: { name: true, slug: true } } },
    });
    if (!event) throw new NotFoundException();
    return toView(event);
  }
}
