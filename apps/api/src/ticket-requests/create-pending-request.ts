import {
  Prisma,
  TicketRequest,
  TicketRequestIntent,
  TicketRequestStatus,
} from '@organizer-hub/db/api';
import { PrismaService } from '../prisma/prisma.service';
import { WaitlistStream } from '../realtime/waitlist-stream';
import { TicketRequestView, toTicketRequestView } from './ticket-request-view';

// Plain functions, NOT a DI service, on purpose: the billing controller and
// the tickets service both call these to enter a request, and a provider would
// force a billing/tickets <-> ticket-requests module cycle. Function imports
// create no DI edge, so the module graph stays acyclic (the only DI direction
// is ticket-requests -> billing, in U7).

export interface CreatePendingRequestDeps {
  prisma: PrismaService;
  stream: WaitlistStream;
}

export interface CreatePendingRequestInput {
  userId: string;
  ticketTypeId: string;
  eventId: string;
  // Resolved by the caller (event.organizationId) so the SSE emit can target
  // the org channel — TicketRequest itself doesn't store orgId.
  orgId: string;
  intent: TicketRequestIntent;
}

// The open (PENDING/APPROVED) request a user already holds for a tier, if any.
// Predicate matches the partial unique index, so it is the authoritative
// "already queued?" lookup the intake paths consult before attempting a create.
export function findOpenRequestForUser(
  prisma: PrismaService,
  userId: string,
  ticketTypeId: string,
): Promise<TicketRequest | null> {
  return prisma.ticketRequest.findFirst({
    where: {
      userId,
      ticketTypeId,
      status: {
        in: [TicketRequestStatus.PENDING, TicketRequestStatus.APPROVED],
      },
    },
  });
}

// Enter an at-cap purchase/claim into the waitlist. Idempotent: a partial-unique
// P2002 (the user already has an open request for this tier) resolves to the
// existing request instead of erroring (AE17). Emits request.created to the org
// stream only for a genuinely new row, and only after the insert has committed.
export async function createPendingRequest(
  deps: CreatePendingRequestDeps,
  input: CreatePendingRequestInput,
): Promise<TicketRequestView> {
  try {
    const row = await deps.prisma.ticketRequest.create({
      data: {
        userId: input.userId,
        ticketTypeId: input.ticketTypeId,
        eventId: input.eventId,
        intent: input.intent,
        status: TicketRequestStatus.PENDING,
      },
    });
    const view = toTicketRequestView(row);
    deps.stream.emit(input.orgId, {
      type: 'request.created',
      id: view.id,
      data: view,
    });
    return view;
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      const existing = await findOpenRequestForUser(
        deps.prisma,
        input.userId,
        input.ticketTypeId,
      );
      if (existing) return toTicketRequestView(existing);
    }
    throw err;
  }
}
