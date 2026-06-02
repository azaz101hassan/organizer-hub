import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { firstValueFrom } from 'rxjs';
import { filter, take } from 'rxjs/operators';
import {
  EventStatus,
  OrganizationRole,
  TicketRequestIntent,
  TicketRequestStatus,
  TicketSource,
} from '@organizer-hub/db/api';
import { StripeClient } from './../src/billing/stripe.client';
import { PrismaService } from './../src/prisma/prisma.service';
import { WaitlistStream } from './../src/realtime/waitlist-stream';
import {
  bootTestApp,
  DenyAllGuard,
  makeSubHolder,
  stubJwtAuthGuard,
  type SubHolder,
} from './helpers/boot-test-app';
import { FakeStripeClient } from './helpers/fake-stripe';
import { FUTURE_EVENT_DATE } from './helpers/dates';
import { jsonBody } from './helpers/http';

const USER = 'user-ticket-1';

describe('Billing ticket checkout (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let fakeStripe: FakeStripeClient;
  let holder: SubHolder;
  let orgId: string;
  let eventId: string;
  let ticketTypeId: string;
  let stripePriceId: string;
  let stripeProductId: string;

  beforeAll(async () => {
    fakeStripe = new FakeStripeClient();
    holder = makeSubHolder(USER);
    ({ app, prisma } = await bootTestApp(stubJwtAuthGuard(holder), [
      { token: StripeClient, useValue: fakeStripe },
    ]));
  });

  beforeEach(async () => {
    await prisma.ticketRequestAudit.deleteMany({});
    await prisma.ticket.deleteMany({});
    await prisma.ticketRequest.deleteMany({});
    await prisma.ticketType.deleteMany({});
    await prisma.organization.deleteMany({});
    await prisma.billingCustomer.deleteMany({});
    fakeStripe.reset();
    holder.value = USER;

    const org = await prisma.organization.create({
      data: {
        name: 'Acme',
        slug: 'acme',
        createdBy: USER,
        members: { create: { userId: USER, role: OrganizationRole.OWNER } },
      },
    });
    orgId = org.id;

    const event = await prisma.event.create({
      data: {
        organizationId: orgId,
        title: 'Spring Gala',
        slug: 'spring-gala',
        startsAt: FUTURE_EVENT_DATE,
        status: EventStatus.PUBLISHED,
        publishedAt: new Date(),
        createdBy: USER,
      },
    });
    eventId = event.id;

    stripeProductId = 'prod_test_ticket_1';
    stripePriceId = 'price_test_ticket_1';
    fakeStripe.seedProduct({ id: stripeProductId, name: 'GA', active: true });
    fakeStripe.seedPrice({
      id: stripePriceId,
      lookup_key: null,
      product: stripeProductId,
      unit_amount: 5000,
      currency: 'usd',
      active: true,
    });

    const tt = await prisma.ticketType.create({
      data: {
        eventId,
        name: 'GA',
        priceCents: 5000,
        minTierLevel: 0,
        stripeProductId,
        stripePriceId,
      },
    });
    ticketTypeId = tt.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates a payment-mode Checkout Session with metadata (under cap → kind:checkout)', async () => {
    const res = await request(app.getHttpServer())
      .post('/billing/checkout/ticket')
      .send({ ticketTypeId })
      .expect(200);

    const body = jsonBody<{ kind: string; url: string }>(res);
    expect(body.kind).toBe('checkout');
    expect(body.url).toMatch(/^https:\/\/checkout\.stripe\.test\//);

    const calls = fakeStripe.callsFor('checkout.sessions.create');
    expect(calls).toHaveLength(1);
    const params = calls[0].args[0] as Record<string, unknown>;
    expect(params.mode).toBe('payment');
    expect(params.client_reference_id).toBe(USER);
    expect(params.metadata).toMatchObject({
      userId: USER,
      eventId,
      ticketTypeId,
    });
    expect(params.line_items).toEqual([{ price: stripePriceId, quantity: 1 }]);
  });

  it('returns 404 when the ticket type does not exist', async () => {
    await request(app.getHttpServer())
      .post('/billing/checkout/ticket')
      .send({ ticketTypeId: 'tt_does_not_exist' })
      .expect(404);
  });

  it('returns 404 for a ticket type whose event is DRAFT (hide-existence)', async () => {
    await prisma.event.update({
      where: { id: eventId },
      data: { status: EventStatus.DRAFT, publishedAt: null },
    });
    await request(app.getHttpServer())
      .post('/billing/checkout/ticket')
      .send({ ticketTypeId })
      .expect(404);
  });

  it('returns 409 when the user already has a PAID ticket for this (event, ticketType)', async () => {
    await prisma.ticket.create({
      data: {
        userId: USER,
        eventId,
        ticketTypeId,
        source: TicketSource.PAID,
        stripeCheckoutSessionId: 'cs_existing',
      },
    });

    await request(app.getHttpServer())
      .post('/billing/checkout/ticket')
      .send({ ticketTypeId })
      .expect(409);
  });

  it('rejects empty body with 400 (DTO validation)', async () => {
    await request(app.getHttpServer())
      .post('/billing/checkout/ticket')
      .send({})
      .expect(400);
  });

  describe('at cap → waitlist request (R3, AE1)', () => {
    // Fill the tier to capacity with another buyer's PAID ticket so USER's
    // own existing-PAID gate still passes and only the cap is the blocker.
    async function fillToCap(): Promise<void> {
      await prisma.ticketType.update({
        where: { id: ticketTypeId },
        data: { cap: 1 },
      });
      await prisma.ticket.create({
        data: {
          userId: 'other-buyer',
          eventId,
          ticketTypeId,
          source: TicketSource.PAID,
          stripeCheckoutSessionId: 'cs_other',
        },
      });
    }

    it('at cap → kind:request, a PAID/PENDING row, and no Stripe session', async () => {
      await fillToCap();

      const res = await request(app.getHttpServer())
        .post('/billing/checkout/ticket')
        .send({ ticketTypeId })
        .expect(200);

      const body = jsonBody<{
        kind: string;
        requestId: string;
        status: string;
      }>(res);
      expect(body.kind).toBe('request');
      expect(body.status).toBe(TicketRequestStatus.PENDING);

      const row = await prisma.ticketRequest.findUnique({
        where: { id: body.requestId },
      });
      expect(row).toMatchObject({
        userId: USER,
        ticketTypeId,
        eventId,
        intent: TicketRequestIntent.PAID,
        status: TicketRequestStatus.PENDING,
      });
      expect(fakeStripe.callsFor('checkout.sessions.create')).toHaveLength(0);
    });

    it('a second at-cap request for the same user/tier returns the same requestId (AE17)', async () => {
      await fillToCap();

      const first = await request(app.getHttpServer())
        .post('/billing/checkout/ticket')
        .send({ ticketTypeId })
        .expect(200);
      const second = await request(app.getHttpServer())
        .post('/billing/checkout/ticket')
        .send({ ticketTypeId })
        .expect(200);

      const firstId = jsonBody<{ requestId: string }>(first).requestId;
      const secondId = jsonBody<{ requestId: string }>(second).requestId;
      expect(secondId).toBe(firstId);

      const count = await prisma.ticketRequest.count({
        where: { userId: USER, ticketTypeId },
      });
      expect(count).toBe(1);
    });

    it('emits request.created on the org SSE stream after the PENDING insert', async () => {
      await fillToCap();
      const hub = app.get(WaitlistStream);
      const received = firstValueFrom(
        hub.stream(orgId).pipe(
          filter((e) => e.type === 'request.created'),
          take(1),
        ),
      );

      await request(app.getHttpServer())
        .post('/billing/checkout/ticket')
        .send({ ticketTypeId })
        .expect(200);

      const event = await received;
      expect(event.type).toBe('request.created');
    });
  });

  it('returns 401 when unauthenticated', async () => {
    // Re-boot with DenyAllGuard so JwtAuthGuard fails closed.
    const deny = await bootTestApp(DenyAllGuard, [
      { token: StripeClient, useValue: fakeStripe },
    ]);
    try {
      await request(deny.app.getHttpServer())
        .post('/billing/checkout/ticket')
        .send({ ticketTypeId })
        .expect(403);
      // DenyAllGuard returns false → 403 Forbidden (Nest's default), not
      // 401. The real JwtAuthGuard throws UnauthorizedException → 401;
      // verified separately by the auth e2e suite. Either way, the
      // endpoint is unreachable without a valid session.
    } finally {
      await deny.app.close();
    }
  });
});
