import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventStatus } from '@organizer-hub/db/api';
import { createWithUniqueSlug, slugify } from '../common/slug';
import { PrismaService } from '../prisma/prisma.service';

export interface EventView {
  id: string;
  organizationId: string;
  title: string;
  slug: string;
  description: string | null;
  startsAt: Date;
  endsAt: Date | null;
  venue: string | null;
  status: EventStatus;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface DbEvent {
  id: string;
  organizationId: string;
  title: string;
  slug: string;
  description: string | null;
  startsAt: Date;
  endsAt: Date | null;
  venue: string | null;
  status: EventStatus;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function toView(e: DbEvent): EventView {
  return {
    id: e.id,
    organizationId: e.organizationId,
    title: e.title,
    slug: e.slug,
    description: e.description,
    startsAt: e.startsAt,
    endsAt: e.endsAt,
    venue: e.venue,
    status: e.status,
    publishedAt: e.publishedAt,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

function assertDateRange(startsAt: Date | undefined, endsAt: Date | undefined): void {
  if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) {
    throw new BadRequestException('endsAt must be after startsAt');
  }
}

@Injectable()
export class EventsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    orgId: string,
    userId: string,
    input: {
      title: string;
      description?: string;
      startsAt: Date;
      endsAt?: Date;
      venue?: string;
    },
  ): Promise<EventView> {
    assertDateRange(input.startsAt, input.endsAt);
    const baseSlug = slugify(input.title, 'event');
    const event = await createWithUniqueSlug(baseSlug, (slug) =>
      this.prisma.event.create({
        data: {
          organizationId: orgId,
          title: input.title,
          slug,
          description: input.description ?? null,
          startsAt: input.startsAt,
          endsAt: input.endsAt ?? null,
          venue: input.venue ?? null,
          createdBy: userId,
        },
      }),
    );
    return toView(event);
  }

  async listForOrg(orgId: string): Promise<EventView[]> {
    const rows = await this.prisma.event.findMany({
      where: { organizationId: orgId },
      orderBy: { startsAt: 'asc' },
    });
    return rows.map(toView);
  }

  async getInOrg(orgId: string, eventId: string): Promise<EventView> {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, organizationId: orgId },
    });
    if (!event) throw new NotFoundException();
    return toView(event);
  }

  async update(
    orgId: string,
    eventId: string,
    patch: {
      title?: string;
      description?: string;
      startsAt?: Date;
      endsAt?: Date;
      venue?: string;
      status?: EventStatus;
    },
  ): Promise<EventView> {
    const current = await this.prisma.event.findFirst({
      where: { id: eventId, organizationId: orgId },
    });
    if (!current) throw new NotFoundException();

    assertDateRange(patch.startsAt ?? current.startsAt, patch.endsAt ?? current.endsAt ?? undefined);

    const statusPatch = this.transition(current.status, patch.status);

    const updated = await this.prisma.event.update({
      where: { id: eventId },
      data: {
        title: patch.title ?? undefined,
        description: patch.description ?? undefined,
        startsAt: patch.startsAt ?? undefined,
        endsAt: patch.endsAt ?? undefined,
        venue: patch.venue ?? undefined,
        ...statusPatch,
      },
    });
    return toView(updated);
  }

  private transition(
    current: EventStatus,
    next: EventStatus | undefined,
  ): { status?: EventStatus; publishedAt?: Date } {
    if (next === undefined || next === current) return {};

    if (current === EventStatus.CANCELLED) {
      throw new BadRequestException('cancelled events cannot transition');
    }
    if (current === EventStatus.DRAFT && next === EventStatus.PUBLISHED) {
      return { status: next, publishedAt: new Date() };
    }
    if (current === EventStatus.DRAFT && next === EventStatus.CANCELLED) {
      return { status: next };
    }
    if (current === EventStatus.PUBLISHED && next === EventStatus.CANCELLED) {
      return { status: next };
    }
    throw new BadRequestException(
      `invalid status transition: ${current} → ${next}`,
    );
  }
}
