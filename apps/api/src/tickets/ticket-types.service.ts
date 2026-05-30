import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@organizer-hub/db/api';
import { PrismaService } from '../prisma/prisma.service';
import { StripeClient } from '../billing/stripe.client';

export interface TicketTypeView {
  id: string;
  eventId: string;
  name: string;
  priceCents: number;
  minTierLevel: number;
  cap: number | null;
  // Derived count of issued Tickets for this tier. Surfaced so the editor can
  // warn when a newly-set cap is below the count already issued (R17). Always
  // count(Ticket) — never a denormalized column — to stay honest under the
  // webhook issuance path.
  issuedCount: number;
  stripeProductId: string;
  stripePriceId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface TicketTypePublicView {
  id: string;
  name: string;
  priceCents: number;
  minTierLevel: number;
}

interface DbTicketType {
  id: string;
  eventId: string;
  name: string;
  priceCents: number;
  minTierLevel: number;
  cap: number | null;
  stripeProductId: string;
  stripePriceId: string;
  createdAt: Date;
  updatedAt: Date;
}

function toView(t: DbTicketType, issuedCount: number): TicketTypeView {
  return {
    id: t.id,
    eventId: t.eventId,
    name: t.name,
    priceCents: t.priceCents,
    minTierLevel: t.minTierLevel,
    cap: t.cap,
    issuedCount,
    stripeProductId: t.stripeProductId,
    stripePriceId: t.stripePriceId,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

function toPublicView(t: DbTicketType): TicketTypePublicView {
  return {
    id: t.id,
    name: t.name,
    priceCents: t.priceCents,
    minTierLevel: t.minTierLevel,
  };
}

@Injectable()
export class TicketTypesService {
  private readonly logger = new Logger(TicketTypesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeClient: StripeClient,
  ) {}

  // Cross-org guard: RolesGuard only proves the caller has OWNER/ADMIN on
  // :orgId, not that :eventId actually belongs to :orgId. Without this
  // assertion, an OWNER of Org A could pass their orgId + an Org-B eventId
  // and mutate Org B's ticket types. We throw NotFoundException on mismatch
  // (hide-existence pattern — same response as a truly-missing event).
  private async assertEventInOrg(
    orgId: string,
    eventId: string,
  ): Promise<{ id: string; title: string }> {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, organizationId: orgId },
      select: { id: true, title: true },
    });
    if (!event) throw new NotFoundException();
    return event;
  }

  async listForEvent(
    orgId: string,
    eventId: string,
  ): Promise<TicketTypeView[]> {
    await this.assertEventInOrg(orgId, eventId);
    const rows = await this.prisma.ticketType.findMany({
      where: { eventId },
      orderBy: { createdAt: 'asc' },
    });
    const counts = await this.issuedCountsFor(rows.map((r) => r.id));
    return rows.map((r) => toView(r, counts.get(r.id) ?? 0));
  }

  // Count of issued Tickets for one tier. The shared input to the atCap()
  // predicate (capacity.ts) on the paid / claim / public-affordance paths.
  async computeIssuedCount(ticketTypeId: string): Promise<number> {
    return this.prisma.ticket.count({ where: { ticketTypeId } });
  }

  // Batched issued counts for a list render, so listForEvent stays one extra
  // query rather than N. Tiers with zero issued tickets are simply absent from
  // the result and default to 0 at the call site.
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

  async listPublic(eventId: string): Promise<TicketTypePublicView[]> {
    // Public reads don't need an org check — visibility is determined by
    // the event being PUBLISHED, which the caller hits via the public
    // events controller before landing here.
    const rows = await this.prisma.ticketType.findMany({
      where: { eventId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toPublicView);
  }

  async create(
    orgId: string,
    eventId: string,
    input: {
      name: string;
      priceCents: number;
      minTierLevel?: number;
      cap?: number | null;
    },
  ): Promise<TicketTypeView> {
    const event = await this.assertEventInOrg(orgId, eventId);

    // Stripe writes happen OUTSIDE the prisma transaction. If Stripe
    // succeeds and prisma.create then fails, we leak one Stripe Product +
    // Price — acceptable in Phase 3 (logged below). Reversing the leak
    // would require either a 2-phase commit (overkill) or a periodic
    // janitor that reconciles by metadata.eventId — out of scope.
    const product = await this.stripeClient.stripe.products.create(
      {
        name: `${event.title} — ${input.name}`,
        metadata: { eventId, kind: 'ticket_type' },
      },
      { idempotencyKey: `ticket-type-product-${eventId}-${input.name}` },
    );

    const price = await this.stripeClient.stripe.prices.create({
      product: product.id,
      unit_amount: input.priceCents,
      currency: 'usd',
    });

    try {
      const row = await this.prisma.ticketType.create({
        data: {
          eventId,
          name: input.name,
          priceCents: input.priceCents,
          minTierLevel: input.minTierLevel ?? 0,
          cap: input.cap ?? null,
          stripeProductId: product.id,
          stripePriceId: price.id,
        },
      });
      // A freshly created tier has no issued tickets yet.
      return toView(row, 0);
    } catch (err) {
      this.logger.warn(
        `Stripe Product ${product.id} + Price ${price.id} were created but the local TicketType insert failed; manual cleanup may be needed`,
      );
      throw err;
    }
  }

  async update(
    orgId: string,
    eventId: string,
    ticketTypeId: string,
    patch: {
      name?: string;
      priceCents?: number;
      minTierLevel?: number;
      cap?: number | null;
    },
  ): Promise<TicketTypeView> {
    await this.assertEventInOrg(orgId, eventId);
    const current = await this.prisma.ticketType.findFirst({
      where: { id: ticketTypeId, eventId },
    });
    if (!current) throw new NotFoundException();

    // Patch the Stripe Product when the display name changes.
    if (patch.name !== undefined && patch.name !== current.name) {
      const event = await this.prisma.event.findUnique({
        where: { id: eventId },
        select: { title: true },
      });
      if (event) {
        await this.stripeClient.stripe.products.update(
          current.stripeProductId,
          { name: `${event.title} — ${patch.name}` },
        );
      }
    }

    // Stripe Prices are immutable. A priceCents change archives the old
    // Price and creates a new one. We carry the new Price ID through to
    // the local row.
    let nextStripePriceId = current.stripePriceId;
    if (
      patch.priceCents !== undefined &&
      patch.priceCents !== current.priceCents
    ) {
      await this.stripeClient.stripe.prices.update(current.stripePriceId, {
        active: false,
      });
      const newPrice = await this.stripeClient.stripe.prices.create({
        product: current.stripeProductId,
        unit_amount: patch.priceCents,
        currency: 'usd',
      });
      nextStripePriceId = newPrice.id;
    }

    const updated = await this.prisma.ticketType.update({
      where: { id: ticketTypeId },
      data: {
        name: patch.name,
        priceCents: patch.priceCents,
        minTierLevel: patch.minTierLevel,
        // undefined leaves the cap unchanged; null clears it; a number sets it.
        // Setting cap below issuedCount is permitted (R17) — the view exposes
        // issuedCount so the editor can warn; tickets are never revoked.
        cap: patch.cap,
        stripePriceId: nextStripePriceId,
      },
    });
    const issuedCount = await this.computeIssuedCount(ticketTypeId);
    return toView(updated, issuedCount);
  }

  async delete(
    orgId: string,
    eventId: string,
    ticketTypeId: string,
  ): Promise<void> {
    await this.assertEventInOrg(orgId, eventId);
    const current = await this.prisma.ticketType.findFirst({
      where: { id: ticketTypeId, eventId },
    });
    if (!current) throw new NotFoundException();

    try {
      // Stripe-side: archive both the active Price and the Product so the
      // Dashboard reflects the deletion. We don't `prices.delete` because
      // Stripe forbids deleting Prices with usage history — and we don't
      // know whether issued Tickets exist (the Ticket model lands in U7).
      await this.stripeClient.stripe.products.update(current.stripeProductId, {
        active: false,
      });
    } catch (err) {
      this.logger.warn(
        `Failed to archive Stripe Product ${current.stripeProductId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      // Don't block local deletion on a Stripe write failure — the local
      // row going away is the source of truth for listing in the UI.
    }

    try {
      await this.prisma.ticketType.delete({ where: { id: ticketTypeId } });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2003'
      ) {
        // FK violation — a Ticket row references this TicketType. Issued
        // tickets must remain valid; we don't let the organizer delete the
        // type out from under them. UI should hide the delete button when
        // any Ticket exists, but the api enforces the rule.
        throw new ConflictException(
          'Ticket type has issued tickets; cannot delete.',
        );
      }
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2025'
      ) {
        throw new NotFoundException();
      }
      throw err;
    }
  }

  // Defensive: a 0 or negative priceCents combined with a free-claim path
  // would be a weird shape. We allow 0 (free for everyone — useful for
  // public events) but log when both 0 and minTierLevel > 0 are combined.
  validateInvariant(priceCents: number, minTierLevel: number): void {
    if (priceCents === 0 && minTierLevel > 0) {
      // A free ticket with a tier gate is technically allowed but is
      // probably a misconfiguration — the gate has no purchase to gate
      // against. Surface it as a 400.
      throw new BadRequestException(
        'A free ticket type cannot also have minTierLevel > 0',
      );
    }
  }
}
