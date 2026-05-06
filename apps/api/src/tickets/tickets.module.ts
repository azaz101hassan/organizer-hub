import { Module } from '@nestjs/common';
import { MembershipsModule } from '../memberships/memberships.module';
import { PublicTicketTypesController } from './public-tickets.controller';
import { TicketTypesController } from './ticket-types.controller';
import { TicketTypesService } from './ticket-types.service';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';

// Co-located TicketType (organizer config) + Ticket (issued claims) APIs.
// MembershipsModule is imported for TicketsService.claimFree's eligibility
// check; MembershipsService.canClaimFree delegates back into the same
// rule set.
@Module({
  imports: [MembershipsModule],
  controllers: [
    TicketTypesController,
    PublicTicketTypesController,
    TicketsController,
  ],
  providers: [TicketTypesService, TicketsService],
  exports: [TicketTypesService, TicketsService],
})
export class TicketsModule {}
