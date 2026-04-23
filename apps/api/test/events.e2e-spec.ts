import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { MembershipRole } from '@organizer-hub/db/api';
import { PrismaService } from './../src/prisma/prisma.service';
import {
  bootTestApp,
  makeSubHolder,
  stubJwtAuthGuard,
} from './helpers/boot-test-app';

const currentSub = makeSubHolder('owner-sub');

describe('Events (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let orgId: string;
  let otherOrgId: string;

  beforeAll(async () => {
    ({ app, prisma } = await bootTestApp(stubJwtAuthGuard(currentSub)));
  });

  beforeEach(async () => {
    await prisma.organization.deleteMany({});
    currentSub.value = 'owner-sub';

    const org = await prisma.organization.create({
      data: {
        name: 'Acme',
        slug: 'acme',
        createdBy: 'owner-sub',
        memberships: {
          create: [
            { userId: 'owner-sub', role: MembershipRole.OWNER },
            { userId: 'admin-sub', role: MembershipRole.ADMIN },
            { userId: 'member-sub', role: MembershipRole.MEMBER },
          ],
        },
      },
    });
    orgId = org.id;

    const other = await prisma.organization.create({
      data: {
        name: 'Other',
        slug: 'other',
        createdBy: 'other-owner',
        memberships: {
          create: { userId: 'other-owner', role: MembershipRole.OWNER },
        },
      },
    });
    otherOrgId = other.id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /organizations/:orgId/events', () => {
    it('owner creates a draft event with auto slug', async () => {
      const res = await request(app.getHttpServer())
        .post(`/organizations/${orgId}/events`)
        .send({
          title: 'Spring Gala',
          startsAt: '2026-06-01T18:00:00.000Z',
        })
        .expect(201);
      expect(res.body).toMatchObject({
        title: 'Spring Gala',
        slug: 'spring-gala',
        status: 'DRAFT',
        publishedAt: null,
      });
    });

    it('admin can create', async () => {
      currentSub.value = 'admin-sub';
      await request(app.getHttpServer())
        .post(`/organizations/${orgId}/events`)
        .send({ title: 'Admin Event', startsAt: '2026-07-01T18:00:00.000Z' })
        .expect(201);
    });

    it('member is forbidden from creating', async () => {
      currentSub.value = 'member-sub';
      await request(app.getHttpServer())
        .post(`/organizations/${orgId}/events`)
        .send({ title: 'Nope', startsAt: '2026-07-01T18:00:00.000Z' })
        .expect(403);
    });

    it('non-member of the org gets 404 (not 403)', async () => {
      currentSub.value = 'stranger-sub';
      await request(app.getHttpServer())
        .post(`/organizations/${orgId}/events`)
        .send({ title: 'Sneaky', startsAt: '2026-07-01T18:00:00.000Z' })
        .expect(404);
    });

    it('rejects endsAt <= startsAt', async () => {
      await request(app.getHttpServer())
        .post(`/organizations/${orgId}/events`)
        .send({
          title: 'Bad Range',
          startsAt: '2026-06-01T18:00:00.000Z',
          endsAt: '2026-06-01T17:00:00.000Z',
        })
        .expect(400);
    });

    it('rejects empty title with 400', async () => {
      await request(app.getHttpServer())
        .post(`/organizations/${orgId}/events`)
        .send({ title: '', startsAt: '2026-06-01T18:00:00.000Z' })
        .expect(400);
    });

    it('rejects missing startsAt with 400', async () => {
      await request(app.getHttpServer())
        .post(`/organizations/${orgId}/events`)
        .send({ title: 'No Date' })
        .expect(400);
    });

    it('suffixes slug on collision within same org', async () => {
      await request(app.getHttpServer())
        .post(`/organizations/${orgId}/events`)
        .send({ title: 'Spring Gala', startsAt: '2026-06-01T18:00:00.000Z' })
        .expect(201);
      const res = await request(app.getHttpServer())
        .post(`/organizations/${orgId}/events`)
        .send({ title: 'Spring Gala', startsAt: '2026-06-02T18:00:00.000Z' })
        .expect(201);
      expect(res.body.slug).toMatch(/^spring-gala-[0-9a-f]{4}$/);
    });

    it('allows same slug across different orgs', async () => {
      await request(app.getHttpServer())
        .post(`/organizations/${orgId}/events`)
        .send({ title: 'Spring Gala', startsAt: '2026-06-01T18:00:00.000Z' })
        .expect(201);

      currentSub.value = 'other-owner';
      const res = await request(app.getHttpServer())
        .post(`/organizations/${otherOrgId}/events`)
        .send({ title: 'Spring Gala', startsAt: '2026-06-01T18:00:00.000Z' })
        .expect(201);
      expect(res.body.slug).toBe('spring-gala');
    });
  });

  describe('GET /organizations/:orgId/events', () => {
    it('member can list, sorted by startsAt asc', async () => {
      await request(app.getHttpServer())
        .post(`/organizations/${orgId}/events`)
        .send({ title: 'Later', startsAt: '2026-08-01T18:00:00.000Z' })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/organizations/${orgId}/events`)
        .send({ title: 'Earlier', startsAt: '2026-07-01T18:00:00.000Z' })
        .expect(201);

      currentSub.value = 'member-sub';
      const res = await request(app.getHttpServer())
        .get(`/organizations/${orgId}/events`)
        .expect(200);
      expect(res.body.map((e: { title: string }) => e.title)).toEqual([
        'Earlier',
        'Later',
      ]);
    });

    it('non-member of the org gets 404', async () => {
      currentSub.value = 'stranger-sub';
      await request(app.getHttpServer())
        .get(`/organizations/${orgId}/events`)
        .expect(404);
    });
  });

  describe('PATCH /organizations/:orgId/events/:eventId', () => {
    async function createEvent(): Promise<string> {
      const res = await request(app.getHttpServer())
        .post(`/organizations/${orgId}/events`)
        .send({ title: 'Test', startsAt: '2026-08-01T18:00:00.000Z' })
        .expect(201);
      return res.body.id;
    }

    it('owner can edit title', async () => {
      const id = await createEvent();
      const res = await request(app.getHttpServer())
        .patch(`/organizations/${orgId}/events/${id}`)
        .send({ title: 'Renamed' })
        .expect(200);
      expect(res.body.title).toBe('Renamed');
    });

    it('admin can edit', async () => {
      const id = await createEvent();
      currentSub.value = 'admin-sub';
      await request(app.getHttpServer())
        .patch(`/organizations/${orgId}/events/${id}`)
        .send({ title: 'Admin edit' })
        .expect(200);
    });

    it('member gets 403 on PATCH', async () => {
      const id = await createEvent();
      currentSub.value = 'member-sub';
      await request(app.getHttpServer())
        .patch(`/organizations/${orgId}/events/${id}`)
        .send({ title: 'Nope' })
        .expect(403);
    });

    it('publishing stamps publishedAt and flips status', async () => {
      const id = await createEvent();
      const res = await request(app.getHttpServer())
        .patch(`/organizations/${orgId}/events/${id}`)
        .send({ status: 'PUBLISHED' })
        .expect(200);
      expect(res.body.status).toBe('PUBLISHED');
      expect(res.body.publishedAt).not.toBeNull();
    });

    it('PUBLISHED → CANCELLED allowed', async () => {
      const id = await createEvent();
      await request(app.getHttpServer())
        .patch(`/organizations/${orgId}/events/${id}`)
        .send({ status: 'PUBLISHED' })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/organizations/${orgId}/events/${id}`)
        .send({ status: 'CANCELLED' })
        .expect(200);
    });

    it('CANCELLED → PUBLISHED rejected with 400', async () => {
      const id = await createEvent();
      await request(app.getHttpServer())
        .patch(`/organizations/${orgId}/events/${id}`)
        .send({ status: 'CANCELLED' })
        .expect(200);
      const res = await request(app.getHttpServer())
        .patch(`/organizations/${orgId}/events/${id}`)
        .send({ status: 'PUBLISHED' })
        .expect(400);
      expect(res.body.message).toMatch(/cancelled/i);
    });

    it('PATCH on event from a different org returns 404', async () => {
      const id = await createEvent();
      await request(app.getHttpServer())
        .patch(`/organizations/${otherOrgId}/events/${id}`)
        .send({ title: 'Cross-org' })
        .expect(404);
    });
  });
});
