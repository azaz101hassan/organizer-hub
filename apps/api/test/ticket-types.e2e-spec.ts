import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { OrganizationRole, TicketSource } from '@organizer-hub/db/api';
import { StripeClient } from './../src/billing/stripe.client';
import { PrismaService } from './../src/prisma/prisma.service';
import {
  bootTestApp,
  makeSubHolder,
  stubJwtAuthGuard,
} from './helpers/boot-test-app';
import { FakeStripeClient } from './helpers/fake-stripe';
import { FUTURE_EVENT_DATE } from './helpers/dates';
import { jsonBody } from './helpers/http';

type TicketTypeView = {
  id: string;
  name: string;
  priceCents: number;
  minTierLevel: number;
  cap: number | null;
  issuedCount: number;
  stripeProductId: string;
  stripePriceId: string;
};
type PublicTicketTypeView = Omit<
  TicketTypeView,
  'stripeProductId' | 'stripePriceId'
>;

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
    // Tickets reference ticket_types with ON DELETE RESTRICT, so they must be
    // cleared first or the ticketType deleteMany throws P2003.
    await prisma.ticket.deleteMany({});
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
        startsAt: FUTURE_EVENT_DATE,
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
        startsAt: FUTURE_EVENT_DATE,
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

      const body = jsonBody<TicketTypeView>(res);
      expect(body).toMatchObject({
        name: 'GA',
        priceCents: 5000,
        minTierLevel: 1,
      });
      expect(body.stripeProductId).toMatch(/^prod_test_/);
      expect(body.stripePriceId).toMatch(/^price_test_/);

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
      const createdBody = jsonBody<TicketTypeView>(created);
      const oldPriceId = createdBody.stripePriceId;

      const res = await request(app.getHttpServer())
        .patch(
          `/organizations/${orgId}/events/${eventId}/ticket-types/${createdBody.id}`,
        )
        .send({ priceCents: 7500 })
        .expect(200);

      const updated = jsonBody<TicketTypeView>(res);
      expect(updated.priceCents).toBe(7500);
      expect(updated.stripePriceId).not.toBe(oldPriceId);

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
          `/organizations/${orgId}/events/${eventId}/ticket-types/${jsonBody<TicketTypeView>(created).id}`,
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
          `/organizations/${orgId}/events/${eventId}/ticket-types/${jsonBody<TicketTypeView>(created).id}`,
        )
        .expect(204);

      const rows = await prisma.ticketType.findMany({ where: { eventId } });
      expect(rows).toHaveLength(0);

      const productUpdates = fakeStripe.callsFor('products.update');
      expect(productUpdates.at(-1)?.args[1]).toMatchObject({ active: false });
    });
  });

  describe('Capacity (cap) — Phase 4 U1 (R1, R17)', () => {
    async function createType(
      body: Record<string, unknown>,
    ): Promise<TicketTypeView> {
      const res = await request(app.getHttpServer())
        .post(`/organizations/${orgId}/events/${eventId}/ticket-types`)
        .send(body)
        .expect(201);
      return jsonBody<TicketTypeView>(res);
    }

    it('creates a ticket type with a cap and round-trips it (issuedCount 0)', async () => {
      const created = await createType({
        name: 'GA',
        priceCents: 5000,
        cap: 10,
      });
      expect(created.cap).toBe(10);
      expect(created.issuedCount).toBe(0);

      const res = await request(app.getHttpServer())
        .get(`/organizations/${orgId}/events/${eventId}/ticket-types`)
        .expect(200);
      const list = jsonBody<TicketTypeView[]>(res);
      expect(list[0].cap).toBe(10);
      expect(list[0].issuedCount).toBe(0);
    });

    it('defaults cap to null when omitted', async () => {
      const created = await createType({ name: 'GA', priceCents: 5000 });
      expect(created.cap).toBeNull();
    });

    it('sets cap null→5 then clears it 5→null', async () => {
      const created = await createType({ name: 'GA', priceCents: 5000 });
      expect(created.cap).toBeNull();

      const setRes = await request(app.getHttpServer())
        .patch(
          `/organizations/${orgId}/events/${eventId}/ticket-types/${created.id}`,
        )
        .send({ cap: 5 })
        .expect(200);
      expect(jsonBody<TicketTypeView>(setRes).cap).toBe(5);

      const clearRes = await request(app.getHttpServer())
        .patch(
          `/organizations/${orgId}/events/${eventId}/ticket-types/${created.id}`,
        )
        .send({ cap: null })
        .expect(200);
      expect(jsonBody<TicketTypeView>(clearRes).cap).toBeNull();
    });

    it('rejects cap=0 and cap=-1 with 400', async () => {
      await request(app.getHttpServer())
        .post(`/organizations/${orgId}/events/${eventId}/ticket-types`)
        .send({ name: 'GA', priceCents: 5000, cap: 0 })
        .expect(400);
      await request(app.getHttpServer())
        .post(`/organizations/${orgId}/events/${eventId}/ticket-types`)
        .send({ name: 'GA', priceCents: 5000, cap: -1 })
        .expect(400);
    });

    it('permits setting cap below issuedCount; view exposes issuedCount and no tickets are revoked (R17)', async () => {
      const created = await createType({ name: 'GA', priceCents: 5000 });
      await prisma.ticket.createMany({
        data: Array.from({ length: 5 }, () => ({
          userId: 'buyer-sub',
          eventId,
          ticketTypeId: created.id,
          source: TicketSource.MEMBERSHIP_CLAIM,
        })),
      });

      const res = await request(app.getHttpServer())
        .patch(
          `/organizations/${orgId}/events/${eventId}/ticket-types/${created.id}`,
        )
        .send({ cap: 3 })
        .expect(200);
      const body = jsonBody<TicketTypeView>(res);
      expect(body.cap).toBe(3);
      expect(body.issuedCount).toBe(5);

      const remaining = await prisma.ticket.count({
        where: { ticketTypeId: created.id },
      });
      expect(remaining).toBe(5);
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

      const list = jsonBody<PublicTicketTypeView[]>(res);
      expect(list).toHaveLength(1);
      const { id, ...rest } = list[0];
      expect(id).toEqual(expect.any(String));
      expect(rest).toEqual({
        name: 'GA',
        priceCents: 5000,
        minTierLevel: 2,
      });
      expect(list[0]).not.toHaveProperty('stripeProductId');
      expect(list[0]).not.toHaveProperty('stripePriceId');
    });
  });

  describe('Event.membersExcluded toggle (AE3)', () => {
    it('owner PATCHes event with membersExcluded=true and the row reflects it', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/organizations/${orgId}/events/${eventId}`)
        .send({ membersExcluded: true })
        .expect(200);

      expect(jsonBody<{ membersExcluded: boolean }>(res).membersExcluded).toBe(
        true,
      );

      const row = await prisma.event.findUnique({ where: { id: eventId } });
      expect(row?.membersExcluded).toBe(true);
    });
  });
});
