import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrganizationRole, Prisma } from '@organizer-hub/db/api';
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

const WRITE_ROLES: ReadonlySet<OrganizationRole> = new Set([
  OrganizationRole.OWNER,
  OrganizationRole.ADMIN,
]);

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

  // Membership lookup that mirrors RolesGuard: missing membership leaks as 404
  // (no existence hint); membership without an allowed role leaks as 403.
  private async requireRole(
    userId: string,
    organizationId: string,
    allowed: ReadonlySet<OrganizationRole>,
  ): Promise<void> {
    const member = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: { organizationId, userId },
      },
      select: { role: true },
    });
    if (!member) throw new NotFoundException();
    if (!allowed.has(member.role)) {
      throw new ForbiddenException('insufficient role');
    }
  }

  async listForUser(
    userId: string,
    organizationId: string,
  ): Promise<EventLabelView[]> {
    // Any role can read.
    await this.requireRole(
      userId,
      organizationId,
      new Set([
        OrganizationRole.OWNER,
        OrganizationRole.ADMIN,
        OrganizationRole.MEMBER,
      ]),
    );
    const rows = await this.prisma.eventLabel.findMany({
      where: { organizationId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return rows.map(toView);
  }

  async createForUser(
    userId: string,
    input: {
      organizationId: string;
      name: string;
      slug: string;
      sortOrder?: number;
    },
  ): Promise<EventLabelView> {
    await this.requireRole(userId, input.organizationId, WRITE_ROLES);
    try {
      const label = await this.prisma.eventLabel.create({
        data: {
          organizationId: input.organizationId,
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

  async updateForUser(
    userId: string,
    id: string,
    patch: { name?: string; slug?: string; sortOrder?: number },
  ): Promise<EventLabelView> {
    const current = await this.prisma.eventLabel.findUnique({ where: { id } });
    if (!current) throw new NotFoundException();
    await this.requireRole(userId, current.organizationId, WRITE_ROLES);
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

  async deleteForUser(userId: string, id: string): Promise<void> {
    const current = await this.prisma.eventLabel.findUnique({ where: { id } });
    if (!current) throw new NotFoundException();
    await this.requireRole(userId, current.organizationId, WRITE_ROLES);
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
