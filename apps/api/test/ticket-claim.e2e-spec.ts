import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  EventStatus,
  MembershipTier,
  OrganizationRole,
  SubscriptionStatus,
  TicketRequestIntent,
  TicketRequestStatus,
  TicketSource,
} from '@organizer-hub/db/api';
import { StripeClient } from './../src/billing/stripe.client';
import { PrismaService } from './../src/prisma/prisma.service';
import {
  bootTestApp,
  makeSubHolder,
  stubJwtAuthGuard,
  type SubHolder,
} from './helpers/boot-test-app';
import { FakeStripeClient } from './helpers/fake-stripe';
import { jsonBody } from './helpers/http';

interface CoverageResult {
  verdict: 'OWNED' | 'AT_CAP' | 'CLAIMABLE' | 'BUY';
  requestIntent?: 'PAID' | 'MEMBERSHIP_CLAIM';
  openRequestId?: string | null;
}
type CoverageMap = Record<string, CoverageResult>;

const USER = 'user-claim-1';
const CUSTOMER = 'cus_claim_1';

interface TicketTypeFixture {
  id: string;
  eventId: string;
}

async function seedEventWithTicketType(
  prisma: PrismaService,
  args: {
    orgId: string;
    creator: string;
    eventSlug: string;
    eventStatus?: EventStatus;
    membersExcluded?: boolean;
    ticketName: string;
    priceCents: number;
    minTierLevel: number;
    cap?: number | null;
  },
): Promise<TicketTypeFixture> {
  const ev = await prisma.event.create({
    data: {
      organizationId: args.orgId,
      title: args.eventSlug,
      slug: args.eventSlug,
      startsAt: new Date('2026-06-01T18:00:00Z'),
      status: args.eventStatus ?? EventStatus.PUBLISHED,
      publishedAt:
        (args.eventStatus ?? EventStatus.PUBLISHED) === EventStatus.PUBLISHED
          ? new Date()
          : null,
      membersExcluded: args.membersExcluded ?? false,
      createdBy: args.creator,
    },
  });
  const tt = await prisma.ticketType.create({
    data: {
      eventId: ev.id,
      name: args.ticketName,
      priceCents: args.priceCents,
      minTierLevel: args.minTierLevel,
      cap: args.cap ?? null,
      stripeProductId: `prod_${args.eventSlug}_${args.ticketName}`,
      stripePriceId: `price_${args.eventSlug}_${args.ticketName}`,
    },
  });
  return { id: tt.id, eventId: ev.id };
}

async function seedMembership(
  prisma: PrismaService,
  args: {
    tier: MembershipTier;
    tierLevel: number;
    status?: SubscriptionStatus;
    cancelAtPeriodEnd?: boolean;
  },
): Promise<void> {
  await prisma.billingCustomer.upsert({
    where: { userId: USER },
    update: {},
    create: { userId: USER, stripeCustomerId: CUSTOMER },
  });
  await prisma.membership.upsert({
    where: { userId: USER },
    create: {
      userId: USER,
      stripeCustomerId: CUSTOMER,
      stripeSubscriptionId: `sub_${USER}`,
      status: args.status ?? SubscriptionStatus.ACTIVE,
      tier: args.tier,
      tierLevel: args.tierLevel,
      currentPeriodEnd: new Date('2027-01-01T00:00:00Z'),
      cancelAtPeriodEnd: args.cancelAtPeriodEnd ?? false,
    },
    update: {
      status: args.status ?? SubscriptionStatus.ACTIVE,
      tier: args.tier,
      tierLevel: args.tierLevel,
      cancelAtPeriodEnd: args.cancelAtPeriodEnd ?? false,
    },
  });
}

describe('Ticket claim (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let fakeStripe: FakeStripeClient;
  let holder: SubHolder;
  let orgId: string;

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
    await prisma.membership.deleteMany({});
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
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /tickets/claim', () => {
    it('GOLD member claims a Gold-tier ticket — Ticket row issued with MEMBERSHIP_CLAIM source (AE2)', async () => {
      await seedMembership(prisma, {
        tier: MembershipTier.GOLD,
        tierLevel: 3,
      });
      const tt = await seedEventWithTicketType(prisma, {
        orgId,
        creator: USER,
        eventSlug: 'gold-gala',
        ticketName: 'VIP',
        priceCents: 0,
        minTierLevel: 3,
      });

      const res = await request(app.getHttpServer())
        .post('/tickets/claim')
        .send({ ticketTypeId: tt.id })
        .expect(201);

      expect(res.body).toMatchObject({
        kind: 'ticket',
        ticket: {
          userId: USER,
          eventId: tt.eventId,
          ticketTypeId: tt.id,
          source: TicketSource.MEMBERSHIP_CLAIM,
          stripeCheckoutSessionId: null,
          stripePaymentIntentId: null,
        },
      });
    });

    it('returns 409 when the event has membersExcluded=true (AE3 excluded branch)', async () => {
      await seedMembership(prisma, {
        tier: MembershipTier.GOLD,
        tierLevel: 3,
      });
      const tt = await seedEventWithTicketType(prisma, {
        orgId,
        creator: USER,
        eventSlug: 'excluded',
        membersExcluded: true,
        ticketName: 'VIP',
        priceCents: 0,
        minTierLevel: 3,
      });

      await request(app.getHttpServer())
        .post('/tickets/claim')
        .send({ ticketTypeId: tt.id })
        .expect(409);
    });

    it('returns 409 when the membership tier is below minTierLevel', async () => {
      await seedMembership(prisma, {
        tier: MembershipTier.SILVER,
        tierLevel: 2,
      });
      const tt = await seedEventWithTicketType(prisma, {
        orgId,
        creator: USER,
        eventSlug: 'gold-needed',
        ticketName: 'VIP',
        priceCents: 0,
        minTierLevel: 3,
      });

      await request(app.getHttpServer())
        .post('/tickets/claim')
        .send({ ticketTypeId: tt.id })
        .expect(409);
    });

    it('returns 409 when there is no active membership', async () => {
      const tt = await seedEventWithTicketType(prisma, {
        orgId,
        creator: USER,
        eventSlug: 'no-mem',
        ticketName: 'VIP',
        priceCents: 0,
        minTierLevel: 1,
      });

      await request(app.getHttpServer())
        .post('/tickets/claim')
        .send({ ticketTypeId: tt.id })
        .expect(409);
    });

    it('returns 409 when the membership is PAST_DUE', async () => {
      await seedMembership(prisma, {
        tier: MembershipTier.GOLD,
        tierLevel: 3,
        status: SubscriptionStatus.PAST_DUE,
      });
      const tt = await seedEventWithTicketType(prisma, {
        orgId,
        creator: USER,
        eventSlug: 'past-due',
        ticketName: 'VIP',
        priceCents: 0,
        minTierLevel: 3,
      });

      await request(app.getHttpServer())
        .post('/tickets/claim')
        .send({ ticketTypeId: tt.id })
        .expect(409);
    });

    it('returns 409 when a MEMBERSHIP_CLAIM ticket already exists (AE4)', async () => {
      await seedMembership(prisma, {
        tier: MembershipTier.GOLD,
        tierLevel: 3,
      });
      const tt = await seedEventWithTicketType(prisma, {
        orgId,
        creator: USER,
        eventSlug: 'twice',
        ticketName: 'VIP',
        priceCents: 0,
        minTierLevel: 3,
      });

      await request(app.getHttpServer())
        .post('/tickets/claim')
        .send({ ticketTypeId: tt.id })
        .expect(201);

      await request(app.getHttpServer())
        .post('/tickets/claim')
        .send({ ticketTypeId: tt.id })
        .expect(409);

      const count = await prisma.ticket.count({
        where: {
          userId: USER,
          eventId: tt.eventId,
          source: TicketSource.MEMBERSHIP_CLAIM,
        },
      });
      expect(count).toBe(1);
    });

    it('issued tickets survive membership cancellation (AE5 — R11)', async () => {
      await seedMembership(prisma, {
        tier: MembershipTier.GOLD,
        tierLevel: 3,
      });
      const tt = await seedEventWithTicketType(prisma, {
        orgId,
        creator: USER,
        eventSlug: 'survive',
        ticketName: 'VIP',
        priceCents: 0,
        minTierLevel: 3,
      });
      await request(app.getHttpServer())
        .post('/tickets/claim')
        .send({ ticketTypeId: tt.id })
        .expect(201);

      // Fast-forward the membership row to CANCELED — simulates Stripe
      // having flipped the subscription state and syncStripeData having
      // applied it locally.
      await prisma.membership.update({
        where: { userId: USER },
        data: { status: SubscriptionStatus.CANCELED },
      });

      const ticket = await prisma.ticket.findFirst({
        where: {
          userId: USER,
          eventId: tt.eventId,
          ticketTypeId: tt.id,
          source: TicketSource.MEMBERSHIP_CLAIM,
        },
      });
      expect(ticket).not.toBeNull();
    });

    it('returns 409 when ticketType.minTierLevel is 0 (open paid tier)', async () => {
      await seedMembership(prisma, {
        tier: MembershipTier.GOLD,
        tierLevel: 3,
      });
      const tt = await seedEventWithTicketType(prisma, {
        orgId,
        creator: USER,
        eventSlug: 'open-paid',
        ticketName: 'GA',
        priceCents: 5000,
        minTierLevel: 0,
      });

      await request(app.getHttpServer())
        .post('/tickets/claim')
        .send({ ticketTypeId: tt.id })
        .expect(409);
    });

    it('returns 404 when the ticket type does not exist', async () => {
      await seedMembership(prisma, {
        tier: MembershipTier.GOLD,
        tierLevel: 3,
      });

      await request(app.getHttpServer())
        .post('/tickets/claim')
        .send({ ticketTypeId: 'tt_does_not_exist' })
        .expect(404);
    });

    it('returns 400 on missing DTO field', async () => {
      await request(app.getHttpServer())
        .post('/tickets/claim')
        .send({})
        .expect(400);
    });

    it('at cap → MEMBERSHIP_CLAIM request instead of an instant Ticket (R3, AE2)', async () => {
      await seedMembership(prisma, {
        tier: MembershipTier.GOLD,
        tierLevel: 3,
      });
      const tt = await seedEventWithTicketType(prisma, {
        orgId,
        creator: USER,
        eventSlug: 'capped-claim',
        ticketName: 'VIP',
        priceCents: 0,
        minTierLevel: 3,
      });
      // Fill to cap with another member's claim so USER's own duplicate-claim
      // gate still passes and only the cap blocks the instant issue.
      await prisma.ticketType.update({
        where: { id: tt.id },
        data: { cap: 1 },
      });
      await prisma.ticket.create({
        data: {
          userId: 'other-member',
          eventId: tt.eventId,
          ticketTypeId: tt.id,
          source: TicketSource.MEMBERSHIP_CLAIM,
        },
      });

      const res = await request(app.getHttpServer())
        .post('/tickets/claim')
        .send({ ticketTypeId: tt.id })
        .expect(201);

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
        ticketTypeId: tt.id,
        intent: TicketRequestIntent.MEMBERSHIP_CLAIM,
        status: TicketRequestStatus.PENDING,
      });
      // No instant Ticket for USER.
      const userTickets = await prisma.ticket.count({
        where: { userId: USER, ticketTypeId: tt.id },
      });
      expect(userTickets).toBe(0);
    });

    it('ineligible (below-tier) at cap → 409 and NO request created (R5, AE2)', async () => {
      await seedMembership(prisma, {
        tier: MembershipTier.SILVER,
        tierLevel: 2,
      });
      const tt = await seedEventWithTicketType(prisma, {
        orgId,
        creator: USER,
        eventSlug: 'capped-ineligible',
        ticketName: 'VIP',
        priceCents: 0,
        minTierLevel: 3,
      });
      await prisma.ticketType.update({
        where: { id: tt.id },
        data: { cap: 1 },
      });
      await prisma.ticket.create({
        data: {
          userId: 'other-member',
          eventId: tt.eventId,
          ticketTypeId: tt.id,
          source: TicketSource.MEMBERSHIP_CLAIM,
        },
      });

      await request(app.getHttpServer())
        .post('/tickets/claim')
        .send({ ticketTypeId: tt.id })
        .expect(409);

      const requests = await prisma.ticketRequest.count({
        where: { userId: USER, ticketTypeId: tt.id },
      });
      expect(requests).toBe(0);
    });
  });

  describe('GET /memberships/me/coverage', () => {
    it('returns mixed OWNED / CLAIMABLE / BUY verdicts across a list of ticket types', async () => {
      await seedMembership(prisma, {
        tier: MembershipTier.SILVER,
        tierLevel: 2,
      });
      const claimable = await seedEventWithTicketType(prisma, {
        orgId,
        creator: USER,
        eventSlug: 'claimable',
        ticketName: 'Silver',
        priceCents: 0,
        minTierLevel: 2,
      });
      const buy = await seedEventWithTicketType(prisma, {
        orgId,
        creator: USER,
        eventSlug: 'too-high',
        ticketName: 'Gold',
        priceCents: 5000,
        minTierLevel: 3,
      });
      const owned = await seedEventWithTicketType(prisma, {
        orgId,
        creator: USER,
        eventSlug: 'owned',
        ticketName: 'GA',
        priceCents: 5000,
        minTierLevel: 0,
      });
      await prisma.ticket.create({
        data: {
          userId: USER,
          eventId: owned.eventId,
          ticketTypeId: owned.id,
          source: TicketSource.PAID,
          stripeCheckoutSessionId: 'cs_owned',
        },
      });

      const res = await request(app.getHttpServer())
        .get(
          `/memberships/me/coverage?ticketTypeIds=${[claimable.id, buy.id, owned.id, 'unknown'].join(',')}`,
        )
        .expect(200);

      const body = jsonBody<CoverageMap>(res);
      expect(body[claimable.id].verdict).toBe('CLAIMABLE');
      expect(body[buy.id].verdict).toBe('BUY');
      expect(body[owned.id].verdict).toBe('OWNED');
      expect(body['unknown'].verdict).toBe('BUY');
    });

    it('returns an empty object when no ticketTypeIds are passed', async () => {
      const res = await request(app.getHttpServer())
        .get('/memberships/me/coverage')
        .expect(200);
      expect(res.body).toEqual({});
    });

    it('returns BUY for excluded events even when the user could otherwise claim', async () => {
      await seedMembership(prisma, {
        tier: MembershipTier.GOLD,
        tierLevel: 3,
      });
      const tt = await seedEventWithTicketType(prisma, {
        orgId,
        creator: USER,
        eventSlug: 'excluded-verdict',
        membersExcluded: true,
        ticketName: 'VIP',
        priceCents: 0,
        minTierLevel: 3,
      });

      const res = await request(app.getHttpServer())
        .get(`/memberships/me/coverage?ticketTypeIds=${tt.id}`)
        .expect(200);
      expect(jsonBody<CoverageMap>(res)[tt.id].verdict).toBe('BUY');
    });

    it('resolves AT_CAP (PAID intent) for a full paid tier with no open request (R20)', async () => {
      const tt = await seedEventWithTicketType(prisma, {
        orgId,
        creator: USER,
        eventSlug: 'paid-full',
        ticketName: 'GA',
        priceCents: 5000,
        minTierLevel: 0,
        cap: 1,
      });
      // Someone else holds the only seat → the tier is at cap for USER.
      await prisma.ticket.create({
        data: {
          userId: 'other-holder',
          eventId: tt.eventId,
          ticketTypeId: tt.id,
          source: TicketSource.PAID,
          stripeCheckoutSessionId: 'cs_paid_full',
        },
      });

      const res = await request(app.getHttpServer())
        .get(`/memberships/me/coverage?ticketTypeIds=${tt.id}`)
        .expect(200);
      const result = jsonBody<CoverageMap>(res)[tt.id];
      expect(result.verdict).toBe('AT_CAP');
      expect(result.requestIntent).toBe('PAID');
      expect(result.openRequestId).toBeNull();
    });

    it('resolves AT_CAP (MEMBERSHIP_CLAIM intent) for a full member tier', async () => {
      await seedMembership(prisma, {
        tier: MembershipTier.GOLD,
        tierLevel: 3,
      });
      const tt = await seedEventWithTicketType(prisma, {
        orgId,
        creator: USER,
        eventSlug: 'member-full',
        ticketName: 'Gold',
        priceCents: 0,
        minTierLevel: 3,
        cap: 1,
      });
      await prisma.ticket.create({
        data: {
          userId: 'other-holder',
          eventId: tt.eventId,
          ticketTypeId: tt.id,
          source: TicketSource.MEMBERSHIP_CLAIM,
        },
      });

      const res = await request(app.getHttpServer())
        .get(`/memberships/me/coverage?ticketTypeIds=${tt.id}`)
        .expect(200);
      const result = jsonBody<CoverageMap>(res)[tt.id];
      expect(result.verdict).toBe('AT_CAP');
      expect(result.requestIntent).toBe('MEMBERSHIP_CLAIM');
    });

    it('OWNED still wins over AT_CAP when the caller already holds a ticket', async () => {
      const tt = await seedEventWithTicketType(prisma, {
        orgId,
        creator: USER,
        eventSlug: 'owned-full',
        ticketName: 'GA',
        priceCents: 5000,
        minTierLevel: 0,
        cap: 1,
      });
      // The caller's own ticket is the one that fills the cap.
      await prisma.ticket.create({
        data: {
          userId: USER,
          eventId: tt.eventId,
          ticketTypeId: tt.id,
          source: TicketSource.PAID,
          stripeCheckoutSessionId: 'cs_owned_full',
        },
      });

      const res = await request(app.getHttpServer())
        .get(`/memberships/me/coverage?ticketTypeIds=${tt.id}`)
        .expect(200);
      expect(jsonBody<CoverageMap>(res)[tt.id].verdict).toBe('OWNED');
    });

    it('AT_CAP carries openRequestId when the caller already has an open request', async () => {
      const tt = await seedEventWithTicketType(prisma, {
        orgId,
        creator: USER,
        eventSlug: 'paid-full-pending',
        ticketName: 'GA',
        priceCents: 5000,
        minTierLevel: 0,
        cap: 1,
      });
      await prisma.ticket.create({
        data: {
          userId: 'other-holder',
          eventId: tt.eventId,
          ticketTypeId: tt.id,
          source: TicketSource.PAID,
          stripeCheckoutSessionId: 'cs_paid_full_pending',
        },
      });
      const open = await prisma.ticketRequest.create({
        data: {
          userId: USER,
          ticketTypeId: tt.id,
          eventId: tt.eventId,
          intent: TicketRequestIntent.PAID,
          status: TicketRequestStatus.PENDING,
        },
      });

      const res = await request(app.getHttpServer())
        .get(`/memberships/me/coverage?ticketTypeIds=${tt.id}`)
        .expect(200);
      const result = jsonBody<CoverageMap>(res)[tt.id];
      expect(result.verdict).toBe('AT_CAP');
      expect(result.openRequestId).toBe(open.id);
    });
  });
});
