import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import request from 'supertest';
import { PrismaService } from './../src/prisma/prisma.service';
import { bootTestApp, makeSubHolder, stubJwtAuthGuard } from './helpers/boot-test-app';
import { coalitionFactory, campaignFactory } from './factories';
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

  it('returns 404 when donationsEnabled=false on the org', async () => {
    await prisma.organization.update({
      where: { id: HOUSE_ORG_ID },
      data: { donationsEnabled: false },
    });

    const res = await request(app.getHttpServer()).get('/coalitions');
    expect(res.status).toBe(404);
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

  it('returns 404 when donationsEnabled=false on the org', async () => {
    await prisma.organization.update({
      where: { id: HOUSE_ORG_ID },
      data: { donationsEnabled: false },
    });

    const res = await request(app.getHttpServer()).get('/coalitions/a');
    expect(res.status).toBe(404);
  });
});
