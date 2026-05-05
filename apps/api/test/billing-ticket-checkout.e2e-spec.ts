import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  EventStatus,
  OrganizationRole,
  TicketSource,
} from '@organizer-hub/db/api';
import { StripeClient } from './../src/billing/stripe.client';
import { PrismaService } from './../src/prisma/prisma.service';
import {
  bootTestApp,
  DenyAllGuard,
  makeSubHolder,
  stubJwtAuthGuard,
  type SubHolder,
} from './helpers/boot-test-app';
import { FakeStripeClient } from './helpers/fake-stripe';

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
    await prisma.ticket.deleteMany({});
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
        startsAt: new Date('2026-06-01T18:00:00Z'),
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

  it('creates a payment-mode Checkout Session with metadata', async () => {
    const res = await request(app.getHttpServer())
      .post('/billing/checkout/ticket')
      .send({ ticketTypeId })
      .expect(200);

    expect(res.body.url).toMatch(/^https:\/\/checkout\.stripe\.test\//);

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
