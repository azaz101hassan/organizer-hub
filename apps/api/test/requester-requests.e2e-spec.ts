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
  const currentSub = makeSubHolder(ME);

  let orgId: string;
  let eventId: string;
  let ticketTypeId: string;

  beforeAll(async () => {
    fakeMailer = new FakeMailer();
    ({ app, prisma } = await bootTestApp(stubJwtAuthGuard(currentSub), [
      { token: StripeClient, useValue: new FakeStripeClient() },
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
