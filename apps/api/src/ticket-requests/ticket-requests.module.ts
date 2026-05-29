import { Module } from '@nestjs/common';
import { OpenRequestIndexCheck } from './open-request-index';
import { TicketRequestTransitions } from './ticket-request-transitions';

// Phase 4 waitlist domain module. U2 ships only the mechanism core
// (TicketRequestTransitions: CAS transition + audit write + open-request lookup
// + view mapper) plus a boot-time guard that the Prisma-inexpressible partial
// unique index has not drifted away. Per-actor orchestration (admin
// approve/reject in U6/U7, requester list/cancel in U8) and the HTTP endpoints
// arrive in later units. PrismaModule is @Global, so it needs no import here.
@Module({
  providers: [TicketRequestTransitions, OpenRequestIndexCheck],
  exports: [TicketRequestTransitions],
})
export class TicketRequestsModule {}
