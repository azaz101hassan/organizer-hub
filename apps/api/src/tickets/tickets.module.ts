import { Module } from '@nestjs/common';
import { PublicTicketTypesController } from './public-tickets.controller';
import { TicketTypesController } from './ticket-types.controller';
import { TicketTypesService } from './ticket-types.service';

// Co-located TicketType auth + public surfaces. The Ticket model (per-user
// issued tickets) lands in U7 and registers its controller(s) here too.
@Module({
  controllers: [TicketTypesController, PublicTicketTypesController],
  providers: [TicketTypesService],
  exports: [TicketTypesService],
})
export class TicketsModule {}
