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
import { CampaignsService } from './campaigns.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { ListCampaignsAdminDto } from './dto/list-campaigns-admin.dto';
import { TransitionCampaignDto } from './dto/transition-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';

// Org-scoped admin surface for campaign CRUD + status transitions. RolesGuard
// reads :orgId from the path: 404 for non-members, 403 for members with
// insufficient role. No DonationsFeatureFlagGuard — admins manage the feature.
@Controller('orgs/:orgId/campaigns')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminCampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Get()
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN)
  list(@Param('orgId') orgId: string, @Query() query: ListCampaignsAdminDto) {
    return this.campaigns.listAllForAdmin(orgId, query);
  }

  @Get(':id')
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN)
  getOne(@Param('orgId') orgId: string, @Param('id') id: string) {
    return this.campaigns.getForAdmin(orgId, id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN)
  create(@Param('orgId') orgId: string, @Body() body: CreateCampaignDto) {
    return this.campaigns.createForAdmin(orgId, body);
  }

  @Patch(':id')
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN)
  update(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body() body: UpdateCampaignDto,
  ) {
    return this.campaigns.updateForAdmin(orgId, id, body);
  }

  @Post(':id/transition')
  @HttpCode(HttpStatus.OK)
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN)
  transition(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body() body: TransitionCampaignDto,
  ) {
    return this.campaigns.transition(orgId, id, body.to);
  }
}
