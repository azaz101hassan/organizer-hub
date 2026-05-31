import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { OrganizationRole } from '@organizer-hub/db/api';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CreateEventLabelDto } from './dto/create-event-label.dto';
import { UpdateEventLabelDto } from './dto/update-event-label.dto';
import { EventLabelsService } from './event-labels.service';

@Controller('organizations/:orgId/event-labels')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EventLabelsController {
  constructor(private readonly labels: EventLabelsService) {}

  @Get()
  @Roles(
    OrganizationRole.OWNER,
    OrganizationRole.ADMIN,
    OrganizationRole.MEMBER,
  )
  list(@Param('orgId') orgId: string) {
    return this.labels.listForOrg(orgId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN)
  create(@Param('orgId') orgId: string, @Body() dto: CreateEventLabelDto) {
    return this.labels.create(orgId, dto);
  }

  @Patch(':id')
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN)
  update(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body() dto: UpdateEventLabelDto,
  ) {
    return this.labels.update(orgId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN)
  remove(@Param('orgId') orgId: string, @Param('id') id: string) {
    return this.labels.delete(orgId, id);
  }
}
