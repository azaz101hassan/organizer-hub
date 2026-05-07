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
import { CreateTicketTypeDto } from './dto/create-ticket-type.dto';
import { UpdateTicketTypeDto } from './dto/update-ticket-type.dto';
import { TicketTypesService } from './ticket-types.service';

@Controller('organizations/:orgId/events/:eventId/ticket-types')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TicketTypesController {
  constructor(private readonly ticketTypes: TicketTypesService) {}

  @Get()
  @Roles(
    OrganizationRole.OWNER,
    OrganizationRole.ADMIN,
    OrganizationRole.MEMBER,
  )
  list(@Param('orgId') orgId: string, @Param('eventId') eventId: string) {
    return this.ticketTypes.listForEvent(orgId, eventId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN)
  create(
    @Param('orgId') orgId: string,
    @Param('eventId') eventId: string,
    @Body() dto: CreateTicketTypeDto,
  ) {
    return this.ticketTypes.create(orgId, eventId, dto);
  }

  @Patch(':typeId')
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN)
  update(
    @Param('orgId') orgId: string,
    @Param('eventId') eventId: string,
    @Param('typeId') typeId: string,
    @Body() dto: UpdateTicketTypeDto,
  ) {
    return this.ticketTypes.update(orgId, eventId, typeId, dto);
  }

  @Delete(':typeId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN)
  async remove(
    @Param('orgId') orgId: string,
    @Param('eventId') eventId: string,
    @Param('typeId') typeId: string,
  ) {
    await this.ticketTypes.delete(orgId, eventId, typeId);
  }
}
