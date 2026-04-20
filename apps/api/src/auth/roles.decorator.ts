import { SetMetadata } from '@nestjs/common';
import type { MembershipRole } from '@organizer-hub/db/api';

export const ROLES_METADATA_KEY = 'organizer:requiredRoles';

export const Roles = (...roles: MembershipRole[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_METADATA_KEY, roles);
