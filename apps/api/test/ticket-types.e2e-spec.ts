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
} from './helpers/boot-test-app';
import { FakeStripeClient } from './helpers/fake-stripe';

const currentSub = makeSubHolder('owner-sub');

describe('TicketTypes (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let fakeStripe: FakeStripeClient;
  let orgId: string;
  let otherOrgId: string;
  let eventId: string;
  let otherEventId: string;

  beforeAll(async () => {
    fakeStripe = new FakeStripeClient();
    ({ app, prisma } = await bootTestApp(stubJwtAuthGuard(currentSub), [
      { token: StripeClient, useValue: fakeStripe },
    ]));
  });

  beforeEach(async () => {
    await prisma.ticketType.deleteMany({});
    await prisma.organization.deleteMany({});
    fakeStripe.reset();
    currentSub.value = 'owner-sub';

    const org = await prisma.organization.create({
      data: {
        name: 'Acme',
        slug: 'acme',
        createdBy: 'owner-sub',
        members: {
          create: [
            { userId: 'owner-sub', role: OrganizationRole.OWNER },
            { userId: 'admin-sub', role: OrganizationRole.ADMIN },
            { userId: 'member-sub', role: OrganizationRole.MEMBER },
            { userId: 'outsider-sub', role: OrganizationRole.MEMBER }, // member of *some* org but not :orgId
          ],
        },
      },
    });
    orgId = org.id;

    const event = await prisma.event.create({
      data: {
        organizationId: orgId,
        title: 'Spring Gala',
        slug: 'spring-gala',
        startsAt: new Date('2026-06-01T18:00:00Z'),
        createdBy: 'owner-sub',
      },
    });
    eventId = event.id;

    const other = await prisma.organization.create({
      data: {
        name: 'Other',
        slug: 'other',
        createdBy: 'other-owner',
        members: {
          create: { userId: 'other-owner', role: OrganizationRole.OWNER },
        },
      },
    });
    otherOrgId = other.id;
    const otherEvent = await prisma.event.create({
      data: {
        organizationId: otherOrgId,
        title: 'Other Gala',
        slug: 'other-gala',
        startsAt: new Date('2026-06-01T18:00:00Z'),
        createdBy: 'other-owner',
      },
    });
    otherEventId = otherEvent.id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /organizations/:orgId/events/:eventId/ticket-types', () => {
    it('owner creates a ticket type and mirrors to Stripe', async () => {
      const res = await request(app.getHttpServer())
        .post(`/organizations/${orgId}/events/${eventId}/ticket-types`)
        .send({ name: 'GA', priceCents: 5000, minTierLevel: 1 })
        .expect(201);

      expect(res.body).toMatchObject({
        name: 'GA',
        priceCents: 5000,
        minTierLevel: 1,
      });
      expect(res.body.stripeProductId).toMatch(/^prod_test_/);
      expect(res.body.stripePriceId).toMatch(/^price_test_/);

      expect(fakeStripe.callsFor('products.create')).toHaveLength(1);
      expect(fakeStripe.callsFor('prices.create')).toHaveLength(1);
    });

    it('rejects MEMBER with 403', async () => {
      currentSub.value = 'member-sub';
      await request(app.getHttpServer())
        .post(`/organizations/${orgId}/events/${eventId}/ticket-types`)
        .send({ name: 'GA', priceCents: 5000 })
        .expect(403);
      expect(fakeStripe.callsFor('products.create')).toHaveLength(0);
    });

    it('rejects bad payload (negative priceCents) with 400', async () => {
      await request(app.getHttpServer())
        .post(`/organizations/${orgId}/events/${eventId}/ticket-types`)
        .send({ name: 'GA', priceCents: -1 })
        .expect(400);
    });

    it('cross-org guard: orgId + foreign eventId returns 404 (no Stripe call)', async () => {
      await request(app.getHttpServer())
        .post(`/organizations/${orgId}/events/${otherEventId}/ticket-types`)
        .send({ name: 'GA', priceCents: 5000 })
        .expect(404);
      expect(fakeStripe.callsFor('products.create')).toHaveLength(0);
    });
  });

  describe('GET /organizations/:orgId/events/:eventId/ticket-types', () => {
    it('member can list', async () => {
      // Seed via service helper through OWNER first.
      await request(app.getHttpServer())
        .post(`/organizations/${orgId}/events/${eventId}/ticket-types`)
        .send({ name: 'GA', priceCents: 5000 })
        .expect(201);

      currentSub.value = 'member-sub';
      const res = await request(app.getHttpServer())
        .get(`/organizations/${orgId}/events/${eventId}/ticket-types`)
        .expect(200);
      expect(res.body).toHaveLength(1);
    });

    it('non-member of the org gets 404 (hide-existence)', async () => {
      currentSub.value = 'someone-else';
      await request(app.getHttpServer())
        .get(`/organizations/${orgId}/events/${eventId}/ticket-types`)
        .expect(404);
    });
  });

  describe('PATCH /organizations/:orgId/events/:eventId/ticket-types/:typeId', () => {
    it('archives old Stripe Price and creates a new one when priceCents changes', async () => {
      const created = await request(app.getHttpServer())
        .post(`/organizations/${orgId}/events/${eventId}/ticket-types`)
        .send({ name: 'GA', priceCents: 5000 })
        .expect(201);
      const oldPriceId = created.body.stripePriceId;

      const res = await request(app.getHttpServer())
        .patch(
          `/organizations/${orgId}/events/${eventId}/ticket-types/${created.body.id}`,
        )
        .send({ priceCents: 7500 })
        .expect(200);

      expect(res.body.priceCents).toBe(7500);
      expect(res.body.stripePriceId).not.toBe(oldPriceId);

      const updateCalls = fakeStripe.callsFor('prices.update');
      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0].args[0]).toBe(oldPriceId);
      expect(updateCalls[0].args[1]).toMatchObject({ active: false });

      const createCalls = fakeStripe.callsFor('prices.create');
      expect(createCalls).toHaveLength(2);
    });

    it('updates Stripe Product name when display name changes', async () => {
      const created = await request(app.getHttpServer())
        .post(`/organizations/${orgId}/events/${eventId}/ticket-types`)
        .send({ name: 'GA', priceCents: 5000 })
        .expect(201);

      await request(app.getHttpServer())
        .patch(
          `/organizations/${orgId}/events/${eventId}/ticket-types/${created.body.id}`,
        )
        .send({ name: 'General Admission' })
        .expect(200);

      const updateCalls = fakeStripe.callsFor('products.update');
      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0].args[1]).toMatchObject({
        name: 'Spring Gala — General Admission',
      });
    });
  });

  describe('DELETE /organizations/:orgId/events/:eventId/ticket-types/:typeId', () => {
    it('archives Stripe Product and deletes the local row', async () => {
      const created = await request(app.getHttpServer())
        .post(`/organizations/${orgId}/events/${eventId}/ticket-types`)
        .send({ name: 'GA', priceCents: 5000 })
        .expect(201);

      await request(app.getHttpServer())
        .delete(
          `/organizations/${orgId}/events/${eventId}/ticket-types/${created.body.id}`,
        )
        .expect(204);

      const rows = await prisma.ticketType.findMany({ where: { eventId } });
      expect(rows).toHaveLength(0);

      const productUpdates = fakeStripe.callsFor('products.update');
      expect(productUpdates.at(-1)?.args[1]).toMatchObject({ active: false });
    });
  });

  describe('GET /public/events/:eventId/ticket-types', () => {
    it('anonymous read returns local fields only, no Stripe IDs', async () => {
      await request(app.getHttpServer())
        .post(`/organizations/${orgId}/events/${eventId}/ticket-types`)
        .send({ name: 'GA', priceCents: 5000, minTierLevel: 2 })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/public/events/${eventId}/ticket-types`)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toEqual({
        id: expect.any(String),
        name: 'GA',
        priceCents: 5000,
        minTierLevel: 2,
      });
      expect(res.body[0]).not.toHaveProperty('stripeProductId');
      expect(res.body[0]).not.toHaveProperty('stripePriceId');
    });
  });

  describe('Event.membersExcluded toggle (AE3)', () => {
    it('owner PATCHes event with membersExcluded=true and the row reflects it', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/organizations/${orgId}/events/${eventId}`)
        .send({ membersExcluded: true })
        .expect(200);

      expect(res.body.membersExcluded).toBe(true);

      const row = await prisma.event.findUnique({ where: { id: eventId } });
      expect(row?.membersExcluded).toBe(true);
    });
  });
});
