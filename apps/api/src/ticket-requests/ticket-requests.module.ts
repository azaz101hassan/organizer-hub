import { Module } from '@nestjs/common';
import { AdminTicketRequestsController } from './admin-ticket-requests.controller';
import { AdminTicketRequestsService } from './admin-ticket-requests.service';
import { OpenRequestIndexCheck } from './open-request-index';
import { TicketRequestTransitions } from './ticket-request-transitions';

// Phase 4 waitlist domain module. The mechanism core (TicketRequestTransitions)
// + boot-time partial-index drift guard from U2, plus the admin moderation
// surface (U6: queue list, reject, MEMBERSHIP_CLAIM approve). Mailer,
// WaitlistStream, and Prisma all arrive via @Global modules, so nothing extra
// is imported. Requester endpoints (U8) and PAID approval (U7) land later.
@Module({
  controllers: [AdminTicketRequestsController],
  providers: [
    TicketRequestTransitions,
    AdminTicketRequestsService,
    OpenRequestIndexCheck,
  ],
  exports: [TicketRequestTransitions],
})
export class TicketRequestsModule {}
