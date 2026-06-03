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

interface PageBody<T> {
  items: T[];
  nextCursor: string | null;
}

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
    await prisma.organizationMember.deleteMany({
      where: { organizationId: ORG_ID },
    });

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
      data: {
        organizationId: ORG_ID,
        userId: ADMIN_USER,
        role: OrganizationRole.OWNER,
      },
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
    it('returns 200 with paginated shape including the seeded coalition', async () => {
      const res = await request(app.getHttpServer())
        .get(`/orgs/${ORG_ID}/coalitions`)
        .expect(200);

      const body = res.body as PageBody<{ id: string }>;
      expect(body).toHaveProperty('items');
      expect(body).toHaveProperty('nextCursor');
      expect(Array.isArray(body.items)).toBe(true);
      const ids = body.items.map((c) => c.id);
      expect(ids).toContain(coalitionId);
    });
  });

  describe('server-side filters', () => {
    it('?status=ARCHIVED returns only ARCHIVED coalitions', async () => {
      // Archive the seeded coalition so we have one ARCHIVED row.
      await prisma.campaign.update({
        where: { id: campaignId },
        data: { status: 'ARCHIVED' },
      });
      await request(app.getHttpServer())
        .post(`/orgs/${ORG_ID}/coalitions/${coalitionId}/archive`)
        .expect(200);

      const res = await request(app.getHttpServer())
        .get(`/orgs/${ORG_ID}/coalitions?status=ARCHIVED`)
        .expect(200);

      const body = res.body as PageBody<{ id: string; status: string }>;
      expect(body.items.length).toBeGreaterThan(0);
      expect(body.items.every((c) => c.status === 'ARCHIVED')).toBe(true);
    });

    it('?status=ACTIVE returns only ACTIVE coalitions', async () => {
      const res = await request(app.getHttpServer())
        .get(`/orgs/${ORG_ID}/coalitions?status=ACTIVE`)
        .expect(200);

      const body = res.body as PageBody<{ id: string; status: string }>;
      expect(body.items.length).toBeGreaterThan(0);
      expect(body.items.every((c) => c.status === 'ACTIVE')).toBe(true);
    });

    it('?q=substring returns matching coalitions (case-insensitive)', async () => {
      await prisma.coalition.create({
        data: coalitionFactory({
          id: 'coal_search_1',
          organizationId: ORG_ID,
          slug: 'searchable-coalition',
          name: 'Searchable Coalition Alpha',
          status: 'ACTIVE',
        }),
      });

      const res = await request(app.getHttpServer())
        .get(`/orgs/${ORG_ID}/coalitions?q=searchable`)
        .expect(200);

      const body = res.body as PageBody<{ id: string; name: string }>;
      expect(body.items.length).toBeGreaterThan(0);
      const ids = body.items.map((c) => c.id);
      expect(ids).toContain('coal_search_1');
      // The seeded "Test Coalition" must not appear.
      expect(ids).not.toContain(coalitionId);

      await prisma.coalition.delete({ where: { id: 'coal_search_1' } });
    });

    it('filter ?status=ARCHIVED + cursor paginates filtered results consistently', async () => {
      // Archive the blocking campaign so the coalition can be archived.
      await prisma.campaign.update({
        where: { id: campaignId },
        data: { status: 'ARCHIVED' },
      });
      await request(app.getHttpServer())
        .post(`/orgs/${ORG_ID}/coalitions/${coalitionId}/archive`)
        .expect(200);

      // Seed 20 more ARCHIVED coalitions (1 already ARCHIVED = 21 total ARCHIVED)
      for (let i = 2; i <= 21; i++) {
        const cId = `coal_arc_flt_${String(i).padStart(3, '0')}`;
        await prisma.coalition.create({
          data: coalitionFactory({
            id: cId,
            organizationId: ORG_ID,
            slug: `archived-filter-${i}`,
            name: `Archived Filter ${String(i).padStart(3, '0')}`,
            status: 'ARCHIVED',
          }),
        });
      }

      const res1 = await request(app.getHttpServer())
        .get(`/orgs/${ORG_ID}/coalitions?status=ARCHIVED&limit=10`)
        .expect(200);

      const page1 = res1.body as PageBody<{ id: string; status: string }>;
      expect(page1.items).toHaveLength(10);
      expect(page1.items.every((c) => c.status === 'ARCHIVED')).toBe(true);
      expect(page1.nextCursor).not.toBeNull();

      const res2 = await request(app.getHttpServer())
        .get(
          `/orgs/${ORG_ID}/coalitions?status=ARCHIVED&limit=10&cursor=${page1.nextCursor}`,
        )
        .expect(200);

      const page2 = res2.body as PageBody<{ id: string; status: string }>;
      expect(page2.items.length).toBeGreaterThan(0);
      expect(page2.items.every((c) => c.status === 'ARCHIVED')).toBe(true);
    });

    it('?status=BOGUS returns 400', async () => {
      await request(app.getHttpServer())
        .get(`/orgs/${ORG_ID}/coalitions?status=BOGUS`)
        .expect(400);
    });
  });

  describe('pagination', () => {
    it('default limit 20: 25 coalitions → first page has 20 items + nextCursor', async () => {
      // Seed 24 additional coalitions (1 already seeded in beforeEach = 25 total)
      for (let i = 2; i <= 25; i++) {
        await prisma.coalition.create({
          data: coalitionFactory({
            id: `coal_pag_${String(i).padStart(3, '0')}`,
            organizationId: ORG_ID,
            slug: `pagination-coalition-${i}`,
            name: `Pagination Coalition ${String(i).padStart(3, '0')}`,
            status: 'ACTIVE',
          }),
        });
      }

      const res = await request(app.getHttpServer())
        .get(`/orgs/${ORG_ID}/coalitions`)
        .expect(200);

      const page1 = res.body as PageBody<{ id: string }>;
      expect(page1.items).toHaveLength(20);
      expect(page1.nextCursor).not.toBeNull();

      // Fetch second page using the cursor
      const res2 = await request(app.getHttpServer())
        .get(`/orgs/${ORG_ID}/coalitions?cursor=${page1.nextCursor}`)
        .expect(200);

      const page2 = res2.body as PageBody<{ id: string }>;
      expect(page2.items).toHaveLength(5);
      expect(page2.nextCursor).toBeNull();
    });

    it('limit=5: returns 5 items and a cursor from 25 coalitions', async () => {
      for (let i = 2; i <= 25; i++) {
        await prisma.coalition.create({
          data: coalitionFactory({
            id: `coal_lim_${String(i).padStart(3, '0')}`,
            organizationId: ORG_ID,
            slug: `limit-coalition-${i}`,
            name: `Limit Coalition ${String(i).padStart(3, '0')}`,
            status: 'ACTIVE',
          }),
        });
      }

      const res = await request(app.getHttpServer())
        .get(`/orgs/${ORG_ID}/coalitions?limit=5`)
        .expect(200);

      const page = res.body as PageBody<{ id: string }>;
      expect(page.items).toHaveLength(5);
      expect(page.nextCursor).not.toBeNull();
    });

    it('limit=101 returns 400', async () => {
      await request(app.getHttpServer())
        .get(`/orgs/${ORG_ID}/coalitions?limit=101`)
        .expect(400);
    });

    it('limit=0 returns 400', async () => {
      await request(app.getHttpServer())
        .get(`/orgs/${ORG_ID}/coalitions?limit=0`)
        .expect(400);
    });

    it('malformed cursor (non-existent id) returns 400', async () => {
      await request(app.getHttpServer())
        .get(`/orgs/${ORG_ID}/coalitions?cursor=nonexistent_cursor_id`)
        .expect(400);
    });

    it('cross-org cursor: cursor from org B passed to org A list returns 400', async () => {
      const OTHER_ORG = 'org_coal_cursor_idor';

      await prisma.organization.upsert({
        where: { id: OTHER_ORG },
        update: { donationsEnabled: true },
        create: {
          id: OTHER_ORG,
          name: 'Cursor IDOR Org',
          slug: 'cursor-idor-org',
          createdBy: 'seed',
          donationsEnabled: true,
        },
      });
      const foreignCoal = await prisma.coalition.create({
        data: coalitionFactory({
          id: 'coal_cursor_foreign_1',
          organizationId: OTHER_ORG,
          slug: 'cursor-foreign-coalition',
          name: 'Cursor Foreign Coalition',
          status: 'ACTIVE',
        }),
      });

      try {
        // ADMIN_USER owns ORG_ID, not OTHER_ORG. Passing the foreign coalition's
        // id as a cursor on ORG_ID's list must return 400 — invalid cursor.
        await request(app.getHttpServer())
          .get(`/orgs/${ORG_ID}/coalitions?cursor=${foreignCoal.id}`)
          .expect(400);
      } finally {
        await prisma.coalition.delete({ where: { id: foreignCoal.id } }).catch(() => {});
        await prisma.organization.delete({ where: { id: OTHER_ORG } }).catch(() => {});
      }
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

      expect(res.body).toMatchObject({
        name: 'Renamed Coalition',
        displayOrder: 2,
      });
    });

    it('returns 400 when status is sent (status must go via archive route)', async () => {
      await request(app.getHttpServer())
        .patch(`/orgs/${ORG_ID}/coalitions/${coalitionId}`)
        .send({ status: 'ARCHIVED' })
        .expect(400);
    });

    it('returns 200 with description: null when null is sent to clear the field', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/orgs/${ORG_ID}/coalitions/${coalitionId}`)
        .send({ description: null })
        .expect(200);

      expect(res.body.description).toBeNull();
    });

    it('clears description after a previous set: final value is null', async () => {
      // First set a description, then clear it — proves the null path works after a non-null write.
      await request(app.getHttpServer())
        .patch(`/orgs/${ORG_ID}/coalitions/${coalitionId}`)
        .send({ description: 'Some text' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .patch(`/orgs/${ORG_ID}/coalitions/${coalitionId}`)
        .send({ description: null })
        .expect(200);

      expect(res.body.description).toBeNull();
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

  describe('POST /orgs/:orgId/coalitions/:id/restore', () => {
    it('returns 409 when the coalition is not archived (still ACTIVE)', async () => {
      await request(app.getHttpServer())
        .post(`/orgs/${ORG_ID}/coalitions/${coalitionId}/restore`)
        .expect(409);
    });

    it('returns 200 with status=ACTIVE after restoring an archived coalition', async () => {
      // Archive the blocking campaign first, then archive the coalition.
      await prisma.campaign.update({
        where: { id: campaignId },
        data: { status: 'ARCHIVED' },
      });
      await request(app.getHttpServer())
        .post(`/orgs/${ORG_ID}/coalitions/${coalitionId}/archive`)
        .expect(200);

      // Confirm it is now ARCHIVED before restoring.
      const check = await prisma.coalition.findUnique({
        where: { id: coalitionId },
      });
      expect(check?.status).toBe('ARCHIVED');

      const res = await request(app.getHttpServer())
        .post(`/orgs/${ORG_ID}/coalitions/${coalitionId}/restore`)
        .expect(200);

      expect(res.body).toMatchObject({ id: coalitionId, status: 'ACTIVE' });
    });

    it('returns 404 for a cross-org coalition id (IDOR guard)', async () => {
      const OTHER_ORG = 'org_restore_idor';
      const OTHER_USER = 'restore-idor-user';

      await prisma.organization.upsert({
        where: { id: OTHER_ORG },
        update: { donationsEnabled: true },
        create: {
          id: OTHER_ORG,
          name: 'Restore IDOR Org',
          slug: 'restore-idor-org',
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
          id: 'coal_restore_foreign',
          organizationId: OTHER_ORG,
          slug: 'restore-foreign-coalition',
          name: 'Restore Foreign Coalition',
          status: 'ARCHIVED',
        }),
      });

      // ADMIN_USER is OWNER of ORG_ID but NOT of OTHER_ORG. Pointing the URL at
      // ORG_ID but the coalition id at the foreign row must return 404.
      await request(app.getHttpServer())
        .post(`/orgs/${ORG_ID}/coalitions/${foreign.id}/restore`)
        .expect(404);

      // Cleanup
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

    it('returns 404 for an unknown coalition id', async () => {
      await request(app.getHttpServer())
        .post(`/orgs/${ORG_ID}/coalitions/nonexistent_coalition_id/restore`)
        .expect(404);
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
