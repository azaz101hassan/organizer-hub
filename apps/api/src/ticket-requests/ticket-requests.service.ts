import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  TicketRequestIntent,
  TicketRequestStatus,
} from '@organizer-hub/db/api';
import { CheckoutSessionFactory } from '../billing/checkout-session.factory';
import { PrismaService } from '../prisma/prisma.service';
import { WaitlistStream } from '../realtime/waitlist-stream';
import { TicketRequestView, toTicketRequestView } from './ticket-request-view';

// The live "Complete payment" link + expiry for an APPROVED-awaiting-payment
// PAID request. `url` is null once Stripe has expired the session.
export interface PaymentLinkView {
  url: string | null;
  expiresAt: Date | null;
}

// Requester-facing view. Extends the base view with denormalized event/tier
// display fields and `hasTicket`, which distinguishes APPROVED-awaiting-payment
// (PAID, no Ticket yet) from APPROVED-with-ticket (I1).
export interface RequesterTicketRequestView extends TicketRequestView {
  event: { id: string; title: string; startsAt: Date };
  ticketTypeName: string;
  ticketTypePriceCents: number;
  hasTicket: boolean;
}

type RequesterRow = Prisma.TicketRequestGetPayload<{
  include: {
    event: {
      select: {
        id: true;
        title: true;
        startsAt: true;
        organizationId: true;
      };
    };
    ticketType: { select: { name: true; priceCents: true } };
    ticket: { select: { id: true } };
  };
}>;

const REQUESTER_INCLUDE = {
  event: {
    select: { id: true, title: true, startsAt: true, organizationId: true },
  },
  ticketType: { select: { name: true, priceCents: true } },
  ticket: { select: { id: true } },
} as const;

function toRequesterView(r: RequesterRow): RequesterTicketRequestView {
  return {
    ...toTicketRequestView(r),
    event: { id: r.event.id, title: r.event.title, startsAt: r.event.startsAt },
    ticketTypeName: r.ticketType.name,
    ticketTypePriceCents: r.ticketType.priceCents,
    hasTicket: r.ticket !== null,
  };
}

// Requester orchestration (U8): list own requests, view one (existence-hidden),
// and idempotently self-cancel a PENDING request. Ownership is enforced at the
// WHERE level (userId = caller.sub) so another user's request returns 404, not
// 403 (hide-existence, R27).
@Injectable()
export class TicketRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stream: WaitlistStream,
    // From the @Global BillingModule — the one-way ticket-requests -> billing
    // dependency, reused here to re-read the Checkout session URL + expiry.
    private readonly checkoutSessions: CheckoutSessionFactory,
  ) {}

  async listForUser(userId: string): Promise<RequesterTicketRequestView[]> {
    const rows = await this.prisma.ticketRequest.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: REQUESTER_INCLUDE,
    });
    return rows.map(toRequesterView);
  }

  async getForUser(
    userId: string,
    id: string,
  ): Promise<RequesterTicketRequestView> {
    const row = await this.findOwn(userId, id);
    if (!row) throw new NotFoundException();
    return toRequesterView(row);
  }

  // Idempotent self-cancel (R6, AE8): CAS PENDING -> CANCELLED_BY_USER scoped to
  // the caller. A second cancel of an already-cancelled request re-reads and
  // returns 200; cancelling a decided (APPROVED/REJECTED/EXPIRED) request 409s.
  // No email, no audit row — no admin is involved. Emits request.removed so the
  // admin queue drops the row live.
  async cancel(
    userId: string,
    id: string,
  ): Promise<RequesterTicketRequestView> {
    const row = await this.findOwn(userId, id);
    if (!row) throw new NotFoundException();

    const { count } = await this.prisma.ticketRequest.updateMany({
      where: { id, userId, status: TicketRequestStatus.PENDING },
      data: { status: TicketRequestStatus.CANCELLED_BY_USER },
    });

    if (count === 0) {
      const fresh = await this.findOwn(userId, id);
      if (fresh?.status === TicketRequestStatus.CANCELLED_BY_USER) {
        return toRequesterView(fresh);
      }
      throw new ConflictException('Request can no longer be cancelled.');
    }

    this.stream.emit(row.event.organizationId, {
      type: 'request.removed',
      id,
      data: { id, status: TicketRequestStatus.CANCELLED_BY_USER },
    });
    return {
      ...toRequesterView(row),
      status: TicketRequestStatus.CANCELLED_BY_USER,
    };
  }

  // The live Checkout link + expiry for the caller's APPROVED-awaiting-payment
  // PAID request (U11's "Complete payment" CTA). 404 hides a non-owned/unknown
  // request; 409 for any request that is not actually awaiting payment (wrong
  // intent/status, already ticketed, or no session linked) so the web only
  // calls this for the one state that has a link.
  async getPaymentLink(userId: string, id: string): Promise<PaymentLinkView> {
    const row = await this.findOwn(userId, id);
    if (!row) throw new NotFoundException();

    // The null check is last so TS narrows stripeCheckoutSessionId to string
    // for the retrieve call below.
    if (
      row.intent !== TicketRequestIntent.PAID ||
      row.status !== TicketRequestStatus.APPROVED ||
      row.ticket !== null ||
      row.stripeCheckoutSessionId === null
    ) {
      throw new ConflictException('This request has no active payment link.');
    }

    return this.checkoutSessions.retrieveTicketSession(
      row.stripeCheckoutSessionId,
    );
  }

  private findOwn(userId: string, id: string): Promise<RequesterRow | null> {
    return this.prisma.ticketRequest.findFirst({
      where: { id, userId },
      include: REQUESTER_INCLUDE,
    });
  }
}
