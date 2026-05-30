import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { OrganizationRole } from '@organizer-hub/db/api';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard, type AuthenticatedUser } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AdminTicketRequestsService } from './admin-ticket-requests.service';
import { RejectRequestDto } from './dto/reject-request.dto';

// Org-scoped moderation queue. RolesGuard reads :orgId from the path and
// 404-hides for non-members / 403s for non-admins, exactly like the
// ticket-types admin surface.
@Controller('orgs/:orgId/requests')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminTicketRequestsController {
  constructor(private readonly admin: AdminTicketRequestsService) {}

  @Get()
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN)
  list(
    @Param('orgId') orgId: string,
    @Query('cursor') cursor?: string,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit?: number,
  ) {
    return this.admin.listPending(orgId, { cursor, limit });
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN)
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body() dto: RejectRequestDto,
  ) {
    return this.admin.reject(orgId, user.sub, id, dto.reason);
  }

  // Dispatches by intent: MEMBERSHIP_CLAIM issues a Ticket inline; PAID mints an
  // expiring Checkout link and emails it.
  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN)
  approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orgId') orgId: string,
    @Param('id') id: string,
  ) {
    return this.admin.approve(orgId, user.sub, id);
  }
}
