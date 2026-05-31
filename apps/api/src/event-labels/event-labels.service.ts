import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@organizer-hub/db/api';
import { PrismaService } from '../prisma/prisma.service';

export interface EventLabelView {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

interface DbEventLabel {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

function toView(l: DbEventLabel): EventLabelView {
  return {
    id: l.id,
    organizationId: l.organizationId,
    name: l.name,
    slug: l.slug,
    sortOrder: l.sortOrder,
    createdAt: l.createdAt,
    updatedAt: l.updatedAt,
  };
}

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
}

@Injectable()
export class EventLabelsService {
  constructor(private readonly prisma: PrismaService) {}

  async listForOrg(orgId: string): Promise<EventLabelView[]> {
    const rows = await this.prisma.eventLabel.findMany({
      where: { organizationId: orgId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return rows.map(toView);
  }

  async create(
    orgId: string,
    input: { name: string; slug: string; sortOrder?: number },
  ): Promise<EventLabelView> {
    try {
      const label = await this.prisma.eventLabel.create({
        data: {
          organizationId: orgId,
          name: input.name,
          slug: input.slug,
          sortOrder: input.sortOrder ?? 0,
        },
      });
      return toView(label);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException('Duplicate slug for organization');
      }
      throw err;
    }
  }

  async update(
    orgId: string,
    id: string,
    patch: { name?: string; slug?: string; sortOrder?: number },
  ): Promise<EventLabelView> {
    const current = await this.prisma.eventLabel.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!current) throw new NotFoundException();
    try {
      const updated = await this.prisma.eventLabel.update({
        where: { id },
        data: patch,
      });
      return toView(updated);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException('Duplicate slug for organization');
      }
      throw err;
    }
  }

  async delete(orgId: string, id: string): Promise<void> {
    const current = await this.prisma.eventLabel.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!current) throw new NotFoundException();
    const eventCount = await this.prisma.event.count({
      where: { labelId: id },
    });
    if (eventCount > 0) {
      throw new ConflictException({
        message: 'Label is referenced by events',
        eventCount,
      });
    }
    await this.prisma.eventLabel.delete({ where: { id } });
  }
}
