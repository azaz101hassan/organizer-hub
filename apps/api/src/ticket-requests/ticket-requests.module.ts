import { Module } from '@nestjs/common';
import { AdminTicketRequestsController } from './admin-ticket-requests.controller';
import { AdminTicketRequestsService } from './admin-ticket-requests.service';
import { OpenRequestIndexCheck } from './open-request-index';
import { TicketRequestTransitions } from './ticket-request-transitions';
import { TicketRequestsController } from './ticket-requests.controller';
import { TicketRequestsService } from './ticket-requests.service';

// Phase 4 waitlist domain module: the mechanism core (TicketRequestTransitions)
// + boot-time partial-index drift guard (U2), the admin moderation surface (U6:
// queue list, reject, claim/paid approve), and the requester surface (U8: list,
// get, self-cancel). Mailer, WaitlistStream, Billing, and Prisma all arrive via
// @Global modules, so nothing extra is imported.
@Module({
  controllers: [AdminTicketRequestsController, TicketRequestsController],
  providers: [
    TicketRequestTransitions,
    AdminTicketRequestsService,
    TicketRequestsService,
    OpenRequestIndexCheck,
  ],
  exports: [TicketRequestTransitions],
})
export class TicketRequestsModule {}
