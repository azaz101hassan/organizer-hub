import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import request from 'supertest';
import { PrismaService } from './../src/prisma/prisma.service';
import { bootTestApp, makeSubHolder, stubJwtAuthGuard } from './helpers/boot-test-app';
import { coalitionFactory, campaignFactory, donationFactory } from './factories';
import { HOUSE_ORG_ID } from '../src/common/house-org';

describe('GET /coalitions (public list)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const holder = makeSubHolder('user-coalitions-public');
    ({ app, prisma } = await bootTestApp(stubJwtAuthGuard(holder), []));
  });

  beforeEach(async () => {
    await prisma.paymentEvent.deleteMany({});
    await prisma.donation.deleteMany({});
    await prisma.campaign.deleteMany({});
    await prisma.coalition.deleteMany({});
    await prisma.organization.upsert({
      where: { id: HOUSE_ORG_ID },
      update: { donationsEnabled: true },
      create: {
        id: HOUSE_ORG_ID,
        name: 'House Org',
        slug: 'house-org',
        createdBy: 'seed',
        donationsEnabled: true,
      },
    });
    // ACTIVE coalition
    await prisma.coalition.create({
      data: coalitionFactory({
        id: 'coal_pub_active',
        organizationId: HOUSE_ORG_ID,
        slug: 'a',
        name: 'Active Coalition',
        status: 'ACTIVE',
      }),
    });
    // ARCHIVED coalition — must not appear in list
    await prisma.coalition.create({
      data: coalitionFactory({
        id: 'coal_pub_archived',
        organizationId: HOUSE_ORG_ID,
        slug: 'b',
        name: 'Archived Coalition',
        status: 'ARCHIVED',
      }),
    });
    // One ACTIVE campaign under the ACTIVE coalition
    await prisma.campaign.create({
      data: campaignFactory({
        id: 'camp_pub_c1',
        organizationId: HOUSE_ORG_ID,
        coalitionId: 'coal_pub_active',
        slug: 'c1',
        name: 'Campaign One',
        status: 'ACTIVE',
      }),
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 with only the ACTIVE coalition and expected shape', async () => {
    const res = await request(app.getHttpServer()).get('/coalitions');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    const item = res.body[0];
    expect(item).toMatchObject({
      id: 'coal_pub_active',
      slug: 'a',
      name: 'Active Coalition',
      coverImageUrl: null,
      childCampaignCount: expect.any(Number),
      totalRaisedCents: expect.any(Number),
    });
    expect('description' in item).toBe(true);
  });

  it('excludes ARCHIVED coalitions from list', async () => {
    const res = await request(app.getHttpServer()).get('/coalitions');

    expect(res.status).toBe(200);
    const ids = (res.body as any[]).map((c: any) => c.id);
    expect(ids).not.toContain('coal_pub_archived');
  });

  it('childCampaignCount equals number of campaigns, not number of payment-event rows', async () => {
    // Seed a second ACTIVE campaign in the same coalition.
    await prisma.campaign.create({
      data: campaignFactory({
        id: 'camp_pub_c2',
        organizationId: HOUSE_ORG_ID,
        coalitionId: 'coal_pub_active',
        slug: 'c2',
        name: 'Campaign Two',
        status: 'ACTIVE',
      }),
    });

    // Create 1 donation on each campaign, each donation has 3 SUCCEEDED PaymentEvents.
    // Total join-expansion factor: 2 campaigns × 3 events = 6 rows if COUNT is not DISTINCT.
    const amountCents = 1000;
    for (const { donId, campId } of [
      { donId: 'don_c1_explode', campId: 'camp_pub_c1' },
      { donId: 'don_c2_explode', campId: 'camp_pub_c2' },
    ]) {
      await prisma.donation.create({
        data: donationFactory({
          id: donId,
          userId: 'user_explode',
          campaignId: campId,
          organizationId: HOUSE_ORG_ID,
          mode: 'ONE_TIME',
          status: 'COMPLETED',
          amountCents,
        }),
      });
      for (let i = 0; i < 3; i++) {
        await prisma.paymentEvent.create({
          data: {
            organizationId: HOUSE_ORG_ID,
            userId: 'user_explode',
            kind: 'DONATION',
            status: 'SUCCEEDED',
            amountCents,
            currency: 'usd',
            donationId: donId,
            stripePaymentIntentId: `pi_explode_${donId}_${i}`,
            stripeInvoiceId: `inv_explode_${donId}_${i}`,
            stripeChargeId: `ch_explode_${donId}_${i}`,
            succeededAt: new Date(),
          },
        });
      }
    }

    const res = await request(app.getHttpServer()).get('/coalitions');

    expect(res.status).toBe(200);
    const item = res.body.find((c: any) => c.id === 'coal_pub_active');
    // 2 distinct campaigns — must NOT be 6 (the join-explosion factor)
    expect(item.childCampaignCount).toBe(2);
    // 2 donations × 3 payment events × 1000 = 6000
    expect(item.totalRaisedCents).toBe(6000);
  });
});

describe('GET /coalitions/:slug (public detail)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const holder = makeSubHolder('user-coalitions-detail');
    ({ app, prisma } = await bootTestApp(stubJwtAuthGuard(holder), []));
  });

  beforeEach(async () => {
    await prisma.paymentEvent.deleteMany({});
    await prisma.donation.deleteMany({});
    await prisma.campaign.deleteMany({});
    await prisma.coalition.deleteMany({});
    await prisma.organization.upsert({
      where: { id: HOUSE_ORG_ID },
      update: { donationsEnabled: true },
      create: {
        id: HOUSE_ORG_ID,
        name: 'House Org',
        slug: 'house-org',
        createdBy: 'seed',
        donationsEnabled: true,
      },
    });
    // ACTIVE coalition
    await prisma.coalition.create({
      data: coalitionFactory({
        id: 'coal_pub_active',
        organizationId: HOUSE_ORG_ID,
        slug: 'a',
        name: 'Active Coalition',
        status: 'ACTIVE',
      }),
    });
    // ARCHIVED coalition — 404 on direct slug access
    await prisma.coalition.create({
      data: coalitionFactory({
        id: 'coal_pub_archived',
        organizationId: HOUSE_ORG_ID,
        slug: 'b',
        name: 'Archived Coalition',
        status: 'ARCHIVED',
      }),
    });
    // One ACTIVE campaign under the ACTIVE coalition
    await prisma.campaign.create({
      data: campaignFactory({
        id: 'camp_pub_c1',
        organizationId: HOUSE_ORG_ID,
        coalitionId: 'coal_pub_active',
        slug: 'c1',
        name: 'Campaign One',
        status: 'ACTIVE',
      }),
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 404 on an ARCHIVED slug', async () => {
    const res = await request(app.getHttpServer()).get('/coalitions/b');
    expect(res.status).toBe(404);
  });

  it('returns 404 on a slug that does not exist', async () => {
    const res = await request(app.getHttpServer()).get('/coalitions/no-such-slug');
    expect(res.status).toBe(404);
  });

  it('returns 200 with coalition + campaigns for a real ACTIVE coalition', async () => {
    const res = await request(app.getHttpServer()).get('/coalitions/a');

    expect(res.status).toBe(200);
    expect(res.body.coalition).toMatchObject({
      id: 'coal_pub_active',
      slug: 'a',
      name: 'Active Coalition',
      childCampaignCount: 1,
      totalRaisedCents: 0,
    });
    expect(res.body.campaigns).toHaveLength(1);
    expect(res.body.campaigns[0]).toMatchObject({
      id: 'camp_pub_c1',
      slug: 'c1',
      name: 'Campaign One',
      raisedCents: 0,
      donorCount: 0,
      status: 'ACTIVE',
    });
  });

  it('counts a canceled-recurring donor toward donorCount (symmetric with raisedCents)', async () => {
    // u1: donated and later canceled — donation status CANCELED, but their
    // PaymentEvent is SUCCEEDED and should still count toward donorCount.
    const don1 = await prisma.donation.create({
      data: donationFactory({
        id: 'don_canceled_u1',
        userId: 'u1_canceled',
        campaignId: 'camp_pub_c1',
        organizationId: HOUSE_ORG_ID,
        mode: 'RECURRING',
        status: 'CANCELED',
        amountCents: 5000,
      }),
    });
    await prisma.paymentEvent.create({
      data: {
        organizationId: HOUSE_ORG_ID,
        userId: 'u1_canceled',
        kind: 'DONATION',
        status: 'SUCCEEDED',
        amountCents: 5000,
        currency: 'usd',
        donationId: don1.id,
        stripePaymentIntentId: `pi_canceled_u1`,
        stripeInvoiceId: `inv_canceled_u1`,
        stripeChargeId: `ch_canceled_u1`,
        succeededAt: new Date(),
      },
    });

    // u2: currently ACTIVE donor
    const don2 = await prisma.donation.create({
      data: donationFactory({
        id: 'don_active_u2',
        userId: 'u2_active',
        campaignId: 'camp_pub_c1',
        organizationId: HOUSE_ORG_ID,
        mode: 'RECURRING',
        status: 'ACTIVE',
        amountCents: 5000,
      }),
    });
    await prisma.paymentEvent.create({
      data: {
        organizationId: HOUSE_ORG_ID,
        userId: 'u2_active',
        kind: 'DONATION',
        status: 'SUCCEEDED',
        amountCents: 5000,
        currency: 'usd',
        donationId: don2.id,
        stripePaymentIntentId: `pi_active_u2`,
        stripeInvoiceId: `inv_active_u2`,
        stripeChargeId: `ch_active_u2`,
        succeededAt: new Date(),
      },
    });

    const res = await request(app.getHttpServer()).get('/coalitions/a');

    expect(res.status).toBe(200);
    const summary = res.body.campaigns.find((c: any) => c.id === 'camp_pub_c1');
    // Both users must count — u1 was canceled but still paid
    expect(summary.donorCount).toBe(2);
    expect(summary.raisedCents).toBe(10000);
  });
});
