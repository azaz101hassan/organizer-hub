import { ConflictException, Injectable } from '@nestjs/common';
import {
  Prisma,
  TicketRequest,
  TicketRequestDecision,
  TicketRequestIntent,
  TicketRequestStatus,
} from '@organizer-hub/db/api';
import { PrismaService } from '../prisma/prisma.service';

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

type TxClient = Prisma.TransactionClient;

// Mechanism core for the waitlist lifecycle — the single race chokepoint
// (R25). Holds the compare-and-set transition, the audit-write helper, the
// open-request lookup, and the view mapper. It does NOT orchestrate: which
// actor moves a request and which side-effects fire (Stripe, email, SSE) is
// the concern of the per-actor services in U6/U7 (admin) and U8 (requester).
@Injectable()
export class TicketRequestTransitions {
  constructor(private readonly prisma: PrismaService) {}

  // Compare-and-set: flip status from -> to iff the row is currently `from`.
  // count === 1 wins and returns the updated row; count === 0 means another
  // actor already moved it -> ConflictException (409). Pass `tx` to compose the
  // flip with audit / Ticket writes in one transaction. External side-effects
  // (Stripe session, email, SSE emit) must run only AFTER a win has committed.
  async transition(
    id: string,
    from: TicketRequestStatus,
    to: TicketRequestStatus,
    tx?: TxClient,
  ): Promise<TicketRequest> {
    const db = tx ?? this.prisma;
    const { count } = await db.ticketRequest.updateMany({
      where: { id, status: from },
      data: { status: to },
    });
    if (count === 0) {
      throw new ConflictException(`Ticket request ${id} is no longer ${from}`);
    }
    return db.ticketRequest.findUniqueOrThrow({ where: { id } });
  }

  // Append one admin-decision audit row (R14). Always called inside the
  // caller's transaction so "transition + audit (+ Ticket)" commit atomically.
  async writeAudit(
    tx: TxClient,
    input: {
      ticketRequestId: string;
      adminUserId: string;
      decision: TicketRequestDecision;
      capAtDecision: number | null;
      issuedCountBefore: number;
      issuedCountAfter: number;
    },
  ): Promise<void> {
    await tx.ticketRequestAudit.create({ data: input });
  }

  // The open request a user already holds for a tier (PENDING or APPROVED), if
  // any — the predicate matches the partial unique index. Lets intake return
  // the existing request instead of surfacing the raw P2002, and lets the
  // at-cap affordance deep-link it.
  async findOpenForUser(
    userId: string,
    ticketTypeId: string,
  ): Promise<TicketRequest | null> {
    return this.prisma.ticketRequest.findFirst({
      where: {
        userId,
        ticketTypeId,
        status: {
          in: [TicketRequestStatus.PENDING, TicketRequestStatus.APPROVED],
        },
      },
    });
  }

  toView(r: TicketRequest): TicketRequestView {
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
}
