import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  EventStatus,
  MembershipTier,
  OrganizationRole,
  SubscriptionStatus,
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
    await prisma.ticket.deleteMany({});
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
        userId: USER,
        eventId: tt.eventId,
        ticketTypeId: tt.id,
        source: TicketSource.MEMBERSHIP_CLAIM,
        stripeCheckoutSessionId: null,
        stripePaymentIntentId: null,
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

      expect(res.body[claimable.id]).toBe('CLAIMABLE');
      expect(res.body[buy.id]).toBe('BUY');
      expect(res.body[owned.id]).toBe('OWNED');
      expect(res.body['unknown']).toBe('BUY');
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
      expect(res.body[tt.id]).toBe('BUY');
    });
  });
});
