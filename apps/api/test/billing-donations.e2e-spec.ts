import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import request from 'supertest';
import { StripeClient } from './../src/billing/stripe.client';
import { PrismaService } from './../src/prisma/prisma.service';
import {
  bootTestApp,
  makeSubHolder,
  stubJwtAuthGuard,
  type SubHolder,
} from './helpers/boot-test-app';
import { FakeStripeClient } from './helpers/fake-stripe';
import { campaignFactory, coalitionFactory, donationFactory } from './factories';
import { HOUSE_ORG_ID } from '../src/common/house-org';

const USER = 'user-donations-1';

describe('Donations checkout (one-time)', () => {
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
    await prisma.donation.deleteMany({});
    await prisma.campaign.deleteMany({});
    await prisma.coalition.deleteMany({});
    await prisma.billingCustomer.deleteMany();
    fakeStripe.reset();
    holder.value = USER;

    await prisma.organization.upsert({
      where: { id: 'org_test_donations' },
      update: { donationsEnabled: true },
      create: {
        id: 'org_test_donations',
        name: 'Test Org',
        slug: 'org-test-donations',
        createdBy: 'user-test',
        donationsEnabled: true,
      },
    });
    // Seed HOUSE_ORG_ID with donationsEnabled:true so the middleware fallback
    // can actually resolve it — this makes the regression test real: without
    // the GET-only guard, a POST with no campaignId would fall through to the
    // house org and reach the controller (returning 400, not 404).
    await prisma.organization.upsert({
      where: { id: HOUSE_ORG_ID },
      update: { donationsEnabled: true },
      create: {
        id: HOUSE_ORG_ID,
        name: 'House',
        slug: 'house',
        createdBy: 'seed',
        donationsEnabled: true,
      },
    });
    await prisma.coalition.create({
      data: coalitionFactory({ id: 'coal_1', organizationId: 'org_test_donations' }),
    });
    await prisma.campaign.create({
      data: campaignFactory({
        id: 'camp_1',
        coalitionId: 'coal_1',
        organizationId: 'org_test_donations',
        status: 'ACTIVE',
      }),
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 201 with url + donationId on a valid request', async () => {
    const res = await request(app.getHttpServer())
      .post('/billing/checkout/donation')
      .send({ campaignId: 'camp_1', cadence: 'ONCE', amountCents: 2500 });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ url: expect.any(String), donationId: expect.any(String) });
  });

  it('returns 400 on amount=99', async () => {
    const res = await request(app.getHttpServer())
      .post('/billing/checkout/donation')
      .send({ campaignId: 'camp_1', cadence: 'ONCE', amountCents: 99 });
    expect(res.status).toBe(400);
  });

  it('returns 404 when the org has donationsEnabled=false', async () => {
    await prisma.organization.update({
      where: { id: 'org_test_donations' },
      data: { donationsEnabled: false },
    });
    const res = await request(app.getHttpServer())
      .post('/billing/checkout/donation')
      .send({ campaignId: 'camp_1', cadence: 'ONCE', amountCents: 2500 });
    expect(res.status).toBe(404);
  });

  it('returns 201 with url + donationId for a MONTHLY recurring request and writes mode=RECURRING', async () => {
    const res = await request(app.getHttpServer())
      .post('/billing/checkout/donation')
      .send({ campaignId: 'camp_1', cadence: 'MONTHLY', amountCents: 2500 });
    expect(res.status).toBe(201);
    expect(res.body.donationId).toEqual(expect.any(String));

    const row = await prisma.donation.findUnique({ where: { id: res.body.donationId } });
    expect(row).toMatchObject({ mode: 'RECURRING', cadence: 'MONTHLY', status: 'PENDING' });

    const calls = fakeStripe.callsFor('checkout.sessions.create');
    const last = calls[calls.length - 1].args[0] as Record<string, unknown>;
    expect(last.mode).toBe('subscription');
  });

  it('returns 404 when the body has no campaignId — guard must short-circuit, controller must not run', async () => {
    // HOUSE_ORG_ID is seeded with donationsEnabled:true in beforeEach.
    // Without the GET-only guard on the fallback, the middleware would resolve
    // HOUSE_ORG_ID and the guard would pass, landing a 400 (DTO validation)
    // instead of 404. With the fix, no org is resolved for this POST, the
    // guard sees req.organization === undefined, and returns 404.
    const res = await request(app.getHttpServer())
      .post('/billing/checkout/donation')
      .send({ cadence: 'ONCE', amountCents: 2500 }); // no campaignId
    expect(res.status).toBe(404);
  });
});

describe('Donation cancel', () => {
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
    await prisma.donation.deleteMany({});
    await prisma.campaign.deleteMany({});
    await prisma.coalition.deleteMany({});
    await prisma.billingCustomer.deleteMany();
    fakeStripe.reset();
    holder.value = USER;

    await prisma.organization.upsert({
      where: { id: 'org_test_donations' },
      update: { donationsEnabled: true },
      create: {
        id: 'org_test_donations',
        name: 'Test Org',
        slug: 'org-test-donations',
        createdBy: 'user-test',
        donationsEnabled: true,
      },
    });
    await prisma.coalition.create({
      data: coalitionFactory({ id: 'coal_1', organizationId: 'org_test_donations' }),
    });
    await prisma.campaign.create({
      data: campaignFactory({
        id: 'camp_1',
        coalitionId: 'coal_1',
        organizationId: 'org_test_donations',
        status: 'ACTIVE',
      }),
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('404 on cancelling another user\'s donation', async () => {
    const donation = await prisma.donation.create({
      data: donationFactory({
        userId: 'user_other',
        campaignId: 'camp_1',
        organizationId: 'org_test_donations',
        mode: 'RECURRING',
        status: 'ACTIVE',
        stripeSubscriptionId: 'sub_other',
      }),
    });
    const res = await request(app.getHttpServer())
      .post(`/billing/donation/${donation.id}/cancel`);
    expect(res.status).toBe(404);
  });

  it('200 + flips status to CANCELED on the donor\'s own ACTIVE recurring donation', async () => {
    const subId = 'sub_self';
    fakeStripe.seedSubscription({
      id: subId,
      customer: 'cus_test_1',
      status: 'active',
      cancel_at_period_end: false,
      items: { data: [] },
    });
    const donation = await prisma.donation.create({
      data: donationFactory({
        userId: USER,
        campaignId: 'camp_1',
        organizationId: 'org_test_donations',
        mode: 'RECURRING',
        status: 'ACTIVE',
        stripeSubscriptionId: subId,
      }),
    });
    const res = await request(app.getHttpServer())
      .post(`/billing/donation/${donation.id}/cancel`);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ status: 'canceled' });

    const after = await prisma.donation.findUnique({ where: { id: donation.id } });
    expect(after?.status).toBe('CANCELED');
    expect(after?.canceledAt).toBeTruthy();
  });
});

describe('GET /donations/mine', () => {
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
    await prisma.donation.deleteMany({});
    await prisma.campaign.deleteMany({});
    await prisma.coalition.deleteMany({});
    fakeStripe.reset();
    holder.value = USER;

    // Seed both the route's resolved org (HOUSE_ORG_ID, via the middleware
    // GET fallback) and the donations' own organizationId so the
    // feature-flag guard passes regardless of which row the middleware reads.
    await prisma.organization.upsert({
      where: { id: HOUSE_ORG_ID },
      update: { donationsEnabled: true },
      create: { id: HOUSE_ORG_ID, name: 'House', slug: 'house', createdBy: 'seed', donationsEnabled: true },
    });
    await prisma.organization.upsert({
      where: { id: 'org_test_donations' },
      update: { donationsEnabled: true },
      create: { id: 'org_test_donations', name: 'Test Org', slug: 'org-test-donations', createdBy: 'user-test', donationsEnabled: true },
    });
    await prisma.coalition.create({
      data: coalitionFactory({ id: 'coal_1', organizationId: 'org_test_donations' }),
    });
    await prisma.campaign.create({
      data: campaignFactory({ id: 'camp_1', coalitionId: 'coal_1', organizationId: 'org_test_donations', status: 'ACTIVE' }),
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns only the current user\'s donations, newest first', async () => {
    // Explicit createdAt values prevent same-millisecond races; donationFactory
    // uses Math.random() ids so the orderBy tie-breaker can't recover order.
    await prisma.donation.create({
      data: donationFactory({
        userId: USER, campaignId: 'camp_1', organizationId: 'org_test_donations',
        mode: 'ONE_TIME', cadence: 'ONCE', status: 'COMPLETED',
        createdAt: new Date('2025-01-01T12:00:00.000Z'),
      }),
    });
    await prisma.donation.create({
      data: donationFactory({
        userId: USER, campaignId: 'camp_1', organizationId: 'org_test_donations',
        mode: 'RECURRING', cadence: 'MONTHLY', status: 'ACTIVE',
        createdAt: new Date('2025-01-02T12:00:00.000Z'),
      }),
    });
    await prisma.donation.create({
      data: donationFactory({
        userId: 'user_other', campaignId: 'camp_1', organizationId: 'org_test_donations',
        mode: 'RECURRING', cadence: 'MONTHLY', status: 'ACTIVE',
      }),
    });

    const res = await request(app.getHttpServer()).get('/donations/mine');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body.every((d: { userId: string }) => d.userId === USER)).toBe(true);
    // Recurring was created after one-time; should appear first.
    expect(res.body[0].mode).toBe('RECURRING');
    expect(res.body[1].mode).toBe('ONE_TIME');
  });

  it('filters by ?mode=RECURRING', async () => {
    await prisma.donation.create({
      data: donationFactory({
        userId: USER, campaignId: 'camp_1', organizationId: 'org_test_donations',
        mode: 'ONE_TIME', cadence: 'ONCE', status: 'COMPLETED',
      }),
    });
    await prisma.donation.create({
      data: donationFactory({
        userId: USER, campaignId: 'camp_1', organizationId: 'org_test_donations',
        mode: 'RECURRING', cadence: 'MONTHLY', status: 'ACTIVE',
      }),
    });

    const res = await request(app.getHttpServer()).get('/donations/mine?mode=RECURRING');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].mode).toBe('RECURRING');
  });

  it('embeds campaign + coalition context for list rendering', async () => {
    await prisma.donation.create({
      data: donationFactory({
        userId: USER, campaignId: 'camp_1', organizationId: 'org_test_donations',
        mode: 'ONE_TIME', cadence: 'ONCE', status: 'COMPLETED',
      }),
    });

    const res = await request(app.getHttpServer()).get('/donations/mine');
    expect(res.status).toBe(200);
    expect(res.body[0].campaign).toMatchObject({
      id: 'camp_1',
      slug: expect.any(String),
      name: expect.any(String),
      coalition: { id: 'coal_1', slug: expect.any(String), name: expect.any(String) },
    });
  });

  it('filters by ?status=ACTIVE', async () => {
    await prisma.donation.create({
      data: donationFactory({
        userId: USER, campaignId: 'camp_1', organizationId: 'org_test_donations',
        mode: 'RECURRING', cadence: 'MONTHLY', status: 'ACTIVE',
        stripeSubscriptionId: 'sub_mine_active_1',
      }),
    });
    await prisma.donation.create({
      data: donationFactory({
        userId: USER, campaignId: 'camp_1', organizationId: 'org_test_donations',
        mode: 'RECURRING', cadence: 'MONTHLY', status: 'CANCELED',
        stripeSubscriptionId: 'sub_mine_canceled_1',
        canceledAt: new Date('2025-01-01T00:00:00Z'),
      }),
    });

    const res = await request(app.getHttpServer()).get('/donations/mine?status=ACTIVE');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].status).toBe('ACTIVE');
  });

  it('?mode=RECURRING filter still works after the DTO refactor', async () => {
    await prisma.donation.create({
      data: donationFactory({
        userId: USER, campaignId: 'camp_1', organizationId: 'org_test_donations',
        mode: 'ONE_TIME', cadence: 'ONCE', status: 'COMPLETED',
      }),
    });
    await prisma.donation.create({
      data: donationFactory({
        userId: USER, campaignId: 'camp_1', organizationId: 'org_test_donations',
        mode: 'RECURRING', cadence: 'MONTHLY', status: 'ACTIVE',
        stripeSubscriptionId: 'sub_mine_recurring_mode_1',
      }),
    });

    const res = await request(app.getHttpServer()).get('/donations/mine?mode=RECURRING');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].mode).toBe('RECURRING');
  });

  it('400s on unknown query field (forbidNonWhitelisted)', async () => {
    const res = await request(app.getHttpServer()).get('/donations/mine?unknownField=foo');
    expect(res.status).toBe(400);
  });

  it('400s on invalid mode', async () => {
    const res = await request(app.getHttpServer()).get('/donations/mine?mode=BOGUS');
    expect(res.status).toBe(400);
  });

  it('returns [] when the user has no donations', async () => {
    const res = await request(app.getHttpServer()).get('/donations/mine');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('404 when donationsEnabled is off on HOUSE_ORG_ID', async () => {
    await prisma.organization.update({
      where: { id: HOUSE_ORG_ID },
      data: { donationsEnabled: false },
    });
    const res = await request(app.getHttpServer()).get('/donations/mine');
    expect(res.status).toBe(404);
  });
});
