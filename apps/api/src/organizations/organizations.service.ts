import { Injectable, NotFoundException } from '@nestjs/common';
import { MembershipRole } from '@organizer-hub/db/api';
import { createWithUniqueSlug, slugify } from '../common/slug';
import { PrismaService } from '../prisma/prisma.service';

export interface OrganizationView {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  role: MembershipRole;
  createdAt: Date;
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
    const baseSlug = slugify(input.name, 'org');
    const org = await createWithUniqueSlug(baseSlug, (slug) =>
      this.prisma.organization.create({
        data: {
          name: input.name,
          slug,
          description: input.description ?? null,
          createdBy: userId,
          memberships: {
            create: { userId, role: MembershipRole.OWNER },
          },
        },
      }),
    );
    return toView(org, MembershipRole.OWNER);
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
