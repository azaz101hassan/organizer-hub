import { Injectable, NotFoundException } from '@nestjs/common';
import { OrganizationRole } from '@organizer-hub/db/api';
import { createWithUniqueSlug, slugify } from '../common/slug';
import { PrismaService } from '../prisma/prisma.service';

export interface OrganizationView {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  role: OrganizationRole;
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
  role: OrganizationRole,
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
          members: {
            create: { userId, role: OrganizationRole.OWNER },
          },
        },
      }),
    );
    return toView(org, OrganizationRole.OWNER);
  }

  async listForUser(userId: string): Promise<OrganizationView[]> {
    const rows = await this.prisma.organizationMember.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      include: { organization: true },
    });
    return rows.map((row) => toView(row.organization, row.role));
  }

  async getForUser(userId: string, orgId: string): Promise<OrganizationView> {
    const member = await this.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId } },
      include: { organization: true },
    });
    // Non-members get 404, not 403, to avoid leaking existence.
    if (!member) throw new NotFoundException();
    return toView(member.organization, member.role);
  }
}
