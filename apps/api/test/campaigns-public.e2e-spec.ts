import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import request from 'supertest';
import { PrismaService } from './../src/prisma/prisma.service';
import { bootTestApp, makeSubHolder, stubJwtAuthGuard } from './helpers/boot-test-app';
import { coalitionFactory, campaignFactory, donationFactory } from './factories';
import { HOUSE_ORG_ID } from '../src/common/house-org';

describe('GET /campaigns/:slug (public detail)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const holder = makeSubHolder('user-campaigns-public');
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
    await prisma.coalition.create({
      data: coalitionFactory({
        id: 'coal_pub_active',
        organizationId: HOUSE_ORG_ID,
        slug: 'a',
        name: 'Active Coalition',
        status: 'ACTIVE',
      }),
    });
    await prisma.campaign.create({
      data: campaignFactory({
        id: 'camp_pub_1',
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

  it('returns campaign + coalition context with raisedCents=0 when no donations', async () => {
    const res = await request(app.getHttpServer()).get('/campaigns/c1');

    expect(res.status).toBe(200);
    expect(res.body.campaign).toMatchObject({
      id: 'camp_pub_1',
      slug: 'c1',
      name: 'Campaign One',
      raisedCents: 0,
      donorCount: 0,
      recentGiftCount: 0,
    });
    expect(res.body.coalition).toMatchObject({
      id: 'coal_pub_active',
      slug: 'a',
      name: 'Active Coalition',
    });
  });

  it('returns 404 on DRAFT status', async () => {
    await prisma.campaign.update({
      where: { id: 'camp_pub_1' },
      data: { status: 'DRAFT' },
    });

    const res = await request(app.getHttpServer()).get('/campaigns/c1');
    expect(res.status).toBe(404);
  });

  it('returns 404 on ARCHIVED status', async () => {
    await prisma.campaign.update({
      where: { id: 'camp_pub_1' },
      data: { status: 'ARCHIVED' },
    });

    const res = await request(app.getHttpServer()).get('/campaigns/c1');
    expect(res.status).toBe(404);
  });

  it('returns 404 on missing slug', async () => {
    const res = await request(app.getHttpServer()).get('/campaigns/does-not-exist');
    expect(res.status).toBe(404);
  });

  it('returns 200 on COMPLETE status (past goals stay visible)', async () => {
    await prisma.campaign.update({
      where: { id: 'camp_pub_1' },
      data: { status: 'COMPLETE' },
    });

    const res = await request(app.getHttpServer()).get('/campaigns/c1');

    expect(res.status).toBe(200);
    expect(res.body.campaign).toMatchObject({
      id: 'camp_pub_1',
      slug: 'c1',
      status: 'COMPLETE',
    });
    expect(res.body.coalition).toMatchObject({
      id: 'coal_pub_active',
      slug: 'a',
    });
  });

  it('raisedCents nets a refund to zero; donorCount stays 1 for the refunded donor', async () => {
    const don = await prisma.donation.create({
      data: donationFactory({
        id: 'don_refund_test',
        userId: 'u_refunded',
        campaignId: 'camp_pub_1',
        organizationId: HOUSE_ORG_ID,
        mode: 'ONE_TIME',
        status: 'COMPLETED',
        amountCents: 5000,
      }),
    });

    // DONATION PaymentEvent: +5000
    await prisma.paymentEvent.create({
      data: {
        organizationId: HOUSE_ORG_ID,
        userId: 'u_refunded',
        kind: 'DONATION',
        status: 'SUCCEEDED',
        amountCents: 5000,
        currency: 'usd',
        donationId: don.id,
        stripePaymentIntentId: 'pi_refund_test_charge',
        succeededAt: new Date(),
      },
    });

    // REFUND PaymentEvent: -5000 (nets the total to 0)
    await prisma.paymentEvent.create({
      data: {
        organizationId: HOUSE_ORG_ID,
        userId: 'u_refunded',
        kind: 'REFUND',
        status: 'SUCCEEDED',
        amountCents: -5000,
        currency: 'usd',
        donationId: don.id,
        stripeRefundId: 're_refund_test',
        stripePaymentIntentId: 'pi_refund_test_charge',
        succeededAt: new Date(),
      },
    });

    const res = await request(app.getHttpServer()).get('/campaigns/c1');

    expect(res.status).toBe(200);
    expect(res.body.campaign.raisedCents).toBe(0);
    // Donor still has a SUCCEEDED PaymentEvent — they remain visible
    expect(res.body.campaign.donorCount).toBe(1);
  });

  it('donorCount counts a canceled donor alongside an active one', async () => {
    // u_canceled: donation CANCELED but PaymentEvent SUCCEEDED
    const donCanceled = await prisma.donation.create({
      data: donationFactory({
        id: 'don_canceled_u',
        userId: 'u_canceled',
        campaignId: 'camp_pub_1',
        organizationId: HOUSE_ORG_ID,
        mode: 'RECURRING',
        status: 'CANCELED',
        amountCents: 5000,
      }),
    });
    await prisma.paymentEvent.create({
      data: {
        organizationId: HOUSE_ORG_ID,
        userId: 'u_canceled',
        kind: 'DONATION',
        status: 'SUCCEEDED',
        amountCents: 5000,
        currency: 'usd',
        donationId: donCanceled.id,
        stripePaymentIntentId: 'pi_canceled_u',
        succeededAt: new Date(),
      },
    });

    // u_active: donation ACTIVE + SUCCEEDED PaymentEvent
    const donActive = await prisma.donation.create({
      data: donationFactory({
        id: 'don_active_u',
        userId: 'u_active',
        campaignId: 'camp_pub_1',
        organizationId: HOUSE_ORG_ID,
        mode: 'RECURRING',
        status: 'ACTIVE',
        amountCents: 5000,
      }),
    });
    await prisma.paymentEvent.create({
      data: {
        organizationId: HOUSE_ORG_ID,
        userId: 'u_active',
        kind: 'DONATION',
        status: 'SUCCEEDED',
        amountCents: 5000,
        currency: 'usd',
        donationId: donActive.id,
        stripePaymentIntentId: 'pi_active_u',
        succeededAt: new Date(),
      },
    });

    const res = await request(app.getHttpServer()).get('/campaigns/c1');

    expect(res.status).toBe(200);
    // Both users count: canceled donor's money is counted, their support is too
    expect(res.body.campaign.donorCount).toBe(2);
    expect(res.body.campaign.raisedCents).toBe(10000);
  });

  it('recentGiftCount counts only DONATION-kind SUCCEEDED events within 30 days', async () => {
    const don = await prisma.donation.create({
      data: donationFactory({
        id: 'don_recent_test',
        userId: 'u_recent',
        campaignId: 'camp_pub_1',
        organizationId: HOUSE_ORG_ID,
        mode: 'ONE_TIME',
        status: 'COMPLETED',
        amountCents: 1000,
      }),
    });

    // Recent DONATION — within 30 days (should count)
    await prisma.paymentEvent.create({
      data: {
        organizationId: HOUSE_ORG_ID,
        userId: 'u_recent',
        kind: 'DONATION',
        status: 'SUCCEEDED',
        amountCents: 1000,
        currency: 'usd',
        donationId: don.id,
        stripePaymentIntentId: 'pi_recent_donation',
        succeededAt: new Date(),
      },
    });

    // Old DONATION — 31 days ago (outside window, should NOT count)
    await prisma.paymentEvent.create({
      data: {
        organizationId: HOUSE_ORG_ID,
        userId: 'u_recent',
        kind: 'DONATION',
        status: 'SUCCEEDED',
        amountCents: 1000,
        currency: 'usd',
        donationId: don.id,
        stripePaymentIntentId: 'pi_old_donation',
        succeededAt: new Date(Date.now() - 31 * 86_400_000),
      },
    });

    // Recent REFUND — within 30 days but kind=REFUND (should NOT count)
    await prisma.paymentEvent.create({
      data: {
        organizationId: HOUSE_ORG_ID,
        userId: 'u_recent',
        kind: 'REFUND',
        status: 'SUCCEEDED',
        amountCents: -1000,
        currency: 'usd',
        donationId: don.id,
        stripeRefundId: 're_recent_refund',
        stripePaymentIntentId: 'pi_recent_donation',
        succeededAt: new Date(),
      },
    });

    const res = await request(app.getHttpServer()).get('/campaigns/c1');

    expect(res.status).toBe(200);
    // Only the recent DONATION-kind event counts
    expect(res.body.campaign.recentGiftCount).toBe(1);
  });

});
