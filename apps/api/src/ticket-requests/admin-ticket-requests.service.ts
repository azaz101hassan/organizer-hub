import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  TicketRequestDecision,
  TicketRequestIntent,
  TicketRequestStatus,
  TicketSource,
} from '@organizer-hub/db/api';
import { decodeTupleCursor, encodeTupleCursor } from '../common/cursor';
import { Mailer } from '../mail/mailer';
import { PrismaService } from '../prisma/prisma.service';
import { WaitlistStream } from '../realtime/waitlist-stream';
import { TicketRequestTransitions } from './ticket-request-transitions';

// Admin-facing view: the requester contact + tier/event context + the cap and
// current issued count so the queue can show the non-blocking over-cap warning
// (R12). issuedCount is the derived count(Ticket); it does not move for a PAID
// approval until payment.
export interface AdminTicketRequestView {
  id: string;
  userId: string;
  userEmail: string | null;
  userName: string | null;
  intent: TicketRequestIntent;
  status: TicketRequestStatus;
  createdAt: Date;
  event: { id: string; title: string };
  ticketType: { id: string; name: string; cap: number | null };
  issuedCount: number;
}

export interface AdminQueuePage {
  items: AdminTicketRequestView[];
  nextCursor: string | null;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

type RequestWithCtx = Prisma.TicketRequestGetPayload<{
  include: {
    event: { select: { id: true; title: true } };
    ticketType: { select: { id: true; name: true; cap: true } };
  };
}>;

const REQUEST_CTX_INCLUDE = {
  event: { select: { id: true, title: true } },
  ticketType: { select: { id: true, name: true, cap: true } },
} as const;

function toView(
  r: RequestWithCtx,
  issuedCount: number,
  statusOverride?: TicketRequestStatus,
): AdminTicketRequestView {
  return {
    id: r.id,
    userId: r.userId,
    userEmail: r.userEmail,
    userName: r.userName,
    intent: r.intent,
    status: statusOverride ?? r.status,
    createdAt: r.createdAt,
    event: { id: r.event.id, title: r.event.title },
    ticketType: {
      id: r.ticketType.id,
      name: r.ticketType.name,
      cap: r.ticketType.cap,
    },
    issuedCount,
  };
}

// Per-actor admin orchestration: list the queue, reject, and approve a
// MEMBERSHIP_CLAIM. The PAID approve path (mint + reconcile) lands in U7. Each
// mutation runs the CAS + audit (+ Ticket for claim) through the U2 transitions
// core inside one transaction, then fires email + SSE only after commit.
@Injectable()
export class AdminTicketRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transitions: TicketRequestTransitions,
    private readonly mailer: Mailer,
    private readonly stream: WaitlistStream,
  ) {}

  // FIFO (oldest first) pending queue for the org, cursor-paginated so a burst
  // of requests never returns all requester PII in one unbounded payload.
  async listPending(
    orgId: string,
    opts: { cursor?: string; limit?: number },
  ): Promise<AdminQueuePage> {
    const take = Math.min(Math.max(1, opts.limit ?? DEFAULT_LIMIT), MAX_LIMIT);

    let tupleFilter: Prisma.TicketRequestWhereInput = {};
    if (opts.cursor) {
      const c = decodeTupleCursor(opts.cursor);
      tupleFilter = {
        OR: [
          { createdAt: { gt: c.at } },
          { createdAt: c.at, id: { gt: c.id } },
        ],
      };
    }

    const rows = await this.prisma.ticketRequest.findMany({
      where: {
        status: TicketRequestStatus.PENDING,
        event: { organizationId: orgId },
        ...tupleFilter,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: take + 1,
      include: REQUEST_CTX_INCLUDE,
    });

    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    const counts = await this.issuedCountsFor(page.map((r) => r.ticketTypeId));
    const items = page.map((r) => toView(r, counts.get(r.ticketTypeId) ?? 0));
    const last = page[page.length - 1];
    return {
      items,
      nextCursor:
        hasMore && last
          ? encodeTupleCursor({ at: last.createdAt, id: last.id })
          : null,
    };
  }

  // Reject (R13): CAS PENDING->REJECTED + audit in one tx, then rejection
  // email + SSE post-commit. No Stripe. issuedCount is unchanged (before ==
  // after) — a reject never issues.
  async reject(
    orgId: string,
    adminSub: string,
    id: string,
    reason?: string,
  ): Promise<AdminTicketRequestView> {
    const req = await this.assertRequestInOrg(id, orgId);
    const issuedCount = await this.prisma.ticket.count({
      where: { ticketTypeId: req.ticketTypeId },
    });

    await this.prisma.$transaction(async (tx) => {
      await this.transitions.transition(
        id,
        TicketRequestStatus.PENDING,
        TicketRequestStatus.REJECTED,
        tx,
      );
      await this.transitions.writeAudit(tx, {
        ticketRequestId: id,
        adminUserId: adminSub,
        decision: TicketRequestDecision.REJECT,
        capAtDecision: req.ticketType.cap,
        issuedCountBefore: issuedCount,
        issuedCountAfter: issuedCount,
      });
    });

    const view = toView(req, issuedCount, TicketRequestStatus.REJECTED);
    if (req.userEmail) {
      await this.mailer.send({
        template: 'rejected',
        to: req.userEmail,
        props: {
          requesterName: req.userName ?? 'there',
          eventTitle: req.event.title,
          tierName: req.ticketType.name,
          reason,
        },
      });
    }
    this.stream.emit(orgId, { type: 'request.updated', id, data: view });
    return view;
  }

  // Approve a MEMBERSHIP_CLAIM (R10): issue the Ticket inline. Runs at
  // Serializable with a single retry on a write-conflict (P2034) so the
  // audit's before/after issued counts stay honest under concurrent issuance
  // (you cannot FOR UPDATE a COUNT(*)). A CAS loss or a duplicate Ticket
  // (Ticket.ticketRequestId @unique) both resolve to 409. PAID approval is U7.
  async approveClaim(
    orgId: string,
    adminSub: string,
    id: string,
  ): Promise<AdminTicketRequestView> {
    const req = await this.assertRequestInOrg(id, orgId);
    if (req.intent !== TicketRequestIntent.MEMBERSHIP_CLAIM) {
      throw new ConflictException(
        'This is a paid request; approve it through the paid flow.',
      );
    }

    let issuedCountBefore: number;
    try {
      issuedCountBefore = await this.runSerializableWithRetry(async (tx) => {
        const before = await tx.ticket.count({
          where: { ticketTypeId: req.ticketTypeId },
        });
        await this.transitions.transition(
          id,
          TicketRequestStatus.PENDING,
          TicketRequestStatus.APPROVED,
          tx,
        );
        await tx.ticket.create({
          data: {
            userId: req.userId,
            eventId: req.eventId,
            ticketTypeId: req.ticketTypeId,
            source: TicketSource.MEMBERSHIP_CLAIM,
            ticketRequestId: id,
          },
        });
        await this.transitions.writeAudit(tx, {
          ticketRequestId: id,
          adminUserId: adminSub,
          decision: TicketRequestDecision.APPROVE,
          capAtDecision: req.ticketType.cap,
          issuedCountBefore: before,
          issuedCountAfter: before + 1,
        });
        return before;
      });
    } catch (err) {
      // A second concurrent approve trips Ticket.ticketRequestId @unique
      // (P2002) or a serialization conflict that survived the retry (P2034).
      // Both mean "another actor already moved this" -> 409.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        (err.code === 'P2002' || err.code === 'P2034')
      ) {
        throw new ConflictException('Request was already decided.');
      }
      throw err;
    }

    const issuedCount = issuedCountBefore + 1;
    const view = toView(req, issuedCount, TicketRequestStatus.APPROVED);
    if (req.userEmail) {
      await this.mailer.send({
        template: 'claim-approved',
        to: req.userEmail,
        props: {
          requesterName: req.userName ?? 'there',
          eventTitle: req.event.title,
          tierName: req.ticketType.name,
        },
      });
    }
    this.stream.emit(orgId, { type: 'request.updated', id, data: view });
    return view;
  }

  // Belongs-to-org re-check (R/sec): RolesGuard only proves the caller holds a
  // role on :orgId, not that the request's event belongs to that org. Filter at
  // the WHERE level and 404 on mismatch (hide-existence).
  private async assertRequestInOrg(
    id: string,
    orgId: string,
  ): Promise<RequestWithCtx> {
    const req = await this.prisma.ticketRequest.findFirst({
      where: { id, event: { organizationId: orgId } },
      include: REQUEST_CTX_INCLUDE,
    });
    if (!req) throw new NotFoundException();
    return req;
  }

  private async issuedCountsFor(
    ticketTypeIds: string[],
  ): Promise<Map<string, number>> {
    if (ticketTypeIds.length === 0) return new Map();
    const groups = await this.prisma.ticket.groupBy({
      by: ['ticketTypeId'],
      where: { ticketTypeId: { in: ticketTypeIds } },
      _count: { _all: true },
    });
    return new Map(groups.map((g) => [g.ticketTypeId, g._count._all]));
  }

  private async runSerializableWithRetry<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await this.prisma.$transaction(fn, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (err) {
        lastErr = err;
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2034' &&
          attempt === 0
        ) {
          continue;
        }
        throw err;
      }
    }
    throw lastErr;
  }
}
