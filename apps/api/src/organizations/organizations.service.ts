import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MembershipRole, Prisma } from '@organizer-hub/db/api';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

export interface OrganizationView {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  role: MembershipRole;
  createdAt: Date;
}

const SLUG_MAX_ATTEMPTS = 5;

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return base || 'org';
}

function suffixSlug(base: string): string {
  return `${base}-${randomBytes(2).toString('hex')}`;
}

function toView(
  org: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    createdAt: Date;
  },
  role: MembershipRole,
): OrganizationView {
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    description: org.description,
    role,
    createdAt: org.createdAt,
  };
}

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  async createForUser(
    userId: string,
    input: { name: string; description?: string },
  ): Promise<OrganizationView> {
    const baseSlug = slugify(input.name);

    for (let attempt = 0; attempt < SLUG_MAX_ATTEMPTS; attempt++) {
      const slug = attempt === 0 ? baseSlug : suffixSlug(baseSlug);
      try {
        const org = await this.prisma.organization.create({
          data: {
            name: input.name,
            slug,
            description: input.description ?? null,
            createdBy: userId,
            memberships: {
              create: { userId, role: MembershipRole.OWNER },
            },
          },
        });
        return toView(org, MembershipRole.OWNER);
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          continue;
        }
        throw err;
      }
    }

    throw new ConflictException('could not allocate a unique slug');
  }

  async listForUser(userId: string): Promise<OrganizationView[]> {
    const rows = await this.prisma.membership.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      include: { organization: true },
    });
    return rows.map((row) => toView(row.organization, row.role));
  }

  async getForUser(userId: string, orgId: string): Promise<OrganizationView> {
    const membership = await this.prisma.membership.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId } },
      include: { organization: true },
    });
    // Non-members get 404, not 403, to avoid leaking existence.
    if (!membership) throw new NotFoundException();
    return toView(membership.organization, membership.role);
  }
}
