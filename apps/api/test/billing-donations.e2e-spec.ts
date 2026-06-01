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
    await prisma.billingCustomer.deleteMany({ where: { userId: USER } });
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
