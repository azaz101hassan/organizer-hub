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
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard, type AuthenticatedUser } from '../auth/jwt-auth.guard';
import { CreateEventLabelDto } from './dto/create-event-label.dto';
import { QueryEventLabelsDto } from './dto/query-event-labels.dto';
import { UpdateEventLabelDto } from './dto/update-event-label.dto';
import { EventLabelsService } from './event-labels.service';

// Flat surface (no /organizations/:orgId/… prefix) because the admin app is
// single-tenant — it passes HOUSE_ORG_ID via env on every request. Permission
// checks live in the service so we still gate against non-house-org members
// even though the URL no longer carries the org id.
@Controller('event-labels')
@UseGuards(JwtAuthGuard)
export class EventLabelsController {
  constructor(private readonly labels: EventLabelsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QueryEventLabelsDto,
  ) {
    return this.labels.listForUser(user.sub, query.organizationId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateEventLabelDto,
  ) {
    return this.labels.createForUser(user.sub, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateEventLabelDto,
  ) {
    return this.labels.updateForUser(user.sub, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.labels.deleteForUser(user.sub, id);
  }
}
