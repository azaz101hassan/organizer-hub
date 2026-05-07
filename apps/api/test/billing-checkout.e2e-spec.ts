import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import request from 'supertest';
import { MembershipTier, SubscriptionStatus } from '@organizer-hub/db/api';
import { StripeClient } from './../src/billing/stripe.client';
import { PrismaService } from './../src/prisma/prisma.service';
import {
  bootTestApp,
  makeSubHolder,
  stubJwtAuthGuard,
  type SubHolder,
} from './helpers/boot-test-app';
import {
  FakeStripeClient,
  type FakeStripeSubscription,
} from './helpers/fake-stripe';
import { jsonBody } from './helpers/http';

const USER = 'user-checkout-1';

describe('Billing checkout (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let fakeStripe: FakeStripeClient;
  let holder: SubHolder;

  beforeAll(async () => {
    fakeStripe = new FakeStripeClient();
    holder = makeSubHolder(USER);
    ({ app, prisma } = await bootTestApp(stubJwtAuthGuard(holder), [
      { token: StripeClient, useValue: fakeStripe },
    ]));
  });

  beforeEach(async () => {
    await prisma.membership.deleteMany({});
    await prisma.billingCustomer.deleteMany({});
    fakeStripe.reset();
    holder.value = USER;

    // Seed the Stripe Price that prices.list will return for the gold lookup.
    fakeStripe.seedPrice({
      id: 'price_gold_monthly',
      lookup_key: 'membership_gold_monthly',
      product: 'prod_membership_gold',
      unit_amount: 4000,
      currency: 'usd',
      active: true,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates a Checkout Session URL for a known lookup_key', async () => {
    const res = await request(app.getHttpServer())
      .post('/billing/checkout/membership')
      .send({ lookupKey: 'membership_gold_monthly' })
      .expect(200);

    expect(jsonBody<{ url: string }>(res).url).toMatch(
      /^https:\/\/checkout\.stripe\.test\//,
    );

    // Lazy BillingCustomer row + Stripe Customer must both be created.
    const billing = await prisma.billingCustomer.findUnique({
      where: { userId: USER },
    });
    expect(billing?.stripeCustomerId).toMatch(/^cus_test_/);

    const createCalls = fakeStripe.callsFor('checkout.sessions.create');
    expect(createCalls).toHaveLength(1);
    const params = createCalls[0].args[0] as Record<string, unknown>;
    expect(params.mode).toBe('subscription');
    expect(params.client_reference_id).toBe(USER);
    expect(params.customer).toBe(billing?.stripeCustomerId);
  });

  it('rejects unknown lookup_keys at the DTO layer with 400', async () => {
    await request(app.getHttpServer())
      .post('/billing/checkout/membership')
      .send({ lookupKey: 'membership_diamond_monthly' })
      .expect(400);
  });

  it('returns 404 when the Stripe Price for a valid lookup_key is missing or inactive', async () => {
    // No prices seeded for this lookup_key.
    await request(app.getHttpServer())
      .post('/billing/checkout/membership')
      .send({ lookupKey: 'membership_bronze_monthly' })
      .expect(404);
  });

  it('cancel endpoint flips cancel_at_period_end and syncs the local mirror', async () => {
    // First, set up a customer + active membership via syncStripeData so the
    // cancel endpoint has something to act on.
    const customer = 'cus_cancel_1';
    const subId = 'sub_cancel_1';
    await prisma.billingCustomer.create({
      data: { userId: USER, stripeCustomerId: customer },
    });
    const futureEnd = Math.floor(
      new Date('2027-12-01T00:00:00Z').getTime() / 1000,
    );
    const sub: FakeStripeSubscription = {
      id: subId,
      customer,
      status: 'active',
      cancel_at_period_end: false,
      items: {
        data: [
          {
            id: 'si_cancel',
            price: {
              id: 'price_g',
              lookup_key: 'membership_gold_monthly',
              product: 'prod_g',
              unit_amount: 4000,
              currency: 'usd',
              active: true,
            },
            current_period_end: futureEnd,
          },
        ],
      },
    };
    fakeStripe.seedSubscription(sub);
    fakeStripe.customers.set(customer, {
      id: customer,
      metadata: { userId: USER },
    });

    await prisma.membership.create({
      data: {
        userId: USER,
        stripeCustomerId: customer,
        stripeSubscriptionId: subId,
        status: SubscriptionStatus.ACTIVE,
        tier: MembershipTier.GOLD,
        tierLevel: 3,
        currentPeriodEnd: new Date(futureEnd * 1000),
        cancelAtPeriodEnd: false,
      },
    });

    const res = await request(app.getHttpServer())
      .post('/billing/membership/cancel')
      .send()
      .expect(200);

    expect(res.body).toEqual({ status: 'scheduled' });

    // Stripe-side cancel was issued.
    const updateCalls = fakeStripe.callsFor('subscriptions.update');
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].args[0]).toBe(subId);
    expect(updateCalls[0].args[1]).toMatchObject({
      cancel_at_period_end: true,
    });

    // Local mirror reflects cancellation (active until period end).
    const row = await prisma.membership.findUnique({
      where: { userId: USER },
    });
    expect(row?.cancelAtPeriodEnd).toBe(true);
    expect(row?.status).toBe(SubscriptionStatus.ACTIVE);
  });

  it('cancel returns 404 when the user has no active membership', async () => {
    await request(app.getHttpServer())
      .post('/billing/membership/cancel')
      .send()
      .expect(404);
  });
});
