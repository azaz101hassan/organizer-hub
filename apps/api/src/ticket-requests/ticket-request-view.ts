import {
  TicketRequest,
  TicketRequestIntent,
  TicketRequestStatus,
} from '@organizer-hub/db/api';

// The shape callers and the SSE hub see. Kept as a pure mapper (no DI) so the
// intake helper, the transitions core, and the per-actor services all map the
// same way. Denormalized display fields (event/tier names) are layered on by
// the requester/admin services in U8/U6 where the joins are available.
export interface TicketRequestView {
  id: string;
  userId: string;
  ticketTypeId: string;
  eventId: string;
  intent: TicketRequestIntent;
  status: TicketRequestStatus;
  stripeCheckoutSessionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toTicketRequestView(r: TicketRequest): TicketRequestView {
  return {
    id: r.id,
    userId: r.userId,
    ticketTypeId: r.ticketTypeId,
    eventId: r.eventId,
    intent: r.intent,
    status: r.status,
    stripeCheckoutSessionId: r.stripeCheckoutSessionId,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}
