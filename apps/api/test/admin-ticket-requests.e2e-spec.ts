import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { firstValueFrom } from 'rxjs';
import { filter, take } from 'rxjs/operators';
import {
  OrganizationRole,
  TicketRequestDecision,
  TicketRequestIntent,
  TicketRequestStatus,
  TicketSource,
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

const REQUESTER = 'buyer-1';
const REQUESTER_EMAIL = 'buyer@example.com';

describe('Admin ticket requests (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let fakeStripe: FakeStripeClient;
  let fakeMailer: FakeMailer;
  const currentSub = makeSubHolder('owner-sub');

  let orgId: string;
  let otherOrgId: string;
  let eventId: string;
  let ticketTypeId: string;

  beforeAll(async () => {
    fakeStripe = new FakeStripeClient();
    fakeMailer = new FakeMailer();
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
    fakeStripe.reset();
    fakeMailer.reset();
    currentSub.value = 'owner-sub';

    const org = await prisma.organization.create({
      data: {
        name: 'Acme',
        slug: 'acme',
        createdBy: 'owner-sub',
        members: {
          create: [
            { userId: 'owner-sub', role: OrganizationRole.OWNER },
            { userId: 'admin-sub', role: OrganizationRole.ADMIN },
            { userId: 'member-sub', role: OrganizationRole.MEMBER },
          ],
        },
      },
    });
    orgId = org.id;

    // owner-sub also owns a second org, so the cross-org test exercises
    // assertRequestInOrg (not just RolesGuard membership).
    const other = await prisma.organization.create({
      data: {
        name: 'Other',
        slug: 'other',
        createdBy: 'owner-sub',
        members: {
          create: { userId: 'owner-sub', role: OrganizationRole.OWNER },
        },
      },
    });
    otherOrgId = other.id;

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

  function createRequest(overrides?: {
    intent?: TicketRequestIntent;
    status?: TicketRequestStatus;
  }) {
    return prisma.ticketRequest.create({
      data: {
        userId: REQUESTER,
        userEmail: REQUESTER_EMAIL,
        userName: 'Ada',
        ticketTypeId,
        eventId,
        intent: overrides?.intent ?? TicketRequestIntent.MEMBERSHIP_CLAIM,
        status: overrides?.status ?? TicketRequestStatus.PENDING,
      },
    });
  }

  function seedIssuedTickets(n: number) {
    return prisma.ticket.createMany({
      data: Array.from({ length: n }, (_, i) => ({
        userId: `holder-${i}`,
        eventId,
        ticketTypeId,
        source: TicketSource.MEMBERSHIP_CLAIM,
      })),
    });
  }

  describe('approve MEMBERSHIP_CLAIM', () => {
    it('issues a linked Ticket, flips APPROVED, audits, and emails (AE3)', async () => {
      const req = await createRequest();

      const res = await request(app.getHttpServer())
        .post(`/orgs/${orgId}/requests/${req.id}/approve`)
        .expect(200);
      expect(jsonBody<{ status: string }>(res).status).toBe(
        TicketRequestStatus.APPROVED,
      );

      const ticket = await prisma.ticket.findUnique({
        where: { ticketRequestId: req.id },
      });
      expect(ticket).toMatchObject({
        userId: REQUESTER,
        source: TicketSource.MEMBERSHIP_CLAIM,
      });
      const audits = await prisma.ticketRequestAudit.findMany({
        where: { ticketRequestId: req.id },
      });
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        adminUserId: 'owner-sub',
        decision: TicketRequestDecision.APPROVE,
      });
      const mail = fakeMailer.lastOf('claim-approved');
      expect(mail?.to).toBe(REQUESTER_EMAIL);
    });

    it('over-cap approve succeeds and records the cap state (AE5, R12, R14)', async () => {
      await seedIssuedTickets(1); // issuedCount = 1 == cap
      const req = await createRequest();

      await request(app.getHttpServer())
        .post(`/orgs/${orgId}/requests/${req.id}/approve`)
        .expect(200);

      const audit = await prisma.ticketRequestAudit.findFirst({
        where: { ticketRequestId: req.id },
      });
      expect(audit).toMatchObject({
        capAtDecision: 1,
        issuedCountBefore: 1,
        issuedCountAfter: 2,
      });
    });

    it('409 when the request was already cancelled — no Ticket, no email (AE10)', async () => {
      const req = await createRequest({
        status: TicketRequestStatus.CANCELLED_BY_USER,
      });

      await request(app.getHttpServer())
        .post(`/orgs/${orgId}/requests/${req.id}/approve`)
        .expect(409);

      const ticket = await prisma.ticket.findUnique({
        where: { ticketRequestId: req.id },
      });
      expect(ticket).toBeNull();
      expect(fakeMailer.sent).toHaveLength(0);
    });

    it('two concurrent approves → exactly one Ticket + APPROVED, the loser 409 (AE13)', async () => {
      const req = await createRequest();

      const statuses = await Promise.all([
        request(app.getHttpServer())
          .post(`/orgs/${orgId}/requests/${req.id}/approve`)
          .then((r) => r.status),
        request(app.getHttpServer())
          .post(`/orgs/${orgId}/requests/${req.id}/approve`)
          .then((r) => r.status),
      ]);
      expect(statuses.slice().sort()).toEqual([200, 409]);

      const tickets = await prisma.ticket.count({
        where: { ticketRequestId: req.id },
      });
      expect(tickets).toBe(1);
    });
  });

  describe('approve PAID', () => {
    it('mints an expiring linked session, flips APPROVED, audits, emails, no Ticket yet (AE4)', async () => {
      const req = await createRequest({ intent: TicketRequestIntent.PAID });

      const res = await request(app.getHttpServer())
        .post(`/orgs/${orgId}/requests/${req.id}/approve`)
        .expect(200);
      expect(jsonBody<{ status: string }>(res).status).toBe(
        TicketRequestStatus.APPROVED,
      );

      const row = await prisma.ticketRequest.findUnique({
        where: { id: req.id },
      });
      expect(row?.status).toBe(TicketRequestStatus.APPROVED);
      expect(row?.stripeCheckoutSessionId).toBeTruthy();

      const calls = fakeStripe.callsFor('checkout.sessions.create');
      expect(calls).toHaveLength(1);
      const params = calls[0].args[0] as {
        expires_at?: number;
        metadata?: Record<string, string>;
      };
      const options = calls[0].args[1] as
        | { idempotencyKey?: string }
        | undefined;
      expect(typeof params.expires_at).toBe('number');
      expect(params.metadata?.ticketRequestId).toBe(req.id);
      expect(options?.idempotencyKey).toBe(`waitlist-checkout-${req.id}`);

      const audit = await prisma.ticketRequestAudit.findFirst({
        where: { ticketRequestId: req.id },
      });
      expect(audit).toMatchObject({
        decision: TicketRequestDecision.APPROVE,
        issuedCountBefore: 0,
        issuedCountAfter: 0,
      });
      expect(fakeMailer.lastOf('paid-approved')?.to).toBe(REQUESTER_EMAIL);

      const ticket = await prisma.ticket.findUnique({
        where: { ticketRequestId: req.id },
      });
      expect(ticket).toBeNull();
    });

    it('two concurrent paid approves → one shared session, one APPROVED, loser 409 (AE13)', async () => {
      const req = await createRequest({ intent: TicketRequestIntent.PAID });

      const statuses = await Promise.all([
        request(app.getHttpServer())
          .post(`/orgs/${orgId}/requests/${req.id}/approve`)
          .then((r) => r.status),
        request(app.getHttpServer())
          .post(`/orgs/${orgId}/requests/${req.id}/approve`)
          .then((r) => r.status),
      ]);
      expect(statuses.slice().sort()).toEqual([200, 409]);

      const row = await prisma.ticketRequest.findUnique({
        where: { id: req.id },
      });
      expect(row?.status).toBe(TicketRequestStatus.APPROVED);
      expect(row?.stripeCheckoutSessionId).toBeTruthy();
      expect(fakeStripe.checkoutSessions.size).toBe(1);
    });
  });

  describe('reject', () => {
    it('flips REJECTED, audits, emails, and makes no Stripe call (AE6)', async () => {
      const req = await createRequest();

      const res = await request(app.getHttpServer())
        .post(`/orgs/${orgId}/requests/${req.id}/reject`)
        .send({ reason: 'Sold out' })
        .expect(200);
      expect(jsonBody<{ status: string }>(res).status).toBe(
        TicketRequestStatus.REJECTED,
      );

      const audit = await prisma.ticketRequestAudit.findFirst({
        where: { ticketRequestId: req.id },
      });
      expect(audit?.decision).toBe(TicketRequestDecision.REJECT);
      expect(fakeMailer.lastOf('rejected')?.to).toBe(REQUESTER_EMAIL);
      expect(fakeStripe.callsFor('checkout.sessions.create')).toHaveLength(0);
      const ticket = await prisma.ticket.findUnique({
        where: { ticketRequestId: req.id },
      });
      expect(ticket).toBeNull();
    });

    it('rejects a too-long reason with 400 (DTO bound)', async () => {
      const req = await createRequest();
      await request(app.getHttpServer())
        .post(`/orgs/${orgId}/requests/${req.id}/reject`)
        .send({ reason: 'x'.repeat(501) })
        .expect(400);
    });
  });

  describe('authorization + scoping', () => {
    it('404 when the request belongs to another org (assertRequestInOrg)', async () => {
      const req = await createRequest();
      await request(app.getHttpServer())
        .post(`/orgs/${otherOrgId}/requests/${req.id}/reject`)
        .send({})
        .expect(404);
    });

    it('MEMBER gets 403; non-member gets 404', async () => {
      const req = await createRequest();

      currentSub.value = 'member-sub';
      await request(app.getHttpServer())
        .post(`/orgs/${orgId}/requests/${req.id}/approve`)
        .expect(403);

      currentSub.value = 'stranger';
      await request(app.getHttpServer())
        .post(`/orgs/${orgId}/requests/${req.id}/approve`)
        .expect(404);
    });
  });

  describe('queue list + realtime', () => {
    it('lists the org pending queue FIFO with cap + issuedCount', async () => {
      await seedIssuedTickets(1);
      await createRequest();

      const res = await request(app.getHttpServer())
        .get(`/orgs/${orgId}/requests`)
        .expect(200);
      const body = jsonBody<{
        items: Array<{
          status: string;
          ticketType: { cap: number | null };
          issuedCount: number;
        }>;
      }>(res);
      expect(body.items).toHaveLength(1);
      expect(body.items[0].status).toBe(TicketRequestStatus.PENDING);
      expect(body.items[0].ticketType.cap).toBe(1);
      expect(body.items[0].issuedCount).toBe(1);
    });

    it('emits request.updated on the org stream after a reject', async () => {
      const req = await createRequest();
      const hub = app.get(WaitlistStream);
      const received = firstValueFrom(
        hub.stream(orgId).pipe(
          filter((e) => e.type === 'request.updated'),
          take(1),
        ),
      );

      await request(app.getHttpServer())
        .post(`/orgs/${orgId}/requests/${req.id}/reject`)
        .send({})
        .expect(200);

      const event = await received;
      expect(event.type).toBe('request.updated');
    });
  });
});
