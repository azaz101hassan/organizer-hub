import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { OrganizationRole } from '@organizer-hub/db/api';
import { PrismaService } from './../src/prisma/prisma.service';
import {
  bootTestApp,
  makeSubHolder,
  stubJwtAuthGuard,
  type SubHolder,
} from './helpers/boot-test-app';
import { campaignFactory, coalitionFactory } from './factories';

const ADMIN_USER = 'admin-coal-1';
const ORG_ID = 'org_admin_coal_test';

describe('Admin coalitions API', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let holder: SubHolder;
  let coalitionId: string;
  let campaignId: string;

  beforeAll(async () => {
    holder = makeSubHolder(ADMIN_USER);
    ({ app, prisma } = await bootTestApp(stubJwtAuthGuard(holder)));
  });

  beforeEach(async () => {
    // Tear down in FK-safe order
    await prisma.donation.deleteMany({});
    await prisma.campaign.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.coalition.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.organizationMember.deleteMany({ where: { organizationId: ORG_ID } });

    holder.value = ADMIN_USER;

    await prisma.organization.upsert({
      where: { id: ORG_ID },
      update: { donationsEnabled: true },
      create: {
        id: ORG_ID,
        name: 'Coal Test Org',
        slug: 'coal-test-org',
        createdBy: 'seed',
        donationsEnabled: true,
      },
    });

    // Bind test user as OWNER so RolesGuard passes
    await prisma.organizationMember.create({
      data: { organizationId: ORG_ID, userId: ADMIN_USER, role: OrganizationRole.OWNER },
    });

    const coalition = await prisma.coalition.create({
      data: coalitionFactory({
        id: 'coal_admin_1',
        organizationId: ORG_ID,
        slug: 'test-coalition',
        name: 'Test Coalition',
        status: 'ACTIVE',
      }),
    });
    coalitionId = coalition.id;

    const campaign = await prisma.campaign.create({
      data: campaignFactory({
        id: 'camp_admin_1',
        organizationId: ORG_ID,
        coalitionId: coalitionId,
        slug: 'test-campaign',
        name: 'Test Campaign',
        status: 'ACTIVE',
      }),
    });
    campaignId = campaign.id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /orgs/:orgId/coalitions', () => {
    it('returns 200 with a list including the seeded coalition', async () => {
      const res = await request(app.getHttpServer())
        .get(`/orgs/${ORG_ID}/coalitions`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      const ids = (res.body as { id: string }[]).map((c) => c.id);
      expect(ids).toContain(coalitionId);
    });
  });

  describe('POST /orgs/:orgId/coalitions', () => {
    it('returns 201 with the created coalition row', async () => {
      const res = await request(app.getHttpServer())
        .post(`/orgs/${ORG_ID}/coalitions`)
        .send({
          name: 'New Coalition',
          slug: 'new-coalition',
          description: 'A brand new coalition',
          displayOrder: 5,
        })
        .expect(201);

      expect(res.body).toMatchObject({
        id: expect.any(String),
        name: 'New Coalition',
        slug: 'new-coalition',
        description: 'A brand new coalition',
        status: 'ACTIVE',
        displayOrder: 5,
      });
    });

    it('returns 400 when name is missing', async () => {
      await request(app.getHttpServer())
        .post(`/orgs/${ORG_ID}/coalitions`)
        .send({ slug: 'no-name' })
        .expect(400);
    });

    it('returns 400 when slug contains uppercase letters', async () => {
      await request(app.getHttpServer())
        .post(`/orgs/${ORG_ID}/coalitions`)
        .send({ name: 'Bad Slug', slug: 'Bad-Slug' })
        .expect(400);
    });
  });

  describe('GET /orgs/:orgId/coalitions/:id', () => {
    it('returns 200 with the coalition row', async () => {
      const res = await request(app.getHttpServer())
        .get(`/orgs/${ORG_ID}/coalitions/${coalitionId}`)
        .expect(200);

      expect(res.body).toMatchObject({
        id: coalitionId,
        name: 'Test Coalition',
        slug: 'test-coalition',
      });
    });

    it('returns 404 for an unknown id', async () => {
      await request(app.getHttpServer())
        .get(`/orgs/${ORG_ID}/coalitions/nonexistent_id`)
        .expect(404);
    });
  });

  describe('PATCH /orgs/:orgId/coalitions/:id', () => {
    it('returns 200 with the updated coalition', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/orgs/${ORG_ID}/coalitions/${coalitionId}`)
        .send({ name: 'Renamed Coalition', displayOrder: 2 })
        .expect(200);

      expect(res.body).toMatchObject({ name: 'Renamed Coalition', displayOrder: 2 });
    });

    it('returns 400 when status is sent (status must go via archive route)', async () => {
      await request(app.getHttpServer())
        .patch(`/orgs/${ORG_ID}/coalitions/${coalitionId}`)
        .send({ status: 'ARCHIVED' })
        .expect(400);
    });
  });

  describe('POST /orgs/:orgId/coalitions/:id/archive', () => {
    it('returns 409 when the coalition has an ACTIVE campaign', async () => {
      await request(app.getHttpServer())
        .post(`/orgs/${ORG_ID}/coalitions/${coalitionId}/archive`)
        .expect(409);
    });

    it('returns 200 with status=ARCHIVED after all campaigns are archived', async () => {
      // Move the blocking campaign out of ACTIVE
      await prisma.campaign.update({
        where: { id: campaignId },
        data: { status: 'ARCHIVED' },
      });

      const res = await request(app.getHttpServer())
        .post(`/orgs/${ORG_ID}/coalitions/${coalitionId}/archive`)
        .expect(200);

      expect(res.body).toMatchObject({ id: coalitionId, status: 'ARCHIVED' });
    });
  });

  describe('slug uniqueness', () => {
    it('returns 409 when creating a coalition with a slug that already exists', async () => {
      await request(app.getHttpServer())
        .post(`/orgs/${ORG_ID}/coalitions`)
        .send({ name: 'Dup', slug: 'test-coalition' })
        .expect(409);
    });

    it('returns 409 when renaming a coalition slug to one that already exists', async () => {
      // Seed a second coalition with a known slug
      await prisma.coalition.create({
        data: coalitionFactory({
          id: 'coal_admin_2',
          organizationId: ORG_ID,
          slug: 'sibling-coalition',
          name: 'Sibling Coalition',
          status: 'ACTIVE',
        }),
      });

      await request(app.getHttpServer())
        .patch(`/orgs/${ORG_ID}/coalitions/${coalitionId}`)
        .send({ slug: 'sibling-coalition' })
        .expect(409);
    });
  });

  describe('authorization', () => {
    afterEach(() => {
      holder.value = ADMIN_USER;
    });

    it('returns 404 for a non-member user', async () => {
      holder.value = 'stranger-user';
      await request(app.getHttpServer())
        .get(`/orgs/${ORG_ID}/coalitions`)
        .expect(404);
    });

    it('returns 404 when a member of org A reads a coalition from org B (cross-org IDOR)', async () => {
      const OTHER_ORG = 'org_admin_coal_other';
      const OTHER_USER = 'admin-coal-other-1';

      // Seed a foreign org with a coalition; the test user is NOT a member.
      await prisma.organization.upsert({
        where: { id: OTHER_ORG },
        update: { donationsEnabled: true },
        create: {
          id: OTHER_ORG,
          name: 'Other Org',
          slug: 'other-org',
          createdBy: 'seed',
          donationsEnabled: true,
        },
      });
      await prisma.organizationMember.upsert({
        where: {
          organizationId_userId: {
            organizationId: OTHER_ORG,
            userId: OTHER_USER,
          },
        },
        update: {},
        create: {
          organizationId: OTHER_ORG,
          userId: OTHER_USER,
          role: OrganizationRole.OWNER,
        },
      });
      const foreign = await prisma.coalition.create({
        data: coalitionFactory({
          id: 'coal_foreign_1',
          organizationId: OTHER_ORG,
          slug: 'foreign-coalition',
          name: 'Foreign Coalition',
          status: 'ACTIVE',
        }),
      });

      // ADMIN_USER is OWNER of ORG_ID but NOT of OTHER_ORG. Pointing the URL at
      // ORG_ID but the coalition id at the foreign row must return 404 — the
      // service-level org-match check is the IDOR firewall.
      await request(app.getHttpServer())
        .get(`/orgs/${ORG_ID}/coalitions/${foreign.id}`)
        .expect(404);

      await request(app.getHttpServer())
        .patch(`/orgs/${ORG_ID}/coalitions/${foreign.id}`)
        .send({ name: 'Hijacked' })
        .expect(404);

      await request(app.getHttpServer())
        .post(`/orgs/${ORG_ID}/coalitions/${foreign.id}/archive`)
        .expect(404);

      // Cleanup so other tests don't trip on leftover foreign rows.
      await prisma.coalition.delete({ where: { id: foreign.id } });
      await prisma.organizationMember.delete({
        where: {
          organizationId_userId: {
            organizationId: OTHER_ORG,
            userId: OTHER_USER,
          },
        },
      });
      await prisma.organization.delete({ where: { id: OTHER_ORG } });
    });
  });
});
