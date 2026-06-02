import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { OrganizationRole } from '@organizer-hub/db/api';
import { StripeClient } from './../src/billing/stripe.client';
import { PrismaService } from './../src/prisma/prisma.service';
import {
  bootTestApp,
  makeSubHolder,
  stubJwtAuthGuard,
  type SubHolder,
} from './helpers/boot-test-app';
import { FakeStripeClient } from './helpers/fake-stripe';
import {
  campaignFactory,
  coalitionFactory,
  donationFactory,
} from './factories';

const ADMIN_USER = 'admin-don-1';
const ORG_ID = 'org_admin_don_test';

interface PageBody<T> {
  items: T[];
  nextCursor: string | null;
}

describe('Admin donations API', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let fakeStripe: FakeStripeClient;
  let holder: SubHolder;
  let coalitionId: string;
  let campaignId: string;
  let donOneTimeId: string;
  let donRecurringActiveId: string;
  let donRecurringCanceledId: string;

  beforeAll(async () => {
    fakeStripe = new FakeStripeClient();
    holder = makeSubHolder(ADMIN_USER);
    ({ app, prisma } = await bootTestApp(stubJwtAuthGuard(holder), [
      { token: StripeClient, useValue: fakeStripe },
    ]));
  });

  beforeEach(async () => {
    // Tear down in FK-safe order, scoped to ORG_ID.
    await prisma.paymentEvent.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.donation.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.campaign.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.coalition.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.organizationMember.deleteMany({
      where: { organizationId: ORG_ID },
    });

    holder.value = ADMIN_USER;
    fakeStripe.reset();

    await prisma.organization.upsert({
      where: { id: ORG_ID },
      update: { donationsEnabled: true },
      create: {
        id: ORG_ID,
        name: 'Don Admin Test Org',
        slug: 'don-admin-test-org',
        createdBy: 'seed',
        donationsEnabled: true,
      },
    });

    // Bind test user as OWNER so RolesGuard passes.
    await prisma.organizationMember.create({
      data: {
        organizationId: ORG_ID,
        userId: ADMIN_USER,
        role: OrganizationRole.OWNER,
      },
    });

    const coalition = await prisma.coalition.create({
      data: coalitionFactory({
        id: 'coal_admin_don_1',
        organizationId: ORG_ID,
        slug: 'don-test-coalition',
        name: 'Don Test Coalition',
        status: 'ACTIVE',
      }),
    });
    coalitionId = coalition.id;

    const campaign = await prisma.campaign.create({
      data: campaignFactory({
        id: 'camp_admin_don_1',
        organizationId: ORG_ID,
        coalitionId,
        slug: 'don-test-campaign',
        name: 'Don Test Campaign',
        status: 'ACTIVE',
      }),
    });
    campaignId = campaign.id;

    // Seed three donations for filter / cancel tests.
    const donOneTime = await prisma.donation.create({
      data: donationFactory({
        id: 'don_one_time_1',
        organizationId: ORG_ID,
        userId: 'user_donor_1',
        campaignId,
        mode: 'ONE_TIME',
        cadence: 'ONCE',
        status: 'COMPLETED',
        stripeSubscriptionId: null,
      }),
    });
    donOneTimeId = donOneTime.id;

    const donRecurringActive = await prisma.donation.create({
      data: donationFactory({
        id: 'don_recurring_active',
        organizationId: ORG_ID,
        userId: 'user_donor_2',
        campaignId,
        mode: 'RECURRING',
        cadence: 'MONTHLY',
        status: 'ACTIVE',
        stripeSubscriptionId: 'sub_test_active_1',
      }),
    });
    donRecurringActiveId = donRecurringActive.id;

    const donRecurringCanceled = await prisma.donation.create({
      data: donationFactory({
        id: 'don_recurring_canceled',
        organizationId: ORG_ID,
        userId: 'user_donor_3',
        campaignId,
        mode: 'RECURRING',
        cadence: 'MONTHLY',
        status: 'CANCELED',
        stripeSubscriptionId: 'sub_test_canceled_1',
        canceledAt: new Date('2025-01-01T00:00:00Z'),
      }),
    });
    donRecurringCanceledId = donRecurringCanceled.id;

    // Pre-seed the active subscription in the fake so forceCancelForAdmin can
    // call subscriptions.update without throwing "No such subscription".
    fakeStripe.seedSubscription({
      id: 'sub_test_active_1',
      customer: 'cus_test_1',
      status: 'active',
      cancel_at_period_end: false,
      items: { data: [] },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /orgs/:orgId/donations', () => {
    it('returns 200 with paginated shape containing all 3 seeded donations', async () => {
      const res = await request(app.getHttpServer())
        .get(`/orgs/${ORG_ID}/donations`)
        .expect(200);

      const body = res.body as PageBody<{ id: string }>;
      expect(body).toHaveProperty('items');
      expect(body).toHaveProperty('nextCursor');
      expect(Array.isArray(body.items)).toBe(true);
      expect(body.items).toHaveLength(3);
    });

    it('filter ?mode=RECURRING returns 2 donations', async () => {
      const res = await request(app.getHttpServer())
        .get(`/orgs/${ORG_ID}/donations?mode=RECURRING`)
        .expect(200);

      const body = res.body as PageBody<{ mode: string }>;
      expect(body.items).toHaveLength(2);
      expect(body.items.every((d) => d.mode === 'RECURRING')).toBe(true);
    });

    it('filter ?mode=ONE_TIME returns 1 donation', async () => {
      const res = await request(app.getHttpServer())
        .get(`/orgs/${ORG_ID}/donations?mode=ONE_TIME`)
        .expect(200);

      const body = res.body as PageBody<{ mode: string }>;
      expect(body.items).toHaveLength(1);
      expect(body.items[0].mode).toBe('ONE_TIME');
    });

    it('filter ?status=ACTIVE returns 1 donation', async () => {
      const res = await request(app.getHttpServer())
        .get(`/orgs/${ORG_ID}/donations?status=ACTIVE`)
        .expect(200);

      const body = res.body as PageBody<{ status: string }>;
      expect(body.items).toHaveLength(1);
      expect(body.items[0].status).toBe('ACTIVE');
    });

    it('filter ?status=CANCELED returns 1 donation', async () => {
      const res = await request(app.getHttpServer())
        .get(`/orgs/${ORG_ID}/donations?status=CANCELED`)
        .expect(200);

      const body = res.body as PageBody<{ status: string }>;
      expect(body.items).toHaveLength(1);
      expect(body.items[0].status).toBe('CANCELED');
    });

    it('filter ?mode=RECURRING&status=CANCELED returns 1 donation (intersection)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/orgs/${ORG_ID}/donations?mode=RECURRING&status=CANCELED`)
        .expect(200);

      const body = res.body as PageBody<{ mode: string; status: string }>;
      expect(body.items).toHaveLength(1);
      expect(body.items[0].mode).toBe('RECURRING');
      expect(body.items[0].status).toBe('CANCELED');
    });

    it('filter ?campaignId=<seeded> returns 3; ?campaignId=nonexistent returns []', async () => {
      const resMatch = await request(app.getHttpServer())
        .get(`/orgs/${ORG_ID}/donations?campaignId=${campaignId}`)
        .expect(200);
      expect((resMatch.body as PageBody<{ id: string }>).items).toHaveLength(3);

      const resMiss = await request(app.getHttpServer())
        .get(`/orgs/${ORG_ID}/donations?campaignId=nonexistent_id`)
        .expect(200);
      expect((resMiss.body as PageBody<{ id: string }>).items).toHaveLength(0);
    });

    it('list response nests campaign and coalition on each row', async () => {
      const res = await request(app.getHttpServer())
        .get(`/orgs/${ORG_ID}/donations`)
        .expect(200);

      const body = res.body as PageBody<{ id: string; campaign: unknown }>;
      const item = body.items.find((d) => d.id === donOneTimeId);
      expect(item).toBeDefined();
      expect(item?.campaign).toMatchObject({
        id: campaignId,
        slug: 'don-test-campaign',
        name: 'Don Test Campaign',
        coalition: {
          id: coalitionId,
          slug: 'don-test-coalition',
          name: 'Don Test Coalition',
        },
      });
    });

    it('returns donations ordered by createdAt descending', async () => {
      // Back-date the seeded donations to fixed timestamps so the ordering
      // assertion is deterministic regardless of how close the inserts ran.
      await prisma.donation.update({
        where: { id: donOneTimeId },
        data: { createdAt: new Date('2025-01-01T00:00:00Z') },
      });
      await prisma.donation.update({
        where: { id: donRecurringActiveId },
        data: { createdAt: new Date('2025-06-01T00:00:00Z') },
      });
      await prisma.donation.update({
        where: { id: donRecurringCanceledId },
        data: { createdAt: new Date('2025-12-01T00:00:00Z') },
      });

      const res = await request(app.getHttpServer())
        .get(`/orgs/${ORG_ID}/donations`)
        .expect(200);

      const body = res.body as PageBody<{ id: string }>;
      expect(body.items.map((d) => d.id)).toEqual([
        donRecurringCanceledId,
        donRecurringActiveId,
        donOneTimeId,
      ]);
    });

    it('?mode=BOGUS returns 400', async () => {
      await request(app.getHttpServer())
        .get(`/orgs/${ORG_ID}/donations?mode=BOGUS`)
        .expect(400);
    });

    it('?status=BOGUS returns 400', async () => {
      await request(app.getHttpServer())
        .get(`/orgs/${ORG_ID}/donations?status=BOGUS`)
        .expect(400);
    });

    it('?unknownField=x returns 400 (forbidNonWhitelisted)', async () => {
      await request(app.getHttpServer())
        .get(`/orgs/${ORG_ID}/donations?unknownField=x`)
        .expect(400);
    });

    it('?campaignId= (empty) returns 400 (lower-bound length)', async () => {
      await request(app.getHttpServer())
        .get(`/orgs/${ORG_ID}/donations?campaignId=`)
        .expect(400);
    });
  });

  describe('pagination', () => {
    it('default limit 20: 25 donations → first page has 20 items + nextCursor', async () => {
      // Seed 22 additional donations (3 already seeded in beforeEach = 25 total)
      for (let i = 4; i <= 25; i++) {
        await prisma.donation.create({
          data: donationFactory({
            id: `don_pag_${String(i).padStart(3, '0')}`,
            organizationId: ORG_ID,
            userId: `user_pag_${i}`,
            campaignId,
            mode: 'ONE_TIME',
            cadence: 'ONCE',
            status: 'COMPLETED',
            stripeSubscriptionId: null,
          }),
        });
      }

      const res = await request(app.getHttpServer())
        .get(`/orgs/${ORG_ID}/donations`)
        .expect(200);

      const page1 = res.body as PageBody<{ id: string }>;
      expect(page1.items).toHaveLength(20);
      expect(page1.nextCursor).not.toBeNull();

      // Fetch second page using the cursor
      const res2 = await request(app.getHttpServer())
        .get(`/orgs/${ORG_ID}/donations?cursor=${page1.nextCursor}`)
        .expect(200);

      const page2 = res2.body as PageBody<{ id: string }>;
      expect(page2.items).toHaveLength(5);
      expect(page2.nextCursor).toBeNull();
    });

    it('limit=5: returns 5 items and a cursor from 25 donations', async () => {
      for (let i = 4; i <= 25; i++) {
        await prisma.donation.create({
          data: donationFactory({
            id: `don_lim_${String(i).padStart(3, '0')}`,
            organizationId: ORG_ID,
            userId: `user_lim_${i}`,
            campaignId,
            mode: 'ONE_TIME',
            cadence: 'ONCE',
            status: 'COMPLETED',
            stripeSubscriptionId: null,
          }),
        });
      }

      const res = await request(app.getHttpServer())
        .get(`/orgs/${ORG_ID}/donations?limit=5`)
        .expect(200);

      const page = res.body as PageBody<{ id: string }>;
      expect(page.items).toHaveLength(5);
      expect(page.nextCursor).not.toBeNull();
    });

    it('limit=101 returns 400', async () => {
      await request(app.getHttpServer())
        .get(`/orgs/${ORG_ID}/donations?limit=101`)
        .expect(400);
    });

    it('limit=0 returns 400', async () => {
      await request(app.getHttpServer())
        .get(`/orgs/${ORG_ID}/donations?limit=0`)
        .expect(400);
    });

    it('malformed cursor (non-existent id) returns 200 with empty items', async () => {
      const res = await request(app.getHttpServer())
        .get(`/orgs/${ORG_ID}/donations?cursor=nonexistent_cursor_id`)
        .expect(200);

      const page = res.body as PageBody<{ id: string }>;
      expect(page.items).toHaveLength(0);
      expect(page.nextCursor).toBeNull();
    });

    it('filter+cursor: mode=RECURRING with cursor paginates correctly', async () => {
      // Seed 22 additional RECURRING donations (1 already seeded = 23 RECURRING total)
      for (let i = 2; i <= 22; i++) {
        await prisma.donation.create({
          data: donationFactory({
            id: `don_rec_pag_${String(i).padStart(3, '0')}`,
            organizationId: ORG_ID,
            userId: `user_rec_pag_${i}`,
            campaignId,
            mode: 'RECURRING',
            cadence: 'MONTHLY',
            status: 'ACTIVE',
            stripeSubscriptionId: `sub_rec_pag_${i}`,
          }),
        });
      }

      const res = await request(app.getHttpServer())
        .get(`/orgs/${ORG_ID}/donations?mode=RECURRING&limit=10`)
        .expect(200);

      const page1 = res.body as PageBody<{ mode: string }>;
      expect(page1.items).toHaveLength(10);
      expect(page1.items.every((d) => d.mode === 'RECURRING')).toBe(true);
      expect(page1.nextCursor).not.toBeNull();

      const res2 = await request(app.getHttpServer())
        .get(
          `/orgs/${ORG_ID}/donations?mode=RECURRING&limit=10&cursor=${page1.nextCursor}`,
        )
        .expect(200);

      // 23 RECURRING total, first page took 10, second page has 13
      const page2 = res2.body as PageBody<{ mode: string }>;
      expect(page2.items.length).toBeGreaterThan(0);
      expect(page2.items.every((d) => d.mode === 'RECURRING')).toBe(true);
    });
  });

  describe('POST /orgs/:orgId/donations/:id/cancel', () => {
    it('happy path on recurring ACTIVE donation returns 200 with { status: "canceled" }', async () => {
      const res = await request(app.getHttpServer())
        .post(`/orgs/${ORG_ID}/donations/${donRecurringActiveId}/cancel`)
        .expect(200);

      expect(res.body).toEqual({ status: 'canceled' });
    });

    it('DB row reflects CANCELED status and a canceledAt timestamp after cancel', async () => {
      await request(app.getHttpServer())
        .post(`/orgs/${ORG_ID}/donations/${donRecurringActiveId}/cancel`)
        .expect(200);

      const after = await prisma.donation.findUnique({
        where: { id: donRecurringActiveId },
      });
      expect(after?.status).toBe('CANCELED');
      expect(after?.canceledAt).toBeTruthy();
    });

    it('Stripe subscriptions.update called once with correct args', async () => {
      await request(app.getHttpServer())
        .post(`/orgs/${ORG_ID}/donations/${donRecurringActiveId}/cancel`)
        .expect(200);

      const calls = fakeStripe.callsFor('subscriptions.update');
      expect(calls).toHaveLength(1);
      expect(calls[0].args).toEqual([
        'sub_test_active_1',
        { cancel_at_period_end: true },
      ]);
    });

    it('returns 404 on unknown donation id', async () => {
      await request(app.getHttpServer())
        .post(`/orgs/${ORG_ID}/donations/nonexistent_id/cancel`)
        .expect(404);
    });

    it('returns 409 when canceling a one-time donation (mode !== RECURRING)', async () => {
      // The seeded one-time donation is COMPLETED; the status check runs first
      // and returns "not active". Seed an ACTIVE one-time to reach the mode guard.
      const activeOneTime = await prisma.donation.create({
        data: donationFactory({
          id: 'don_one_time_active',
          organizationId: ORG_ID,
          userId: 'user_donor_5',
          campaignId,
          mode: 'ONE_TIME',
          cadence: 'ONCE',
          status: 'ACTIVE',
          stripeSubscriptionId: null,
        }),
      });

      const res = await request(app.getHttpServer())
        .post(`/orgs/${ORG_ID}/donations/${activeOneTime.id}/cancel`)
        .expect(409);

      expect(res.body.message).toMatch(/not recurring/i);
    });

    it('returns 409 when donation is already canceled (status !== ACTIVE)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/orgs/${ORG_ID}/donations/${donRecurringCanceledId}/cancel`)
        .expect(409);

      expect(res.body.message).toMatch(/not active/i);
    });

    it('returns 409 (no stripe subscription) when RECURRING ACTIVE row has null stripeSubscriptionId', async () => {
      const noSubDon = await prisma.donation.create({
        data: donationFactory({
          id: 'don_recurring_no_sub',
          organizationId: ORG_ID,
          userId: 'user_donor_4',
          campaignId,
          mode: 'RECURRING',
          cadence: 'MONTHLY',
          status: 'ACTIVE',
          stripeSubscriptionId: null,
        }),
      });

      const res = await request(app.getHttpServer())
        .post(`/orgs/${ORG_ID}/donations/${noSubDon.id}/cancel`)
        .expect(409);

      expect(res.body.message).toMatch(/no stripe subscription/i);
    });
  });

  describe('authorization', () => {
    afterEach(() => {
      holder.value = ADMIN_USER;
    });

    it('returns 404 for a non-member user', async () => {
      holder.value = 'stranger-user';
      await request(app.getHttpServer())
        .get(`/orgs/${ORG_ID}/donations`)
        .expect(404);
    });

    it('returns 403 for a member whose role is MEMBER (not OWNER/ADMIN)', async () => {
      const MEMBER_USER = 'member-don-1';
      try {
        await prisma.organizationMember.create({
          data: {
            organizationId: ORG_ID,
            userId: MEMBER_USER,
            role: OrganizationRole.MEMBER,
          },
        });
        holder.value = MEMBER_USER;
        await request(app.getHttpServer())
          .get(`/orgs/${ORG_ID}/donations`)
          .expect(403);
      } finally {
        await prisma.organizationMember
          .delete({
            where: {
              organizationId_userId: {
                organizationId: ORG_ID,
                userId: MEMBER_USER,
              },
            },
          })
          .catch(() => {});
      }
    });

    it('returns 404 for cross-org IDOR: cancel foreign-org donation via ORG_ID URL', async () => {
      const OTHER_ORG = 'org_admin_don_idor';

      try {
        await prisma.organization.upsert({
          where: { id: OTHER_ORG },
          update: { donationsEnabled: true },
          create: {
            id: OTHER_ORG,
            name: 'Other Don Org',
            slug: 'other-don-org',
            createdBy: 'seed',
            donationsEnabled: true,
          },
        });

        const foreignCoalition = await prisma.coalition.create({
          data: coalitionFactory({
            id: 'coal_foreign_don_1',
            organizationId: OTHER_ORG,
            slug: 'foreign-don-coalition',
            name: 'Foreign Don Coalition',
            status: 'ACTIVE',
          }),
        });

        const foreignCampaign = await prisma.campaign.create({
          data: campaignFactory({
            id: 'camp_foreign_don_1',
            organizationId: OTHER_ORG,
            coalitionId: foreignCoalition.id,
            slug: 'foreign-don-campaign',
            name: 'Foreign Don Campaign',
            status: 'ACTIVE',
          }),
        });

        const foreignDonation = await prisma.donation.create({
          data: donationFactory({
            id: 'don_foreign_active',
            organizationId: OTHER_ORG,
            userId: 'user_foreign_donor',
            campaignId: foreignCampaign.id,
            mode: 'RECURRING',
            cadence: 'MONTHLY',
            status: 'ACTIVE',
            stripeSubscriptionId: 'sub_foreign_active_1',
          }),
        });

        // ADMIN_USER is OWNER of ORG_ID, not OTHER_ORG. Pointing :orgId at
        // ORG_ID but :id at the foreign donation must return 404 — the
        // service-layer org check is the IDOR firewall.
        await request(app.getHttpServer())
          .post(`/orgs/${ORG_ID}/donations/${foreignDonation.id}/cancel`)
          .expect(404);
      } finally {
        await prisma.donation.deleteMany({
          where: { organizationId: OTHER_ORG },
        });
        await prisma.campaign.deleteMany({
          where: { organizationId: OTHER_ORG },
        });
        await prisma.coalition.deleteMany({
          where: { organizationId: OTHER_ORG },
        });
        await prisma.organization
          .delete({ where: { id: OTHER_ORG } })
          .catch(() => {});
      }
    });
  });
});
