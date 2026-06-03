import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { OrganizationRole } from '@organizer-hub/db/api';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CoalitionsService } from './coalitions.service';
import { CreateCoalitionDto } from './dto/create-coalition.dto';
import { ListCoalitionsAdminDto } from './dto/list-coalitions-admin.dto';
import { UpdateCoalitionDto } from './dto/update-coalition.dto';

// Org-scoped admin surface for coalition CRUD. RolesGuard reads :orgId from the
// path: 404 for non-members, 403 for members with insufficient role.
// No DonationsFeatureFlagGuard — admins must be able to provision coalitions
// even before donations are enabled on the org.
@Controller('orgs/:orgId/coalitions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminCoalitionsController {
  constructor(private readonly coalitions: CoalitionsService) {}

  @Get()
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN)
  list(@Param('orgId') orgId: string, @Query() query: ListCoalitionsAdminDto) {
    return this.coalitions.listAllForAdmin(orgId, query);
  }

  @Get(':id')
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN)
  getOne(@Param('orgId') orgId: string, @Param('id') id: string) {
    return this.coalitions.getForAdmin(orgId, id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN)
  create(@Param('orgId') orgId: string, @Body() body: CreateCoalitionDto) {
    return this.coalitions.createForAdmin(orgId, body);
  }

  @Patch(':id')
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN)
  update(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body() body: UpdateCoalitionDto,
  ) {
    return this.coalitions.updateForAdmin(orgId, id, body);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN)
  archive(@Param('orgId') orgId: string, @Param('id') id: string) {
    return this.coalitions.archiveForAdmin(orgId, id);
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN)
  restore(@Param('orgId') orgId: string, @Param('id') id: string) {
    return this.coalitions.restoreForAdmin(orgId, id);
  }
}
