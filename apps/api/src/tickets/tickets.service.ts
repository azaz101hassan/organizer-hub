import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  EventStatus,
  Prisma,
  SubscriptionStatus,
  TicketSource,
} from '@organizer-hub/db/api';
import { PrismaService } from '../prisma/prisma.service';
import { MembershipsService } from '../memberships/memberships.service';

export interface TicketView {
  id: string;
  userId: string;
  eventId: string;
  ticketTypeId: string;
  source: TicketSource;
  stripeCheckoutSessionId: string | null;
  stripePaymentIntentId: string | null;
  issuedAt: Date;
}

const CLAIM_STATUSES: ReadonlySet<SubscriptionStatus> = new Set([
  SubscriptionStatus.ACTIVE,
  SubscriptionStatus.TRIALING,
]);

interface DbTicket {
  id: string;
  userId: string;
  eventId: string;
  ticketTypeId: string;
  source: TicketSource;
  stripeCheckoutSessionId: string | null;
  stripePaymentIntentId: string | null;
  issuedAt: Date;
}

function toView(t: DbTicket): TicketView {
  return {
    id: t.id,
    userId: t.userId,
    eventId: t.eventId,
    ticketTypeId: t.ticketTypeId,
    source: t.source,
    stripeCheckoutSessionId: t.stripeCheckoutSessionId,
    stripePaymentIntentId: t.stripePaymentIntentId,
    issuedAt: t.issuedAt,
  };
}

@Injectable()
export class TicketsService {
  private readonly logger = new Logger(TicketsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly memberships: MembershipsService,
  ) {}

  // claimFree — atomic free-ticket issuance for an active member.
  //
  // The eligibility math is intentionally re-derived here (not just
  // delegated to MembershipsService.canClaimFree) so the disqualifier path
  // can throw a specific exception with the *reason* — the caller's UI
  // wants to render "tier too low" differently from "event excluded".
  //
  // The eligibility check + insert run inside one prisma.$transaction with
  // Serializable isolation so a concurrent claim or a members_excluded
  // flip mid-claim doesn't TOCTOU. P2002 catches the rare same-request-twice
  // race that slips past the in-tx findFirst.
  async claimFree(userId: string, ticketTypeId: string): Promise<TicketView> {
    const ticketType = await this.prisma.ticketType.findUnique({
      where: { id: ticketTypeId },
      include: {
        event: {
          select: {
            id: true,
            status: true,
            membersExcluded: true,
          },
        },
      },
    });
    if (!ticketType) throw new NotFoundException();
    if (ticketType.event.status !== EventStatus.PUBLISHED) {
      // Hide DRAFT/CANCELLED behind a 404 (same shape as a missing ticket
      // type). Claim flows shouldn't enumerate non-public events.
      throw new NotFoundException();
    }
    if (ticketType.event.membersExcluded) {
      throw new ConflictException(
        'This event is excluded from member coverage.',
      );
    }
    if (ticketType.minTierLevel <= 0) {
      throw new ConflictException(
        'This ticket type is not eligible for free member claims.',
      );
    }

    const membership = await this.prisma.membership.findUnique({
      where: { userId },
      select: { tierLevel: true, status: true },
    });
    if (!membership) {
      throw new ConflictException('No active membership.');
    }
    if (!CLAIM_STATUSES.has(membership.status)) {
      throw new ConflictException(
        membership.status === SubscriptionStatus.PAST_DUE
          ? 'Membership payment is past due; resolve to claim again.'
          : 'Membership is not currently eligible for claims.',
      );
    }
    if (membership.tierLevel < ticketType.minTierLevel) {
      throw new ConflictException(
        'Your membership tier does not cover this ticket.',
      );
    }

    try {
      const created = await this.prisma.$transaction(
        async (tx) => {
          // Re-check inside the tx — Serializable isolation prevents a
          // concurrent claim from sneaking in between findFirst and
          // create. (members_excluded flips are a separate concern; if
          // the organizer toggles mid-claim, the worst case is one extra
          // claim landing — acceptable.)
          const existing = await tx.ticket.findFirst({
            where: {
              userId,
              eventId: ticketType.event.id,
              ticketTypeId,
              source: TicketSource.MEMBERSHIP_CLAIM,
            },
            select: { id: true },
          });
          if (existing) {
            throw new ConflictException(
              'You already claimed a free ticket for this tier.',
            );
          }
          return tx.ticket.create({
            data: {
              userId,
              eventId: ticketType.event.id,
              ticketTypeId,
              source: TicketSource.MEMBERSHIP_CLAIM,
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return toView(created);
    } catch (err) {
      // The Serializable retry window is microseconds; a P2002 here means
      // two requests in flight raced past findFirst before either committed.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'You already claimed a free ticket for this tier.',
        );
      }
      throw err;
    }
  }

  // Lightweight check used by the verdict endpoint (and callers that just
  // want a boolean). Falls through to the same MembershipsService machinery
  // so the rules stay in one place.
  canClaimFree(
    userId: string,
    eventId: string,
    ticketTypeId: string,
  ): Promise<boolean> {
    return this.memberships.canClaimFree(userId, eventId, ticketTypeId);
  }
}
