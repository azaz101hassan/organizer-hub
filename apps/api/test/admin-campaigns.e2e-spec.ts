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

const ADMIN_USER = 'admin-camp-1';
const ORG_ID = 'org_admin_camp_test';

describe('Admin campaigns API', () => {
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
    // Tear down in FK-safe order, scoped to ORG_ID so a parallel suite's
    // donations are not affected if --runInBand is ever dropped.
    await prisma.donation.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.campaign.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.coalition.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.organizationMember.deleteMany({ where: { organizationId: ORG_ID } });

    holder.value = ADMIN_USER;

    await prisma.organization.upsert({
      where: { id: ORG_ID },
      update: { donationsEnabled: true },
      create: {
        id: ORG_ID,
        name: 'Camp Test Org',
        slug: 'camp-test-org',
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
        id: 'coal_admin_camp_1',
        organizationId: ORG_ID,
        slug: 'test-coalition',
        name: 'Test Coalition',
        status: 'ACTIVE',
      }),
    });
    coalitionId = coalition.id;

    const campaign = await prisma.campaign.create({
      data: campaignFactory({
        id: 'camp_admin_camp_1',
        organizationId: ORG_ID,
        coalitionId: coalitionId,
        slug: 'test-campaign',
        name: 'Test Campaign',
        status: 'DRAFT',
      }),
    });
    campaignId = campaign.id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /orgs/:orgId/campaigns', () => {
    it('returns 200 with a list including the seeded DRAFT campaign (admin sees DRAFT)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/orgs/${ORG_ID}/campaigns`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      const item = (res.body as { id: string; status: string }[]).find(
        (c) => c.id === campaignId,
      );
      expect(item).toBeDefined();
      expect(item?.status).toBe('DRAFT');
    });

    it('filter match: returns only campaigns under the specified coalitionId', async () => {
      // Seed a second coalition and a campaign under it
      const secondCoalition = await prisma.coalition.create({
        data: coalitionFactory({
          id: 'coal_filter_match_1',
          organizationId: ORG_ID,
          slug: 'filter-match-coalition',
          name: 'Filter Match Coalition',
          status: 'ACTIVE',
        }),
      });
      const secondCampaign = await prisma.campaign.create({
        data: campaignFactory({
          id: 'camp_filter_match_1',
          organizationId: ORG_ID,
          coalitionId: secondCoalition.id,
          slug: 'filter-match-campaign',
          name: 'Filter Match Campaign',
          status: 'DRAFT',
        }),
      });

      try {
        const res = await request(app.getHttpServer())
          .get(`/orgs/${ORG_ID}/campaigns?coalitionId=${secondCoalition.id}`)
          .expect(200);

        expect(Array.isArray(res.body)).toBe(true);
        const ids = (res.body as { id: string }[]).map((c) => c.id);
        expect(ids).toContain(secondCampaign.id);
        expect(ids).not.toContain(campaignId);
        expect(res.body).toHaveLength(1);
      } finally {
        await prisma.campaign.delete({ where: { id: secondCampaign.id } }).catch(() => {});
        await prisma.coalition.delete({ where: { id: secondCoalition.id } }).catch(() => {});
      }
    });

    it('filter no-match: returns empty array when coalitionId matches no campaigns', async () => {
      const res = await request(app.getHttpServer())
        .get(`/orgs/${ORG_ID}/campaigns?coalitionId=nonexistent-cuid-value`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(0);
    });

    it('filter validation: returns 400 when coalitionId is an empty string', async () => {
      await request(app.getHttpServer())
        .get(`/orgs/${ORG_ID}/campaigns?coalitionId=`)
        .expect(400);
    });

    it('forbidNonWhitelisted: returns 400 when an unknown query field is sent', async () => {
      await request(app.getHttpServer())
        .get(`/orgs/${ORG_ID}/campaigns?unknownField=foo`)
        .expect(400);
    });
  });

  describe('GET /orgs/:orgId/campaigns/:id', () => {
    it('returns 200 with the campaign row including coalition select', async () => {
      const res = await request(app.getHttpServer())
        .get(`/orgs/${ORG_ID}/campaigns/${campaignId}`)
        .expect(200);

      expect(res.body).toMatchObject({
        id: campaignId,
        name: 'Test Campaign',
        slug: 'test-campaign',
        status: 'DRAFT',
      });
      expect(res.body.coalition).toMatchObject({
        id: coalitionId,
        slug: 'test-coalition',
        name: 'Test Coalition',
      });
    });

    it('returns 404 for an unknown id', async () => {
      await request(app.getHttpServer())
        .get(`/orgs/${ORG_ID}/campaigns/nonexistent_id`)
        .expect(404);
    });
  });

  describe('POST /orgs/:orgId/campaigns', () => {
    it('returns 201 with the created row; status defaults to DRAFT; coalition select included', async () => {
      const res = await request(app.getHttpServer())
        .post(`/orgs/${ORG_ID}/campaigns`)
        .send({
          coalitionId,
          name: 'New Campaign',
          slug: 'new-campaign',
          description: 'A brand new campaign',
          targetAmountCents: 50_000,
          currency: 'usd',
          displayOrder: 3,
        })
        .expect(201);

      expect(res.body).toMatchObject({
        id: expect.any(String),
        name: 'New Campaign',
        slug: 'new-campaign',
        status: 'DRAFT',
        displayOrder: 3,
      });
      expect(res.body.coalition).toMatchObject({ id: coalitionId });
    });

    it('returns 400 when name is missing', async () => {
      await request(app.getHttpServer())
        .post(`/orgs/${ORG_ID}/campaigns`)
        .send({ coalitionId, slug: 'no-name', targetAmountCents: 500 })
        .expect(400);
    });

    it('returns 400 when slug contains uppercase letters', async () => {
      await request(app.getHttpServer())
        .post(`/orgs/${ORG_ID}/campaigns`)
        .send({ coalitionId, name: 'Bad Slug', slug: 'Bad-Slug', targetAmountCents: 500 })
        .expect(400);
    });

    it('returns 400 when targetAmountCents is below the minimum (< 100)', async () => {
      await request(app.getHttpServer())
        .post(`/orgs/${ORG_ID}/campaigns`)
        .send({ coalitionId, name: 'Cheap', slug: 'cheap', targetAmountCents: 50 })
        .expect(400);
    });

    it('returns 400 when currency is uppercase', async () => {
      await request(app.getHttpServer())
        .post(`/orgs/${ORG_ID}/campaigns`)
        .send({
          coalitionId,
          name: 'Currency Test',
          slug: 'currency-test',
          targetAmountCents: 500,
          currency: 'USD',
        })
        .expect(400);
    });

    it('returns 400 when status is ACTIVE on create (DTO rejects non-DRAFT)', async () => {
      await request(app.getHttpServer())
        .post(`/orgs/${ORG_ID}/campaigns`)
        .send({
          coalitionId,
          name: 'Active Create',
          slug: 'active-create',
          targetAmountCents: 500,
          status: 'ACTIVE',
        })
        .expect(400);
    });

    it('returns 404 when coalitionId does not exist', async () => {
      await request(app.getHttpServer())
        .post(`/orgs/${ORG_ID}/campaigns`)
        .send({
          coalitionId: 'coal_nonexistent',
          name: 'Ghost',
          slug: 'ghost',
          targetAmountCents: 500,
        })
        .expect(404);
    });

    it('returns 409 when the parent coalition is ARCHIVED', async () => {
      // Seed a second coalition and immediately archive it
      const archived = await prisma.coalition.create({
        data: coalitionFactory({
          id: 'coal_archived_1',
          organizationId: ORG_ID,
          slug: 'archived-coalition',
          name: 'Archived Coalition',
          status: 'ARCHIVED',
        }),
      });

      const res = await request(app.getHttpServer())
        .post(`/orgs/${ORG_ID}/campaigns`)
        .send({
          coalitionId: archived.id,
          name: 'Under Archived',
          slug: 'under-archived',
          targetAmountCents: 500,
        })
        .expect(409);

      expect(res.body.message).toMatch(/archived/i);
    });

    it('returns 409 when slug collides with an existing campaign', async () => {
      await request(app.getHttpServer())
        .post(`/orgs/${ORG_ID}/campaigns`)
        .send({
          coalitionId,
          name: 'Dup',
          slug: 'test-campaign', // same as seeded campaign
          targetAmountCents: 500,
        })
        .expect(409);
    });

    it('returns 404 when coalitionId belongs to another org (cross-org IDOR firewall)', async () => {
      const OTHER_ORG = 'org_admin_camp_idor_create';
      try {
        await prisma.organization.upsert({
          where: { id: OTHER_ORG },
          update: { donationsEnabled: true },
          create: {
            id: OTHER_ORG,
            name: 'Other Camp Create Org',
            slug: 'other-camp-create-org',
            createdBy: 'seed',
            donationsEnabled: true,
          },
        });
        const foreignCoalition = await prisma.coalition.create({
          data: coalitionFactory({
            id: 'coal_foreign_create_1',
            organizationId: OTHER_ORG,
            slug: 'foreign-create-coalition',
            name: 'Foreign Create Coalition',
            status: 'ACTIVE',
          }),
        });

        await request(app.getHttpServer())
          .post(`/orgs/${ORG_ID}/campaigns`)
          .send({
            coalitionId: foreignCoalition.id,
            name: 'Cross-org',
            slug: 'cross-org',
            targetAmountCents: 500,
          })
          .expect(404);
      } finally {
        await prisma.coalition.deleteMany({ where: { organizationId: OTHER_ORG } });
        await prisma.organization.delete({ where: { id: OTHER_ORG } }).catch(() => {});
      }
    });

    it('returns 400 when coverImageUrl uses the javascript: scheme', async () => {
      await request(app.getHttpServer())
        .post(`/orgs/${ORG_ID}/campaigns`)
        .send({
          coalitionId,
          name: 'XSS Attempt',
          slug: 'xss-attempt',
          targetAmountCents: 500,
          coverImageUrl: 'javascript:alert(1)',
        })
        .expect(400);
    });
  });

  describe('PATCH /orgs/:orgId/campaigns/:id', () => {
    it('returns 200 with updated name and displayOrder', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/orgs/${ORG_ID}/campaigns/${campaignId}`)
        .send({ name: 'Renamed Campaign', displayOrder: 7 })
        .expect(200);

      expect(res.body).toMatchObject({ name: 'Renamed Campaign', displayOrder: 7 });
    });

    it('returns 400 when status is sent in the body', async () => {
      await request(app.getHttpServer())
        .patch(`/orgs/${ORG_ID}/campaigns/${campaignId}`)
        .send({ status: 'ACTIVE' })
        .expect(400);
    });

    it('returns 400 when coalitionId is sent in the body', async () => {
      await request(app.getHttpServer())
        .patch(`/orgs/${ORG_ID}/campaigns/${campaignId}`)
        .send({ coalitionId: 'coal_other' })
        .expect(400);
    });

    it('returns 409 on slug collision when renaming', async () => {
      // Seed a sibling campaign with a known slug
      await prisma.campaign.create({
        data: campaignFactory({
          id: 'camp_sibling_1',
          organizationId: ORG_ID,
          coalitionId,
          slug: 'sibling-campaign',
          name: 'Sibling Campaign',
          status: 'DRAFT',
        }),
      });

      await request(app.getHttpServer())
        .patch(`/orgs/${ORG_ID}/campaigns/${campaignId}`)
        .send({ slug: 'sibling-campaign' })
        .expect(409);
    });
  });

  describe('POST /orgs/:orgId/campaigns/:id/transition', () => {
    it.each([
      ['DRAFT',    'ACTIVE',    200] as const,
      ['DRAFT',    'ARCHIVED',  200] as const,
      ['DRAFT',    'COMPLETE',  400] as const,
      ['DRAFT',    'DRAFT',     400] as const,
      ['ACTIVE',   'COMPLETE',  200] as const,
      ['ACTIVE',   'ARCHIVED',  200] as const,
      ['ACTIVE',   'DRAFT',     400] as const,
      ['ACTIVE',   'ACTIVE',    400] as const,
      ['COMPLETE', 'ACTIVE',    200] as const,
      ['COMPLETE', 'ARCHIVED',  200] as const,
      ['COMPLETE', 'DRAFT',     400] as const,
      ['ARCHIVED', 'DRAFT',     200] as const,
      ['ARCHIVED', 'ACTIVE',    400] as const,
      ['ARCHIVED', 'COMPLETE',  400] as const,
    ])(
      'transition %s -> %s returns %i',
      async (from, to, expected) => {
        // Force the campaign into the required starting state
        await prisma.campaign.update({
          where: { id: campaignId },
          data: { status: from },
        });

        const res = await request(app.getHttpServer())
          .post(`/orgs/${ORG_ID}/campaigns/${campaignId}/transition`)
          .send({ to })
          .expect(expected);

        if (expected === 200) {
          expect(res.body.status).toBe(to);
        }
      },
    );

    it('returns 409 when transitioning to ACTIVE under an ARCHIVED parent coalition', async () => {
      // Manually archive the seeded coalition to set up the invariant case:
      // U20's archive allows DRAFT children through, but U21's transition
      // must block activating a campaign whose parent is archived.
      await prisma.coalition.update({
        where: { id: coalitionId },
        data: { status: 'ARCHIVED' },
      });

      await request(app.getHttpServer())
        .post(`/orgs/${ORG_ID}/campaigns/${campaignId}/transition`)
        .send({ to: 'ACTIVE' })
        .expect(409);
    });

    it('returns 400 for an unknown target status (DTO rejects)', async () => {
      await request(app.getHttpServer())
        .post(`/orgs/${ORG_ID}/campaigns/${campaignId}/transition`)
        .send({ to: 'BOGUS' })
        .expect(400);
    });

    it('returns 400 for an empty body (missing `to` field)', async () => {
      await request(app.getHttpServer())
        .post(`/orgs/${ORG_ID}/campaigns/${campaignId}/transition`)
        .send({})
        .expect(400);
    });
  });

  describe('authorization', () => {
    afterEach(() => {
      holder.value = ADMIN_USER;
    });

    it('returns 404 for a non-member user', async () => {
      holder.value = 'stranger-user';
      await request(app.getHttpServer())
        .get(`/orgs/${ORG_ID}/campaigns`)
        .expect(404);
    });

    it('returns 404 for cross-org IDOR on get, patch, and transition', async () => {
      const OTHER_ORG = 'org_admin_camp_other';
      const OTHER_USER = 'admin-camp-other-1';

      await prisma.organization.upsert({
        where: { id: OTHER_ORG },
        update: { donationsEnabled: true },
        create: {
          id: OTHER_ORG,
          name: 'Other Camp Org',
          slug: 'other-camp-org',
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
      const foreignCoalition = await prisma.coalition.create({
        data: coalitionFactory({
          id: 'coal_foreign_camp_1',
          organizationId: OTHER_ORG,
          slug: 'foreign-coalition',
          name: 'Foreign Coalition',
          status: 'ACTIVE',
        }),
      });
      const foreignCampaign = await prisma.campaign.create({
        data: campaignFactory({
          id: 'camp_foreign_1',
          organizationId: OTHER_ORG,
          coalitionId: foreignCoalition.id,
          slug: 'foreign-campaign',
          name: 'Foreign Campaign',
          status: 'DRAFT',
        }),
      });

      try {
        // ADMIN_USER is OWNER of ORG_ID but NOT of OTHER_ORG. Pointing the URL
        // at ORG_ID but the campaign id at the foreign row must return 404 —
        // the service-level org-match check is the IDOR firewall.
        await request(app.getHttpServer())
          .get(`/orgs/${ORG_ID}/campaigns/${foreignCampaign.id}`)
          .expect(404);

        await request(app.getHttpServer())
          .patch(`/orgs/${ORG_ID}/campaigns/${foreignCampaign.id}`)
          .send({ name: 'Hijacked' })
          .expect(404);

        await request(app.getHttpServer())
          .post(`/orgs/${ORG_ID}/campaigns/${foreignCampaign.id}/transition`)
          .send({ to: 'ACTIVE' })
          .expect(404);
      } finally {
        // Cleanup runs even if an assertion above throws, so a flake doesn't
        // poison subsequent tests with leftover foreign rows.
        await prisma.campaign.delete({ where: { id: foreignCampaign.id } }).catch(() => {});
        await prisma.coalition.delete({ where: { id: foreignCoalition.id } }).catch(() => {});
        await prisma.organizationMember.delete({
          where: {
            organizationId_userId: {
              organizationId: OTHER_ORG,
              userId: OTHER_USER,
            },
          },
        }).catch(() => {});
        await prisma.organization.delete({ where: { id: OTHER_ORG } }).catch(() => {});
      }
    });
  });
});
