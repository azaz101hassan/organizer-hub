import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import request from 'supertest';
import { MembershipTier, SubscriptionStatus } from '@organizer-hub/db/api';
import { MembershipsService } from './../src/memberships/memberships.service';
import { StripeClient } from './../src/billing/stripe.client';
import { PrismaService } from './../src/prisma/prisma.service';
import {
  bootTestApp,
  makeSubHolder,
  stubJwtAuthGuard,
} from './helpers/boot-test-app';
import {
  FakeStripeClient,
  type FakeStripePrice,
  type FakeStripeSubscription,
  type FakeSubscriptionStatus,
} from './helpers/fake-stripe';
import { jsonBody } from './helpers/http';

type MembershipMe = { userId: string; tier: string };
type PlanRow = {
  lookupKey: string;
  tier: string;
  tierLevel: number;
  cadence: string;
};

const USER = 'user-mem-1';
const CUSTOMER = 'cus_test_mem_1';

function priceOf(lookupKey: string): FakeStripePrice {
  return {
    id: `price_${lookupKey}`,
    lookup_key: lookupKey,
    product: 'prod_membership',
    unit_amount: 1000,
    currency: 'usd',
    active: true,
  };
}

function makeSub(
  overrides: Partial<FakeStripeSubscription> & {
    id?: string;
    status?: FakeSubscriptionStatus;
    lookupKey?: string;
    currentPeriodEndSeconds?: number;
    cancelAtPeriodEnd?: boolean;
  } = {},
): FakeStripeSubscription {
  const lookupKey = overrides.lookupKey ?? 'membership_gold_monthly';
  return {
    id: overrides.id ?? 'sub_test_mem_1',
    customer: CUSTOMER,
    status: overrides.status ?? 'active',
    cancel_at_period_end: overrides.cancelAtPeriodEnd ?? false,
    items: {
      data: [
        {
          id: 'si_test_1',
          price: priceOf(lookupKey),
          current_period_end:
            overrides.currentPeriodEndSeconds ??
            Math.floor(new Date('2027-01-01T00:00:00Z').getTime() / 1000),
        },
      ],
    },
  };
}

describe('Memberships (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let memberships: MembershipsService;
  let fakeStripe: FakeStripeClient;

  beforeAll(async () => {
    fakeStripe = new FakeStripeClient();
    ({ app, prisma } = await bootTestApp(
      stubJwtAuthGuard(makeSubHolder(USER)),
      [{ token: StripeClient, useValue: fakeStripe }],
    ));
    memberships = app.get(MembershipsService);

    // Ensure the seeded plan catalog exists in this DB. Tests that hit
    // /public/memberships need the six rows; tests against syncStripeData
    // also indirectly depend on them once we wire coverage in U7/U8.
    const seeds = [
      {
        lookupKey: 'membership_bronze_monthly',
        tier: 'BRONZE' as const,
        tierLevel: 1,
        displayName: 'Bronze (monthly)',
        cadence: 'monthly',
      },
      {
        lookupKey: 'membership_bronze_yearly',
        tier: 'BRONZE' as const,
        tierLevel: 1,
        displayName: 'Bronze (yearly)',
        cadence: 'yearly',
      },
      {
        lookupKey: 'membership_silver_monthly',
        tier: 'SILVER' as const,
        tierLevel: 2,
        displayName: 'Silver (monthly)',
        cadence: 'monthly',
      },
      {
        lookupKey: 'membership_silver_yearly',
        tier: 'SILVER' as const,
        tierLevel: 2,
        displayName: 'Silver (yearly)',
        cadence: 'yearly',
      },
      {
        lookupKey: 'membership_gold_monthly',
        tier: 'GOLD' as const,
        tierLevel: 3,
        displayName: 'Gold (monthly)',
        cadence: 'monthly',
      },
      {
        lookupKey: 'membership_gold_yearly',
        tier: 'GOLD' as const,
        tierLevel: 3,
        displayName: 'Gold (yearly)',
        cadence: 'yearly',
      },
    ];
    for (const p of seeds) {
      await prisma.membershipPlan.upsert({
        where: { lookupKey: p.lookupKey },
        create: p,
        update: p,
      });
    }
  });

  beforeEach(async () => {
    await prisma.membership.deleteMany({});
    await prisma.billingCustomer.deleteMany({});
    fakeStripe.reset();
    await prisma.billingCustomer.create({
      data: { userId: USER, stripeCustomerId: CUSTOMER },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('syncStripeData', () => {
    it('creates a Membership row from an active gold subscription', async () => {
      fakeStripe.seedSubscription(makeSub());

      const view = await memberships.syncStripeData(CUSTOMER);

      expect(view).not.toBeNull();
      expect(view!.userId).toBe(USER);
      expect(view!.tier).toBe(MembershipTier.GOLD);
      expect(view!.tierLevel).toBe(3);
      expect(view!.status).toBe(SubscriptionStatus.ACTIVE);
      expect(view!.cancelAtPeriodEnd).toBe(false);
      expect(view!.currentPeriodEnd.toISOString()).toBe(
        '2027-01-01T00:00:00.000Z',
      );

      const row = await prisma.membership.findUnique({
        where: { userId: USER },
      });
      expect(row?.stripeSubscriptionId).toBe('sub_test_mem_1');
    });

    it('updates the existing row when tier changes (silver → gold)', async () => {
      fakeStripe.seedSubscription(
        makeSub({ lookupKey: 'membership_silver_monthly' }),
      );
      await memberships.syncStripeData(CUSTOMER);

      // Same subscription id, different price item (a Stripe tier change
      // mutates the sub item's price, not the subscription id).
      fakeStripe.subscriptions.clear();
      fakeStripe.seedSubscription(
        makeSub({ lookupKey: 'membership_gold_monthly' }),
      );
      const second = await memberships.syncStripeData(CUSTOMER);

      expect(second!.tier).toBe(MembershipTier.GOLD);
      const count = await prisma.membership.count({ where: { userId: USER } });
      expect(count).toBe(1);
    });

    it('marks the existing Membership CANCELED when no live subscription remains', async () => {
      fakeStripe.seedSubscription(makeSub());
      await memberships.syncStripeData(CUSTOMER);

      fakeStripe.subscriptions.clear();
      const after = await memberships.syncStripeData(CUSTOMER);

      expect(after!.status).toBe(SubscriptionStatus.CANCELED);
      const row = await prisma.membership.findUnique({
        where: { userId: USER },
      });
      expect(row?.status).toBe(SubscriptionStatus.CANCELED);
    });

    it('returns null when no subscription exists and none ever did', async () => {
      const result = await memberships.syncStripeData(CUSTOMER);
      expect(result).toBeNull();
      const row = await prisma.membership.findUnique({
        where: { userId: USER },
      });
      expect(row).toBeNull();
    });

    it('throws when the subscription item has an unknown lookup_key', async () => {
      fakeStripe.seedSubscription(makeSub({ lookupKey: 'membership_mystery' }));
      await expect(memberships.syncStripeData(CUSTOMER)).rejects.toThrow(
        /Unknown membership lookup_key/,
      );
      const row = await prisma.membership.findUnique({
        where: { userId: USER },
      });
      expect(row).toBeNull();
    });

    it('mirrors cancel_at_period_end=true while keeping status ACTIVE until the period ends (AE6)', async () => {
      const periodEnd = Math.floor(
        new Date('2027-06-01T00:00:00Z').getTime() / 1000,
      );
      fakeStripe.seedSubscription(
        makeSub({
          cancelAtPeriodEnd: true,
          currentPeriodEndSeconds: periodEnd,
        }),
      );

      const view = await memberships.syncStripeData(CUSTOMER);

      expect(view!.status).toBe(SubscriptionStatus.ACTIVE);
      expect(view!.cancelAtPeriodEnd).toBe(true);
      expect(view!.currentPeriodEnd.toISOString()).toBe(
        '2027-06-01T00:00:00.000Z',
      );

      // After Stripe flips status → canceled (its scheduled cancel firing),
      // the next sync should reflect that locally.
      fakeStripe.subscriptions.clear();
      const second = await memberships.syncStripeData(CUSTOMER);
      expect(second!.status).toBe(SubscriptionStatus.CANCELED);
    });

    it('falls back to customer metadata.userId when BillingCustomer row is missing', async () => {
      await prisma.billingCustomer.deleteMany({});
      // Seed the Stripe-side customer directly so retrieve() returns it.
      fakeStripe.customers.set('cus_orphan', {
        id: 'cus_orphan',
        metadata: { userId: USER },
      });
      fakeStripe.seedSubscription({
        ...makeSub({ id: 'sub_orphan' }),
        customer: 'cus_orphan',
      });

      const view = await memberships.syncStripeData('cus_orphan');

      expect(view!.userId).toBe(USER);
      expect(view!.stripeCustomerId).toBe('cus_orphan');
    });

    it('returns null when no BillingCustomer row exists and metadata.userId is absent', async () => {
      await prisma.billingCustomer.deleteMany({});
      fakeStripe.customers.set('cus_lonely', {
        id: 'cus_lonely',
        metadata: {},
      });
      fakeStripe.seedSubscription({
        ...makeSub({ id: 'sub_lonely' }),
        customer: 'cus_lonely',
      });

      const view = await memberships.syncStripeData('cus_lonely');
      expect(view).toBeNull();
    });
  });

  describe('getActiveMembershipForUser', () => {
    it('returns the row for an ACTIVE membership', async () => {
      fakeStripe.seedSubscription(makeSub());
      await memberships.syncStripeData(CUSTOMER);

      const view = await memberships.getActiveMembershipForUser(USER);
      expect(view?.status).toBe(SubscriptionStatus.ACTIVE);
    });

    it('returns null for a CANCELED membership', async () => {
      fakeStripe.seedSubscription(makeSub());
      await memberships.syncStripeData(CUSTOMER);
      fakeStripe.subscriptions.clear();
      await memberships.syncStripeData(CUSTOMER);

      const view = await memberships.getActiveMembershipForUser(USER);
      expect(view).toBeNull();
    });

    it('returns null when the user has no Membership row', async () => {
      const view = await memberships.getActiveMembershipForUser('user-none');
      expect(view).toBeNull();
    });
  });

  describe('canClaimFree (U3 stub)', () => {
    it('returns false until U7/U8 wire the real coverage check', async () => {
      const allowed = await memberships.canClaimFree(USER, 'evt', 'tt');
      expect(allowed).toBe(false);
    });
  });

  describe('GET /memberships/me', () => {
    it('returns the row when present', async () => {
      fakeStripe.seedSubscription(makeSub());
      await memberships.syncStripeData(CUSTOMER);

      const res = await request(app.getHttpServer())
        .get('/memberships/me')
        .expect(200);

      const body = jsonBody<MembershipMe>(res);
      expect(body.userId).toBe(USER);
      expect(body.tier).toBe(MembershipTier.GOLD);
    });

    it('opportunistically syncs when row missing but BillingCustomer exists', async () => {
      // BillingCustomer is already seeded in beforeEach; no Membership row yet.
      fakeStripe.seedSubscription(makeSub());

      const res = await request(app.getHttpServer())
        .get('/memberships/me')
        .expect(200);

      expect(jsonBody<MembershipMe>(res).tier).toBe(MembershipTier.GOLD);
      const row = await prisma.membership.findUnique({
        where: { userId: USER },
      });
      expect(row).not.toBeNull();
    });

    it('returns empty body when user has neither row nor BillingCustomer', async () => {
      await prisma.billingCustomer.deleteMany({});
      const res = await request(app.getHttpServer())
        .get('/memberships/me')
        .expect(200);
      expect(res.body).toEqual({});
    });
  });

  describe('GET /public/memberships', () => {
    it('returns the seeded six-plan catalog sorted by tier then cadence', async () => {
      const res = await request(app.getHttpServer())
        .get('/public/memberships')
        .expect(200);

      const plans = jsonBody<PlanRow[]>(res);
      expect(Array.isArray(plans)).toBe(true);
      expect(plans.length).toBe(6);
      expect(plans[0]).toMatchObject({
        lookupKey: 'membership_bronze_monthly',
        tier: 'BRONZE',
        tierLevel: 1,
        cadence: 'monthly',
      });
      // Stripe Price IDs must not leak — only stable lookup_keys.
      for (const plan of plans) {
        expect(plan).not.toHaveProperty('stripePriceId');
        expect(plan).not.toHaveProperty('priceId');
      }
    });
  });
});
