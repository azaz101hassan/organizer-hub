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

const ADMIN_USER = 'admin-camp-1';
const ORG_ID = 'org_admin_camp_test';

describe('Admin campaigns API', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let fakeStripe: FakeStripeClient;
  let holder: SubHolder;
  let coalitionId: string;
  let campaignId: string;

  beforeAll(async () => {
    fakeStripe = new FakeStripeClient();
    holder = makeSubHolder(ADMIN_USER);
    ({ app, prisma } = await bootTestApp(stubJwtAuthGuard(holder), [
      { token: StripeClient, useValue: fakeStripe },
    ]));
  });

  beforeEach(async () => {
    // Tear down in FK-safe order, scoped to ORG_ID so a parallel suite's
    // donations are not affected if --runInBand is ever dropped.
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
        name: 'Camp Test Org',
        slug: 'camp-test-org',
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
        await prisma.campaign
          .delete({ where: { id: secondCampaign.id } })
          .catch(() => {});
        await prisma.coalition
          .delete({ where: { id: secondCoalition.id } })
          .catch(() => {});
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

    it('empty aggregates: raisedCents, donorCount, activeRecurringCount are 0 for a fresh campaign', async () => {
      const res = await request(app.getHttpServer())
        .get(`/orgs/${ORG_ID}/campaigns/${campaignId}`)
        .expect(200);

      expect(res.body.raisedCents).toBe(0);
      expect(res.body.donorCount).toBe(0);
      expect(res.body.activeRecurringCount).toBe(0);
    });

    it('raisedCents and donorCount count SUCCEEDED payment events; distinct userIds for donorCount', async () => {
      const don1 = await prisma.donation.create({
        data: donationFactory({
          id: 'don_agg_user1',
          organizationId: ORG_ID,
          userId: 'user_agg_1',
          campaignId,
          mode: 'ONE_TIME',
          cadence: 'ONCE',
          status: 'COMPLETED',
          stripeSubscriptionId: null,
        }),
      });
      const don2 = await prisma.donation.create({
        data: donationFactory({
          id: 'don_agg_user2',
          organizationId: ORG_ID,
          userId: 'user_agg_2',
          campaignId,
          mode: 'ONE_TIME',
          cadence: 'ONCE',
          status: 'COMPLETED',
          stripeSubscriptionId: null,
        }),
      });
      // Third donation from user_agg_1 (same userId as don1) — donorCount must stay 2.
      const don3 = await prisma.donation.create({
        data: donationFactory({
          id: 'don_agg_user1b',
          organizationId: ORG_ID,
          userId: 'user_agg_1',
          campaignId,
          mode: 'ONE_TIME',
          cadence: 'ONCE',
          status: 'COMPLETED',
          stripeSubscriptionId: null,
        }),
      });

      try {
        await prisma.paymentEvent.create({
          data: {
            organizationId: ORG_ID,
            userId: 'user_agg_1',
            kind: 'DONATION',
            status: 'SUCCEEDED',
            amountCents: 5_000,
            currency: 'usd',
            donationId: don1.id,
            succeededAt: new Date(),
          },
        });
        await prisma.paymentEvent.create({
          data: {
            organizationId: ORG_ID,
            userId: 'user_agg_2',
            kind: 'DONATION',
            status: 'SUCCEEDED',
            amountCents: 3_000,
            currency: 'usd',
            donationId: don2.id,
            succeededAt: new Date(),
          },
        });
        await prisma.paymentEvent.create({
          data: {
            organizationId: ORG_ID,
            userId: 'user_agg_1',
            kind: 'DONATION',
            status: 'SUCCEEDED',
            amountCents: 2_000,
            currency: 'usd',
            donationId: don3.id,
            succeededAt: new Date(),
          },
        });

        const res = await request(app.getHttpServer())
          .get(`/orgs/${ORG_ID}/campaigns/${campaignId}`)
          .expect(200);

        expect(res.body.raisedCents).toBe(10_000); // 5000 + 3000 + 2000
        expect(res.body.donorCount).toBe(2); // user_agg_1 and user_agg_2 (distinct)
      } finally {
        await prisma.paymentEvent.deleteMany({
          where: { organizationId: ORG_ID },
        });
        await prisma.donation.deleteMany({ where: { organizationId: ORG_ID } });
      }
    });

    it('refund nets out: signed negative REFUND PaymentEvent reduces raisedCents', async () => {
      const don = await prisma.donation.create({
        data: donationFactory({
          id: 'don_refund_test',
          organizationId: ORG_ID,
          userId: 'user_refund_1',
          campaignId,
          mode: 'ONE_TIME',
          cadence: 'ONCE',
          status: 'COMPLETED',
          stripeSubscriptionId: null,
        }),
      });

      try {
        await prisma.paymentEvent.create({
          data: {
            organizationId: ORG_ID,
            userId: 'user_refund_1',
            kind: 'DONATION',
            status: 'SUCCEEDED',
            amountCents: 10_000,
            currency: 'usd',
            donationId: don.id,
            succeededAt: new Date(),
          },
        });
        // Partial refund — stored as negative per schema convention.
        await prisma.paymentEvent.create({
          data: {
            organizationId: ORG_ID,
            userId: 'user_refund_1',
            kind: 'REFUND',
            status: 'SUCCEEDED',
            amountCents: -2_500,
            currency: 'usd',
            donationId: don.id,
            succeededAt: new Date(),
          },
        });

        const res = await request(app.getHttpServer())
          .get(`/orgs/${ORG_ID}/campaigns/${campaignId}`)
          .expect(200);

        expect(res.body.raisedCents).toBe(7_500);
      } finally {
        await prisma.paymentEvent.deleteMany({
          where: { organizationId: ORG_ID },
        });
        await prisma.donation.deleteMany({ where: { organizationId: ORG_ID } });
      }
    });

    it('cross-campaign scoping: raisedCents for campaign A excludes payment events from campaign B', async () => {
      // Two campaigns under the same coalition. A PE seeded against B must not
      // bleed into A's aggregate — catches a mistyped WHERE clause (donation: {}
      // instead of donation: { campaignId }).
      const campaignB = await prisma.campaign.create({
        data: campaignFactory({
          id: 'camp_scope_b',
          organizationId: ORG_ID,
          coalitionId,
          slug: 'scope-campaign-b',
          name: 'Scope Campaign B',
          status: 'ACTIVE',
        }),
      });

      try {
        const donA = await prisma.donation.create({
          data: donationFactory({
            id: 'don_scope_a',
            organizationId: ORG_ID,
            userId: 'user_scope_a',
            campaignId,
            mode: 'ONE_TIME',
            cadence: 'ONCE',
            status: 'COMPLETED',
            stripeSubscriptionId: null,
          }),
        });
        const donB = await prisma.donation.create({
          data: donationFactory({
            id: 'don_scope_b',
            organizationId: ORG_ID,
            userId: 'user_scope_b',
            campaignId: campaignB.id,
            mode: 'ONE_TIME',
            cadence: 'ONCE',
            status: 'COMPLETED',
            stripeSubscriptionId: null,
          }),
        });

        await prisma.paymentEvent.create({
          data: {
            organizationId: ORG_ID,
            userId: 'user_scope_a',
            kind: 'DONATION',
            status: 'SUCCEEDED',
            amountCents: 10_000,
            currency: 'usd',
            donationId: donA.id,
            succeededAt: new Date(),
          },
        });
        await prisma.paymentEvent.create({
          data: {
            organizationId: ORG_ID,
            userId: 'user_scope_b',
            kind: 'DONATION',
            status: 'SUCCEEDED',
            amountCents: 99_999,
            currency: 'usd',
            donationId: donB.id,
            succeededAt: new Date(),
          },
        });

        const res = await request(app.getHttpServer())
          .get(`/orgs/${ORG_ID}/campaigns/${campaignId}`)
          .expect(200);

        expect(res.body.raisedCents).toBe(10_000);
        expect(res.body.donorCount).toBe(1);
      } finally {
        await prisma.paymentEvent.deleteMany({
          where: { organizationId: ORG_ID },
        });
        await prisma.donation.deleteMany({ where: { organizationId: ORG_ID } });
        await prisma.campaign
          .delete({ where: { id: campaignB.id } })
          .catch(() => {});
      }
    });

    it('DISPUTE kind nets out: signed negative DISPUTE PaymentEvent reduces raisedCents', async () => {
      const don = await prisma.donation.create({
        data: donationFactory({
          id: 'don_dispute_test',
          organizationId: ORG_ID,
          userId: 'user_dispute_1',
          campaignId,
          mode: 'ONE_TIME',
          cadence: 'ONCE',
          status: 'COMPLETED',
          stripeSubscriptionId: null,
        }),
      });

      try {
        await prisma.paymentEvent.create({
          data: {
            organizationId: ORG_ID,
            userId: 'user_dispute_1',
            kind: 'DONATION',
            status: 'SUCCEEDED',
            amountCents: 20_000,
            currency: 'usd',
            donationId: don.id,
            succeededAt: new Date(),
          },
        });
        // Dispute row — stored as negative per schema convention.
        await prisma.paymentEvent.create({
          data: {
            organizationId: ORG_ID,
            userId: 'user_dispute_1',
            kind: 'DISPUTE',
            status: 'SUCCEEDED',
            amountCents: -5_000,
            currency: 'usd',
            donationId: don.id,
            succeededAt: new Date(),
          },
        });

        const res = await request(app.getHttpServer())
          .get(`/orgs/${ORG_ID}/campaigns/${campaignId}`)
          .expect(200);

        expect(res.body.raisedCents).toBe(15_000);
      } finally {
        await prisma.paymentEvent.deleteMany({
          where: { organizationId: ORG_ID },
        });
        await prisma.donation.deleteMany({ where: { organizationId: ORG_ID } });
      }
    });

    it('donorCount counts DONATION-kind userIds only; same userId with DONATION+REFUND still counts as 1', async () => {
      // userA has both a DONATION PE and a REFUND PE — they are 1 donor, not 2.
      const don = await prisma.donation.create({
        data: donationFactory({
          id: 'don_kind_same_user',
          organizationId: ORG_ID,
          userId: 'user_kind_a',
          campaignId,
          mode: 'ONE_TIME',
          cadence: 'ONCE',
          status: 'COMPLETED',
          stripeSubscriptionId: null,
        }),
      });

      try {
        await prisma.paymentEvent.create({
          data: {
            organizationId: ORG_ID,
            userId: 'user_kind_a',
            kind: 'DONATION',
            status: 'SUCCEEDED',
            amountCents: 10_000,
            currency: 'usd',
            donationId: don.id,
            succeededAt: new Date(),
          },
        });
        await prisma.paymentEvent.create({
          data: {
            organizationId: ORG_ID,
            userId: 'user_kind_a',
            kind: 'REFUND',
            status: 'SUCCEEDED',
            amountCents: -2_000,
            currency: 'usd',
            donationId: don.id,
            succeededAt: new Date(),
          },
        });

        const res = await request(app.getHttpServer())
          .get(`/orgs/${ORG_ID}/campaigns/${campaignId}`)
          .expect(200);

        // donorCount must be 1 — the REFUND row does not inflate the count.
        expect(res.body.donorCount).toBe(1);
        // raisedCents still nets the refund.
        expect(res.body.raisedCents).toBe(8_000);
      } finally {
        await prisma.paymentEvent.deleteMany({
          where: { organizationId: ORG_ID },
        });
        await prisma.donation.deleteMany({ where: { organizationId: ORG_ID } });
      }
    });

    it('donorCount excludes a user who has only REFUND-kind SUCCEEDED events (no DONATION kind)', async () => {
      // userA has a DONATION PE; userB has ONLY a REFUND PE (admin-edited synthetic row).
      // donorCount must be 1 — userB's refund-only presence is not a donation.
      const donA = await prisma.donation.create({
        data: donationFactory({
          id: 'don_kind_donor_a',
          organizationId: ORG_ID,
          userId: 'user_kind_donor_a',
          campaignId,
          mode: 'ONE_TIME',
          cadence: 'ONCE',
          status: 'COMPLETED',
          stripeSubscriptionId: null,
        }),
      });
      const donB = await prisma.donation.create({
        data: donationFactory({
          id: 'don_kind_refund_b',
          organizationId: ORG_ID,
          userId: 'user_kind_refund_b',
          campaignId,
          mode: 'ONE_TIME',
          cadence: 'ONCE',
          status: 'COMPLETED',
          stripeSubscriptionId: null,
        }),
      });

      try {
        await prisma.paymentEvent.create({
          data: {
            organizationId: ORG_ID,
            userId: 'user_kind_donor_a',
            kind: 'DONATION',
            status: 'SUCCEEDED',
            amountCents: 5_000,
            currency: 'usd',
            donationId: donA.id,
            succeededAt: new Date(),
          },
        });
        // userB has only a REFUND row — no DONATION row.
        await prisma.paymentEvent.create({
          data: {
            organizationId: ORG_ID,
            userId: 'user_kind_refund_b',
            kind: 'REFUND',
            status: 'SUCCEEDED',
            amountCents: -1_000,
            currency: 'usd',
            donationId: donB.id,
            succeededAt: new Date(),
          },
        });

        const res = await request(app.getHttpServer())
          .get(`/orgs/${ORG_ID}/campaigns/${campaignId}`)
          .expect(200);

        // Only userA has a DONATION-kind SUCCEEDED PE; userB must not be counted.
        expect(res.body.donorCount).toBe(1);
      } finally {
        await prisma.paymentEvent.deleteMany({
          where: { organizationId: ORG_ID },
        });
        await prisma.donation.deleteMany({ where: { organizationId: ORG_ID } });
      }
    });

    it('PENDING and FAILED PaymentEvents do not contribute to raisedCents', async () => {
      const don = await prisma.donation.create({
        data: donationFactory({
          id: 'don_pending_test',
          organizationId: ORG_ID,
          userId: 'user_pending_1',
          campaignId,
          mode: 'ONE_TIME',
          cadence: 'ONCE',
          status: 'PENDING',
          stripeSubscriptionId: null,
        }),
      });

      try {
        await prisma.paymentEvent.create({
          data: {
            organizationId: ORG_ID,
            userId: 'user_pending_1',
            kind: 'DONATION',
            status: 'PENDING',
            amountCents: 5_000,
            currency: 'usd',
            donationId: don.id,
          },
        });
        await prisma.paymentEvent.create({
          data: {
            organizationId: ORG_ID,
            userId: 'user_pending_1',
            kind: 'DONATION',
            status: 'FAILED',
            amountCents: 5_000,
            currency: 'usd',
            donationId: don.id,
          },
        });

        const res = await request(app.getHttpServer())
          .get(`/orgs/${ORG_ID}/campaigns/${campaignId}`)
          .expect(200);

        expect(res.body.raisedCents).toBe(0);
        expect(res.body.donorCount).toBe(0);
      } finally {
        await prisma.paymentEvent.deleteMany({
          where: { organizationId: ORG_ID },
        });
        await prisma.donation.deleteMany({ where: { organizationId: ORG_ID } });
      }
    });

    it('activeRecurringCount counts only RECURRING+ACTIVE donations; ignores canceled and one-time', async () => {
      const donRecurringActive = await prisma.donation.create({
        data: donationFactory({
          id: 'don_arc_recurring_active',
          organizationId: ORG_ID,
          userId: 'user_arc_1',
          campaignId,
          mode: 'RECURRING',
          cadence: 'MONTHLY',
          status: 'ACTIVE',
          stripeSubscriptionId: 'sub_arc_active_1',
        }),
      });
      const donRecurringCanceled = await prisma.donation.create({
        data: donationFactory({
          id: 'don_arc_recurring_canceled',
          organizationId: ORG_ID,
          userId: 'user_arc_2',
          campaignId,
          mode: 'RECURRING',
          cadence: 'MONTHLY',
          status: 'CANCELED',
          stripeSubscriptionId: 'sub_arc_canceled_1',
          canceledAt: new Date('2025-01-01T00:00:00Z'),
        }),
      });
      const donOneTimeCompleted = await prisma.donation.create({
        data: donationFactory({
          id: 'don_arc_one_time',
          organizationId: ORG_ID,
          userId: 'user_arc_3',
          campaignId,
          mode: 'ONE_TIME',
          cadence: 'ONCE',
          status: 'COMPLETED',
          stripeSubscriptionId: null,
        }),
      });

      try {
        const res = await request(app.getHttpServer())
          .get(`/orgs/${ORG_ID}/campaigns/${campaignId}`)
          .expect(200);

        expect(res.body.activeRecurringCount).toBe(1);
      } finally {
        await prisma.donation.deleteMany({
          where: {
            id: {
              in: [
                donRecurringActive.id,
                donRecurringCanceled.id,
                donOneTimeCompleted.id,
              ],
            },
          },
        });
      }
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
        .send({
          coalitionId,
          name: 'Bad Slug',
          slug: 'Bad-Slug',
          targetAmountCents: 500,
        })
        .expect(400);
    });

    it('returns 400 when targetAmountCents is below the minimum (< 100)', async () => {
      await request(app.getHttpServer())
        .post(`/orgs/${ORG_ID}/campaigns`)
        .send({
          coalitionId,
          name: 'Cheap',
          slug: 'cheap',
          targetAmountCents: 50,
        })
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
        await prisma.coalition.deleteMany({
          where: { organizationId: OTHER_ORG },
        });
        await prisma.organization
          .delete({ where: { id: OTHER_ORG } })
          .catch(() => {});
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

      expect(res.body).toMatchObject({
        name: 'Renamed Campaign',
        displayOrder: 7,
      });
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

    it('returns 200 with description: null when null is sent to clear the field', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/orgs/${ORG_ID}/campaigns/${campaignId}`)
        .send({ description: null })
        .expect(200);

      expect(res.body.description).toBeNull();
    });

    it('clears description after a previous set: final value is null', async () => {
      await request(app.getHttpServer())
        .patch(`/orgs/${ORG_ID}/campaigns/${campaignId}`)
        .send({ description: 'Some text' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .patch(`/orgs/${ORG_ID}/campaigns/${campaignId}`)
        .send({ description: null })
        .expect(200);

      expect(res.body.description).toBeNull();
    });

    it('returns 200 with deadline: null when null is sent to clear the field', async () => {
      // First set a deadline so we can prove clearing it works.
      await request(app.getHttpServer())
        .patch(`/orgs/${ORG_ID}/campaigns/${campaignId}`)
        .send({ deadline: '2099-12-31T00:00:00.000Z' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .patch(`/orgs/${ORG_ID}/campaigns/${campaignId}`)
        .send({ deadline: null })
        .expect(200);

      expect(res.body.deadline).toBeNull();
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
      ['DRAFT', 'ACTIVE', 200] as const,
      ['DRAFT', 'ARCHIVED', 200] as const,
      ['DRAFT', 'COMPLETE', 400] as const,
      ['DRAFT', 'DRAFT', 400] as const,
      ['ACTIVE', 'COMPLETE', 200] as const,
      ['ACTIVE', 'ARCHIVED', 200] as const,
      ['ACTIVE', 'DRAFT', 400] as const,
      ['ACTIVE', 'ACTIVE', 400] as const,
      ['COMPLETE', 'ACTIVE', 200] as const,
      ['COMPLETE', 'ARCHIVED', 200] as const,
      ['COMPLETE', 'DRAFT', 400] as const,
      ['ARCHIVED', 'DRAFT', 200] as const,
      ['ARCHIVED', 'ACTIVE', 400] as const,
      ['ARCHIVED', 'COMPLETE', 400] as const,
    ])('transition %s -> %s returns %i', async (from, to, expected) => {
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
    });

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

    describe('cascade-cancel on archive', () => {
      it('ACTIVE → ARCHIVED cascades ACTIVE RECURRING donations to CANCELED; ignores ONE_TIME and pre-CANCELED', async () => {
        // Move campaign to ACTIVE so ARCHIVED transition is legal.
        await prisma.campaign.update({
          where: { id: campaignId },
          data: { status: 'ACTIVE' },
        });

        // 2 ACTIVE RECURRING donations with Stripe sub ids
        const donRecA = await prisma.donation.create({
          data: donationFactory({
            id: 'don_casc_rec_a',
            organizationId: ORG_ID,
            userId: 'user_casc_a',
            campaignId,
            mode: 'RECURRING',
            cadence: 'MONTHLY',
            status: 'ACTIVE',
            stripeSubscriptionId: 'sub_test_active_a',
          }),
        });
        const donRecB = await prisma.donation.create({
          data: donationFactory({
            id: 'don_casc_rec_b',
            organizationId: ORG_ID,
            userId: 'user_casc_b',
            campaignId,
            mode: 'RECURRING',
            cadence: 'MONTHLY',
            status: 'ACTIVE',
            stripeSubscriptionId: 'sub_test_active_b',
          }),
        });
        // 1 ACTIVE ONE_TIME donation — must be untouched
        const donOneTime = await prisma.donation.create({
          data: donationFactory({
            id: 'don_casc_one_time',
            organizationId: ORG_ID,
            userId: 'user_casc_c',
            campaignId,
            mode: 'ONE_TIME',
            cadence: 'ONCE',
            status: 'ACTIVE',
            stripeSubscriptionId: null,
          }),
        });
        // 1 pre-CANCELED RECURRING donation — must be untouched
        const donPreCanceled = await prisma.donation.create({
          data: donationFactory({
            id: 'don_casc_pre_canceled',
            organizationId: ORG_ID,
            userId: 'user_casc_d',
            campaignId,
            mode: 'RECURRING',
            cadence: 'MONTHLY',
            status: 'CANCELED',
            stripeSubscriptionId: 'sub_test_pre_canceled',
            canceledAt: new Date('2025-01-01T00:00:00Z'),
          }),
        });

        // Seed subscriptions so FakeStripeClient's subscriptions.update finds them.
        fakeStripe.seedSubscription({
          id: 'sub_test_active_a',
          customer: 'cus_casc_a',
          status: 'active',
          cancel_at_period_end: false,
          items: {
            data: [
              {
                id: 'si_a',
                price: {
                  id: 'price_a',
                  lookup_key: null,
                  product: 'prod_a',
                  unit_amount: 2500,
                  currency: 'usd',
                  active: true,
                },
                current_period_end: 9999999999,
              },
            ],
          },
        });
        fakeStripe.seedSubscription({
          id: 'sub_test_active_b',
          customer: 'cus_casc_b',
          status: 'active',
          cancel_at_period_end: false,
          items: {
            data: [
              {
                id: 'si_b',
                price: {
                  id: 'price_b',
                  lookup_key: null,
                  product: 'prod_b',
                  unit_amount: 2500,
                  currency: 'usd',
                  active: true,
                },
                current_period_end: 9999999999,
              },
            ],
          },
        });

        const beforeArchive = new Date();

        await request(app.getHttpServer())
          .post(`/orgs/${ORG_ID}/campaigns/${campaignId}/transition`)
          .send({ to: 'ARCHIVED' })
          .expect(200);

        // Campaign must be ARCHIVED
        const campaign = await prisma.campaign.findUnique({
          where: { id: campaignId },
        });
        expect(campaign?.status).toBe('ARCHIVED');

        // Both RECURRING ACTIVE donations are now CANCELED with canceledAt set
        const refreshedA = await prisma.donation.findUnique({
          where: { id: donRecA.id },
        });
        const refreshedB = await prisma.donation.findUnique({
          where: { id: donRecB.id },
        });
        expect(refreshedA?.status).toBe('CANCELED');
        expect(refreshedA?.canceledAt).not.toBeNull();
        expect(refreshedA!.canceledAt!.getTime()).toBeGreaterThanOrEqual(
          beforeArchive.getTime(),
        );
        expect(refreshedB?.status).toBe('CANCELED');
        expect(refreshedB?.canceledAt).not.toBeNull();
        expect(refreshedB!.canceledAt!.getTime()).toBeGreaterThanOrEqual(
          beforeArchive.getTime(),
        );

        // ONE_TIME donation is unchanged
        const refreshedOneTime = await prisma.donation.findUnique({
          where: { id: donOneTime.id },
        });
        expect(refreshedOneTime?.status).toBe('ACTIVE');
        expect(refreshedOneTime?.canceledAt).toBeNull();

        // Pre-CANCELED donation is unchanged
        const refreshedPreCanceled = await prisma.donation.findUnique({
          where: { id: donPreCanceled.id },
        });
        expect(refreshedPreCanceled?.status).toBe('CANCELED');
        expect(refreshedPreCanceled?.canceledAt?.toISOString()).toBe(
          '2025-01-01T00:00:00.000Z',
        );

        // Stripe was called exactly twice for subscriptions.update, each with cancel_at_period_end: true
        const stripeCalls = fakeStripe.callsFor('subscriptions.update');
        expect(stripeCalls).toHaveLength(2);
        const calledSubIds = stripeCalls.map((c) => c.args[0] as string);
        expect(calledSubIds).toEqual(
          expect.arrayContaining(['sub_test_active_a', 'sub_test_active_b']),
        );
        for (const call of stripeCalls) {
          expect(call.args[1]).toEqual({ cancel_at_period_end: true });
        }
      });

      it('idempotency: re-archiving an already-ARCHIVED campaign returns 400 and fires no additional Stripe calls', async () => {
        // Move campaign to ACTIVE then ARCHIVED
        await prisma.campaign.update({
          where: { id: campaignId },
          data: { status: 'ACTIVE' },
        });
        const donIdem = await prisma.donation.create({
          data: donationFactory({
            id: 'don_idem_rec',
            organizationId: ORG_ID,
            userId: 'user_idem_a',
            campaignId,
            mode: 'RECURRING',
            cadence: 'MONTHLY',
            status: 'ACTIVE',
            stripeSubscriptionId: 'sub_test_idem',
          }),
        });
        fakeStripe.seedSubscription({
          id: 'sub_test_idem',
          customer: 'cus_idem',
          status: 'active',
          cancel_at_period_end: false,
          items: {
            data: [
              {
                id: 'si_idem',
                price: {
                  id: 'price_idem',
                  lookup_key: null,
                  product: 'prod_idem',
                  unit_amount: 2500,
                  currency: 'usd',
                  active: true,
                },
                current_period_end: 9999999999,
              },
            ],
          },
        });

        // First archive — must succeed and fire 1 Stripe call
        await request(app.getHttpServer())
          .post(`/orgs/${ORG_ID}/campaigns/${campaignId}/transition`)
          .send({ to: 'ARCHIVED' })
          .expect(200);

        expect(fakeStripe.callsFor('subscriptions.update')).toHaveLength(1);

        // The cascade DB write must have landed: donation is now CANCELED.
        const refreshedIdem = await prisma.donation.findUnique({
          where: { id: donIdem.id },
        });
        expect(refreshedIdem?.status).toBe('CANCELED');
        expect(refreshedIdem?.canceledAt).not.toBeNull();

        // Second archive on the same campaign — must return 400 (ARCHIVED → ARCHIVED is illegal)
        await request(app.getHttpServer())
          .post(`/orgs/${ORG_ID}/campaigns/${campaignId}/transition`)
          .send({ to: 'ARCHIVED' })
          .expect(400);

        // No additional Stripe call was made
        expect(fakeStripe.callsFor('subscriptions.update')).toHaveLength(1);
      });

      it('race: concurrent archive calls cascade only once (one 200, one 409)', async () => {
        // Move campaign to ACTIVE
        await prisma.campaign.update({
          where: { id: campaignId },
          data: { status: 'ACTIVE' },
        });

        const donRaceA = await prisma.donation.create({
          data: donationFactory({
            id: 'don_race_rec_a',
            organizationId: ORG_ID,
            userId: 'user_race_a',
            campaignId,
            mode: 'RECURRING',
            cadence: 'MONTHLY',
            status: 'ACTIVE',
            stripeSubscriptionId: 'sub_test_race_a',
          }),
        });
        const donRaceB = await prisma.donation.create({
          data: donationFactory({
            id: 'don_race_rec_b',
            organizationId: ORG_ID,
            userId: 'user_race_b',
            campaignId,
            mode: 'RECURRING',
            cadence: 'MONTHLY',
            status: 'ACTIVE',
            stripeSubscriptionId: 'sub_test_race_b',
          }),
        });
        fakeStripe.seedSubscription({
          id: 'sub_test_race_a',
          customer: 'cus_race_a',
          status: 'active',
          cancel_at_period_end: false,
          items: {
            data: [
              {
                id: 'si_race_a',
                price: {
                  id: 'price_ra',
                  lookup_key: null,
                  product: 'prod_ra',
                  unit_amount: 2500,
                  currency: 'usd',
                  active: true,
                },
                current_period_end: 9999999999,
              },
            ],
          },
        });
        fakeStripe.seedSubscription({
          id: 'sub_test_race_b',
          customer: 'cus_race_b',
          status: 'active',
          cancel_at_period_end: false,
          items: {
            data: [
              {
                id: 'si_race_b',
                price: {
                  id: 'price_rb',
                  lookup_key: null,
                  product: 'prod_rb',
                  unit_amount: 2500,
                  currency: 'usd',
                  active: true,
                },
                current_period_end: 9999999999,
              },
            ],
          },
        });

        // Fire two concurrent transition requests
        const [res1, res2] = await Promise.all([
          request(app.getHttpServer())
            .post(`/orgs/${ORG_ID}/campaigns/${campaignId}/transition`)
            .send({ to: 'ARCHIVED' }),
          request(app.getHttpServer())
            .post(`/orgs/${ORG_ID}/campaigns/${campaignId}/transition`)
            .send({ to: 'ARCHIVED' }),
        ]);

        const statuses = [res1.status, res2.status].sort();
        // One must succeed (200), the other must be rejected (409)
        expect(statuses).toEqual([200, 409]);

        // Only the winner should have cascaded — exactly 2 sub ids were canceled
        // (the winner processed both donations under the campaign).
        const stripeCalls = fakeStripe.callsFor('subscriptions.update');
        expect(stripeCalls).toHaveLength(2);

        // The cascade DB writes must have landed: both donations are now CANCELED.
        const refreshedRaceA = await prisma.donation.findUnique({
          where: { id: donRaceA.id },
        });
        const refreshedRaceB = await prisma.donation.findUnique({
          where: { id: donRaceB.id },
        });
        expect(refreshedRaceA?.status).toBe('CANCELED');
        expect(refreshedRaceA?.canceledAt).not.toBeNull();
        expect(refreshedRaceB?.status).toBe('CANCELED');
        expect(refreshedRaceB?.canceledAt).not.toBeNull();
      });
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
        await prisma.campaign
          .delete({ where: { id: foreignCampaign.id } })
          .catch(() => {});
        await prisma.coalition
          .delete({ where: { id: foreignCoalition.id } })
          .catch(() => {});
        await prisma.organizationMember
          .delete({
            where: {
              organizationId_userId: {
                organizationId: OTHER_ORG,
                userId: OTHER_USER,
              },
            },
          })
          .catch(() => {});
        await prisma.organization
          .delete({ where: { id: OTHER_ORG } })
          .catch(() => {});
      }
    });
  });
});
