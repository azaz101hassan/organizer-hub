import { Controller, Get, Param } from '@nestjs/common';
import { TicketTypesService } from './ticket-types.service';

// Anonymous read of ticket types for an event. Strips Stripe IDs — public
// callers see only the local id, name, priceCents, and minTierLevel. The
// caller is expected to combine this with /public/events/:id to render the
// purchase / claim affordances.
@Controller('public/events/:eventId/ticket-types')
export class PublicTicketTypesController {
  constructor(private readonly ticketTypes: TicketTypesService) {}

  @Get()
  list(@Param('eventId') eventId: string) {
    return this.ticketTypes.listPublic(eventId);
  }
}
