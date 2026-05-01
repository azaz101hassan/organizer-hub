import { SetMetadata } from '@nestjs/common';
import type { OrganizationRole } from '@organizer-hub/db/api';

export const ROLES_METADATA_KEY = 'organizer:requiredRoles';

export const Roles = (
  ...roles: OrganizationRole[]
): MethodDecorator & ClassDecorator => SetMetadata(ROLES_METADATA_KEY, roles);
