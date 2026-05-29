import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { firstValueFrom } from 'rxjs';
import { filter, take } from 'rxjs/operators';
import {
  OrganizationRole,
  TicketRequestIntent,
  TicketRequestStatus,
} from '@organizer-hub/db/api';
import { StripeClient } from './../src/billing/stripe.client';
import { Mailer } from './../src/mail/mailer';
import { PrismaService } from './../src/prisma/prisma.service';
import { WaitlistStream } from './../src/realtime/waitlist-stream';
import {
  bootTestApp,
  makeSubHolder,
  stubJwtAuthGuard,
} from './helpers/boot-test-app';
import { FakeMailer } from './helpers/fake-mailer';
import { FakeStripeClient } from './helpers/fake-stripe';
import { jsonBody } from './helpers/http';

const ME = 'buyer-1';
const OTHER = 'buyer-2';

describe('Requester ticket requests (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let fakeMailer: FakeMailer;
  let fakeStripe: FakeStripeClient;
  const currentSub = makeSubHolder(ME);

  let orgId: string;
  let eventId: string;
  let ticketTypeId: string;

  beforeAll(async () => {
    fakeMailer = new FakeMailer();
    fakeStripe = new FakeStripeClient();
    ({ app, prisma } = await bootTestApp(stubJwtAuthGuard(currentSub), [
      { token: StripeClient, useValue: fakeStripe },
      { token: Mailer, useValue: fakeMailer },
    ]));
  });

  beforeEach(async () => {
    await prisma.ticketRequestAudit.deleteMany({});
    await prisma.ticket.deleteMany({});
    await prisma.ticketRequest.deleteMany({});
    await prisma.ticketType.deleteMany({});
    await prisma.organization.deleteMany({});
    fakeMailer.reset();
    fakeStripe.reset();
    currentSub.value = ME;

    const org = await prisma.organization.create({
      data: {
        name: 'Acme',
        slug: 'acme',
        createdBy: 'owner-sub',
        members: {
          create: { userId: 'owner-sub', role: OrganizationRole.OWNER },
        },
      },
    });
    orgId = org.id;
    const event = await prisma.event.create({
      data: {
        organizationId: orgId,
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

  function createRequest(opts?: {
    userId?: string;
    status?: TicketRequestStatus;
    intent?: TicketRequestIntent;
  }) {
    return prisma.ticketRequest.create({
      data: {
        userId: opts?.userId ?? ME,
        userEmail: `${opts?.userId ?? ME}@example.com`,
        ticketTypeId,
        eventId,
        intent: opts?.intent ?? TicketRequestIntent.PAID,
        status: opts?.status ?? TicketRequestStatus.PENDING,
      },
    });
  }

  it('lists only the caller’s own requests', async () => {
    await createRequest({ userId: ME });
    await createRequest({ userId: OTHER });

    const res = await request(app.getHttpServer()).get('/requests').expect(200);
    const body = jsonBody<Array<{ userId: string }>>(res);
    expect(body).toHaveLength(1);
    expect(body[0].userId).toBe(ME);
  });

  it('gets an own request with display fields and hasTicket', async () => {
    const req = await createRequest({ userId: ME });
    const res = await request(app.getHttpServer())
      .get(`/requests/${req.id}`)
      .expect(200);
    const body = jsonBody<{
      id: string;
      status: string;
      hasTicket: boolean;
      event: { title: string };
      ticketTypeName: string;
    }>(res);
    expect(body.id).toBe(req.id);
    expect(body.status).toBe(TicketRequestStatus.PENDING);
    expect(body.hasTicket).toBe(false);
    expect(body.event.title).toBe('Spring Gala');
    expect(body.ticketTypeName).toBe('GA');
  });

  it('self-cancels a PENDING request, emits removal, writes no email or audit (AE8)', async () => {
    const req = await createRequest({ userId: ME });
    const hub = app.get(WaitlistStream);
    const received = firstValueFrom(
      hub.stream(orgId).pipe(
        filter((e) => e.type === 'request.removed'),
        take(1),
      ),
    );

    const res = await request(app.getHttpServer())
      .post(`/requests/${req.id}/cancel`)
      .expect(200);
    expect(jsonBody<{ status: string }>(res).status).toBe(
      TicketRequestStatus.CANCELLED_BY_USER,
    );

    const row = await prisma.ticketRequest.findUnique({
      where: { id: req.id },
    });
    expect(row?.status).toBe(TicketRequestStatus.CANCELLED_BY_USER);
    expect(fakeMailer.sent).toHaveLength(0);
    expect(
      await prisma.ticketRequestAudit.count({
        where: { ticketRequestId: req.id },
      }),
    ).toBe(0);
    expect((await received).type).toBe('request.removed');
  });

  it('is idempotent — a second cancel returns 200 (AE8)', async () => {
    const req = await createRequest({ userId: ME });
    await request(app.getHttpServer())
      .post(`/requests/${req.id}/cancel`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/requests/${req.id}/cancel`)
      .expect(200);
  });

  it('409s when cancelling an already-decided (APPROVED) request', async () => {
    const req = await createRequest({
      userId: ME,
      status: TicketRequestStatus.APPROVED,
    });
    await request(app.getHttpServer())
      .post(`/requests/${req.id}/cancel`)
      .expect(409);
  });

  describe('GET /requests/:id/payment-link', () => {
    it('returns the live Checkout url + expiry for an approved-awaiting-payment PAID request', async () => {
      const expiresAt = Math.floor(
        new Date('2026-05-31T00:00:00Z').getTime() / 1000,
      );
      fakeStripe.seedCheckoutSession({
        id: 'cs_pay_1',
        url: 'https://checkout.stripe.test/cs_pay_1',
        expires_at: expiresAt,
      });
      const req = await prisma.ticketRequest.create({
        data: {
          userId: ME,
          userEmail: `${ME}@example.com`,
          ticketTypeId,
          eventId,
          intent: TicketRequestIntent.PAID,
          status: TicketRequestStatus.APPROVED,
          stripeCheckoutSessionId: 'cs_pay_1',
        },
      });

      const res = await request(app.getHttpServer())
        .get(`/requests/${req.id}/payment-link`)
        .expect(200);
      const body = jsonBody<{ url: string | null; expiresAt: string | null }>(
        res,
      );
      expect(body.url).toBe('https://checkout.stripe.test/cs_pay_1');
      expect(body.expiresAt).toBe(new Date(expiresAt * 1000).toISOString());
    });

    it('409s for a PENDING request (not awaiting payment)', async () => {
      const req = await createRequest({ status: TicketRequestStatus.PENDING });
      await request(app.getHttpServer())
        .get(`/requests/${req.id}/payment-link`)
        .expect(409);
    });

    it('409s for an approved PAID request that already has a ticket', async () => {
      fakeStripe.seedCheckoutSession({ id: 'cs_pay_2' });
      const req = await prisma.ticketRequest.create({
        data: {
          userId: ME,
          ticketTypeId,
          eventId,
          intent: TicketRequestIntent.PAID,
          status: TicketRequestStatus.APPROVED,
          stripeCheckoutSessionId: 'cs_pay_2',
        },
      });
      await prisma.ticket.create({
        data: {
          userId: ME,
          eventId,
          ticketTypeId,
          source: 'PAID',
          ticketRequestId: req.id,
          stripeCheckoutSessionId: 'cs_pay_2',
        },
      });

      await request(app.getHttpServer())
        .get(`/requests/${req.id}/payment-link`)
        .expect(409);
    });

    it('hides another user’s request behind 404 on payment-link (R27)', async () => {
      const otherReq = await createRequest({
        userId: OTHER,
        status: TicketRequestStatus.APPROVED,
      });
      await request(app.getHttpServer())
        .get(`/requests/${otherReq.id}/payment-link`)
        .expect(404);
    });
  });

  it('hides another user’s request behind 404 on get and cancel (AE12, R27)', async () => {
    const otherReq = await createRequest({ userId: OTHER });

    await request(app.getHttpServer())
      .get(`/requests/${otherReq.id}`)
      .expect(404);
    await request(app.getHttpServer())
      .post(`/requests/${otherReq.id}/cancel`)
      .expect(404);

    const row = await prisma.ticketRequest.findUnique({
      where: { id: otherReq.id },
    });
    expect(row?.status).toBe(TicketRequestStatus.PENDING);
  });
});
