import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { OrganizationRole } from '@organizer-hub/db/api';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { DonationsService } from './donations.service';
import { ListDonationsAdminDto } from './dto/list-donations-admin.dto';

// Org-scoped admin surface for donations list + force-cancel. RolesGuard
// reads :orgId from the path: 404 for non-members, 403 for members with
// insufficient role.
@Controller('orgs/:orgId/donations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminDonationsController {
  constructor(private readonly donations: DonationsService) {}

  @Get()
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN)
  list(@Param('orgId') orgId: string, @Query() query: ListDonationsAdminDto) {
    return this.donations.listForAdmin(orgId, query);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN)
  cancel(@Param('orgId') orgId: string, @Param('id') id: string) {
    return this.donations.forceCancelForAdmin(orgId, id);
  }
}
