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
import { campaignFactory, coalitionFactory } from './factories';

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
});
