import { ConflictException, INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import {
  TicketRequestIntent,
  TicketRequestStatus,
  TicketSource,
} from '@organizer-hub/db/api';
import { StripeClient } from './../src/billing/stripe.client';
import { PrismaService } from './../src/prisma/prisma.service';
import { ONE_OPEN_REQUEST_INDEX } from './../src/ticket-requests/open-request-index';
import { TicketRequestTransitions } from './../src/ticket-requests/ticket-request-transitions';
import {
  bootTestApp,
  makeSubHolder,
  stubJwtAuthGuard,
} from './helpers/boot-test-app';
import { FakeStripeClient } from './helpers/fake-stripe';

const currentSub = makeSubHolder('owner-sub');

describe('TicketRequest core (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let transitions: TicketRequestTransitions;
  let eventId: string;
  let ticketTypeId: string;

  beforeAll(async () => {
    ({ app, prisma } = await bootTestApp(stubJwtAuthGuard(currentSub), [
      { token: StripeClient, useValue: new FakeStripeClient() },
    ]));
    transitions = app.get(TicketRequestTransitions);
  });

  beforeEach(async () => {
    await prisma.ticketRequestAudit.deleteMany({});
    await prisma.ticket.deleteMany({});
    await prisma.ticketRequest.deleteMany({});
    await prisma.ticketType.deleteMany({});
    await prisma.organization.deleteMany({});

    const org = await prisma.organization.create({
      data: { name: 'Acme', slug: 'acme', createdBy: 'owner-sub' },
    });
    const event = await prisma.event.create({
      data: {
        organizationId: org.id,
        title: 'Spring Gala',
        slug: 'spring-gala',
        startsAt: new Date('2026-06-01T18:00:00Z'),
        createdBy: 'owner-sub',
      },
    });
    eventId = event.id;
    const tt = await prisma.ticketType.create({
      data: {
        eventId,
        name: 'GA',
        priceCents: 5000,
        cap: 1,
        stripeProductId: `prod_${event.id}`,
        stripePriceId: `price_${event.id}`,
      },
    });
    ticketTypeId = tt.id;
  });

  afterAll(async () => {
    await app.close();
  });

  function createRequest(
    overrides: {
      userId?: string;
      status?: TicketRequestStatus;
      intent?: TicketRequestIntent;
    } = {},
  ) {
    return prisma.ticketRequest.create({
      data: {
        userId: overrides.userId ?? 'buyer-1',
        ticketTypeId,
        eventId,
        intent: overrides.intent ?? TicketRequestIntent.PAID,
        status: overrides.status ?? TicketRequestStatus.PENDING,
      },
    });
  }

  function createTicket(ticketRequestId: string) {
    return prisma.ticket.create({
      data: {
        userId: 'buyer-1',
        eventId,
        ticketTypeId,
        source: TicketSource.MEMBERSHIP_CLAIM,
        ticketRequestId,
      },
    });
  }

  describe('CAS transition', () => {
    it('flips PENDING -> APPROVED and returns the updated row', async () => {
      const req = await createRequest();
      const updated = await transitions.transition(
        req.id,
        TicketRequestStatus.PENDING,
        TicketRequestStatus.APPROVED,
      );
      expect(updated.status).toBe(TicketRequestStatus.APPROVED);
    });

    it('throws ConflictException (409) when the row is no longer in `from`', async () => {
      const req = await createRequest({ status: TicketRequestStatus.APPROVED });
      await expect(
        transitions.transition(
          req.id,
          TicketRequestStatus.PENDING,
          TicketRequestStatus.REJECTED,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('only one of two concurrent CAS flips wins; the loser gets 409 (R25)', async () => {
      const req = await createRequest();
      const results = await Promise.allSettled([
        transitions.transition(
          req.id,
          TicketRequestStatus.PENDING,
          TicketRequestStatus.APPROVED,
        ),
        transitions.transition(
          req.id,
          TicketRequestStatus.PENDING,
          TicketRequestStatus.REJECTED,
        ),
      ]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
    });
  });

  describe('partial unique index (one open request per user/tier, AE17)', () => {
    it('blocks a second open request while one is PENDING', async () => {
      await createRequest({ userId: 'buyer-1' });
      await expect(createRequest({ userId: 'buyer-1' })).rejects.toMatchObject({
        code: 'P2002',
      });
    });

    it('blocks a new PENDING when an APPROVED one exists (approved side)', async () => {
      await createRequest({
        userId: 'buyer-1',
        status: TicketRequestStatus.APPROVED,
      });
      await expect(
        createRequest({
          userId: 'buyer-1',
          status: TicketRequestStatus.PENDING,
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });

    it.each([
      TicketRequestStatus.REJECTED,
      TicketRequestStatus.CANCELLED_BY_USER,
      TicketRequestStatus.EXPIRED,
    ])(
      'permits a new PENDING when the prior request is %s',
      async (terminal) => {
        await createRequest({ userId: 'buyer-1', status: terminal });
        const fresh = await createRequest({
          userId: 'buyer-1',
          status: TicketRequestStatus.PENDING,
        });
        expect(fresh.status).toBe(TicketRequestStatus.PENDING);
      },
    );

    it('does not lock a different user out of the same tier', async () => {
      await createRequest({ userId: 'buyer-1' });
      const other = await createRequest({ userId: 'buyer-2' });
      expect(other.userId).toBe('buyer-2');
    });
  });

  describe('Ticket <-> request link (R25 + ON DELETE SET NULL)', () => {
    it('blocks a second Ticket linked to the same request (ticketRequestId @unique)', async () => {
      const req = await createRequest();
      await createTicket(req.id);
      await expect(createTicket(req.id)).rejects.toMatchObject({
        code: 'P2002',
      });
    });

    it('nulls ticketRequestId on the Ticket when its request is deleted (provenance, not cascade)', async () => {
      const req = await createRequest();
      const ticket = await createTicket(req.id);
      await prisma.ticketRequest.delete({ where: { id: req.id } });
      const after = await prisma.ticket.findUnique({
        where: { id: ticket.id },
      });
      expect(after).not.toBeNull();
      expect(after?.ticketRequestId).toBeNull();
    });
  });

  describe('audit + lookup helpers', () => {
    it('writeAudit appends one decision row inside the caller transaction (R14)', async () => {
      const req = await createRequest();
      await prisma.$transaction(async (tx) => {
        await transitions.writeAudit(tx, {
          ticketRequestId: req.id,
          adminUserId: 'admin-1',
          decision: 'APPROVE',
          capAtDecision: 1,
          issuedCountBefore: 1,
          issuedCountAfter: 1,
        });
      });
      const audits = await prisma.ticketRequestAudit.findMany({
        where: { ticketRequestId: req.id },
      });
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        adminUserId: 'admin-1',
        decision: 'APPROVE',
        issuedCountBefore: 1,
        issuedCountAfter: 1,
      });
    });

    it('findOpenForUser returns PENDING/APPROVED and ignores terminal states', async () => {
      await createRequest({
        userId: 'u-term',
        status: TicketRequestStatus.EXPIRED,
      });
      expect(
        await transitions.findOpenForUser('u-term', ticketTypeId),
      ).toBeNull();

      const open = await createRequest({ userId: 'u-open' });
      const found = await transitions.findOpenForUser('u-open', ticketTypeId);
      expect(found?.id).toBe(open.id);
    });
  });

  describe('schema drift guard', () => {
    it('the partial unique index exists (boot guard would have failed otherwise)', async () => {
      const rows = await prisma.$queryRaw<{ indexname: string }[]>`
        SELECT indexname FROM pg_indexes WHERE tablename = 'ticket_requests'
      `;
      expect(rows.map((r) => r.indexname)).toContain(ONE_OPEN_REQUEST_INDEX);
    });
  });
});
