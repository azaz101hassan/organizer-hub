import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { MembershipRole } from '@organizer-hub/db/api';
import { PrismaService } from '../prisma/prisma.service';
import { ROLES_METADATA_KEY } from './roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<MembershipRole[] | undefined>(
      ROLES_METADATA_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!required || required.length === 0) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    if (!req.user) throw new ForbiddenException('no authenticated user');

    const orgId = (req.params.orgId ?? req.params.id) as string | undefined;
    if (!orgId) throw new ForbiddenException('route missing org identifier');

    const membership = await this.prisma.membership.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId: req.user.sub } },
      select: { role: true },
    });

    // Hide existence from non-members: 404 instead of 403.
    if (!membership) throw new NotFoundException();
    if (!required.includes(membership.role)) {
      throw new ForbiddenException('insufficient role');
    }
    return true;
  }
}
