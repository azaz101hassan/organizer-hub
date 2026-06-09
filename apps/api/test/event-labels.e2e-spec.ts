import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { OrganizationRole } from '@organizer-hub/db/api';
import { PrismaService } from './../src/prisma/prisma.service';
import {
  bootTestApp,
  makeSubHolder,
  stubJwtAuthGuard,
} from './helpers/boot-test-app';
import { jsonBody } from './helpers/http';

const currentSub = makeSubHolder('owner-sub');

interface LabelView {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  sortOrder: number;
  eventCount: number;
  createdAt: string;
  updatedAt: string;
}

describe('EventLabels (e2e)', () => {
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
        members: {
          create: [
            { userId: 'owner-sub', role: OrganizationRole.OWNER },
            { userId: 'admin-sub', role: OrganizationRole.ADMIN },
            { userId: 'member-sub', role: OrganizationRole.MEMBER },
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
        members: {
          create: { userId: 'other-owner', role: OrganizationRole.OWNER },
        },
      },
    });
    otherOrgId = other.id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /event-labels?organizationId=...', () => {
    it('returns empty array when no labels exist', async () => {
      const res = await request(app.getHttpServer())
        .get(`/event-labels?organizationId=${orgId}`)
        .expect(200);
      expect(jsonBody<LabelView[]>(res)).toEqual([]);
    });

    it('member can list, sorted by sortOrder asc then name asc', async () => {
      await prisma.eventLabel.createMany({
        data: [
          { organizationId: orgId, name: 'Workshops', slug: 'workshops', sortOrder: 1 },
          { organizationId: orgId, name: 'Concerts', slug: 'concerts', sortOrder: 0 },
          { organizationId: orgId, name: 'Community', slug: 'community', sortOrder: 1 },
        ],
      });

      currentSub.value = 'member-sub';
      const res = await request(app.getHttpServer())
        .get(`/event-labels?organizationId=${orgId}`)
        .expect(200);
      const names = jsonBody<LabelView[]>(res).map((l) => l.name);
      expect(names).toEqual(['Concerts', 'Community', 'Workshops']);
    });

    it('list returns eventCount 0 for unused labels', async () => {
      await prisma.eventLabel.create({
        data: { organizationId: orgId, name: 'Unused', slug: 'unused' },
      });
      const res = await request(app.getHttpServer())
        .get(`/event-labels?organizationId=${orgId}`)
        .expect(200);
      const labels = jsonBody<LabelView[]>(res);
      expect(labels).toHaveLength(1);
      expect(labels[0].eventCount).toBe(0);
    });

    it('list returns correct eventCount when events reference the label', async () => {
      const label = await prisma.eventLabel.create({
        data: { organizationId: orgId, name: 'With Events', slug: 'with-events' },
      });
      await prisma.event.createMany({
        data: [
          {
            organizationId: orgId,
            title: 'Event A',
            slug: 'event-a',
            startsAt: new Date('2026-09-01T18:00:00.000Z'),
            createdBy: 'owner-sub',
            labelId: label.id,
          },
          {
            organizationId: orgId,
            title: 'Event B',
            slug: 'event-b',
            startsAt: new Date('2026-09-02T18:00:00.000Z'),
            createdBy: 'owner-sub',
            labelId: label.id,
          },
        ],
      });
      const res = await request(app.getHttpServer())
        .get(`/event-labels?organizationId=${orgId}`)
        .expect(200);
      const labels = jsonBody<LabelView[]>(res);
      expect(labels).toHaveLength(1);
      expect(labels[0].eventCount).toBe(2);
    });

    it('non-member of the org gets 404', async () => {
      currentSub.value = 'stranger-sub';
      await request(app.getHttpServer())
        .get(`/event-labels?organizationId=${orgId}`)
        .expect(404);
    });

    it('missing organizationId query returns 400', async () => {
      await request(app.getHttpServer())
        .get('/event-labels')
        .expect(400);
    });
  });

  describe('POST /event-labels', () => {
    it('owner creates a label; returns 201 with body', async () => {
      const res = await request(app.getHttpServer())
        .post('/event-labels')
        .send({ organizationId: orgId, name: 'Concerts', slug: 'concerts' })
        .expect(201);
      expect(jsonBody<LabelView>(res)).toMatchObject({
        organizationId: orgId,
        name: 'Concerts',
        slug: 'concerts',
        sortOrder: 0,
      });
    });

    it('admin can create', async () => {
      currentSub.value = 'admin-sub';
      await request(app.getHttpServer())
        .post('/event-labels')
        .send({ organizationId: orgId, name: 'Workshops', slug: 'workshops', sortOrder: 2 })
        .expect(201);
    });

    it('member is forbidden with 403', async () => {
      currentSub.value = 'member-sub';
      await request(app.getHttpServer())
        .post('/event-labels')
        .send({ organizationId: orgId, name: 'Nope', slug: 'nope' })
        .expect(403);
    });

    it('non-member gets 404', async () => {
      currentSub.value = 'stranger-sub';
      await request(app.getHttpServer())
        .post('/event-labels')
        .send({ organizationId: orgId, name: 'Sneaky', slug: 'sneaky' })
        .expect(404);
    });

    it('duplicate (orgId, slug) returns 409', async () => {
      await request(app.getHttpServer())
        .post('/event-labels')
        .send({ organizationId: orgId, name: 'Concerts', slug: 'concerts' })
        .expect(201);
      await request(app.getHttpServer())
        .post('/event-labels')
        .send({ organizationId: orgId, name: 'Live Music', slug: 'concerts' })
        .expect(409);
    });

    it('same slug is allowed across different orgs', async () => {
      await request(app.getHttpServer())
        .post('/event-labels')
        .send({ organizationId: orgId, name: 'Concerts', slug: 'concerts' })
        .expect(201);
      currentSub.value = 'other-owner';
      await request(app.getHttpServer())
        .post('/event-labels')
        .send({ organizationId: otherOrgId, name: 'Concerts', slug: 'concerts' })
        .expect(201);
    });

    it('rejects empty name with 400', async () => {
      await request(app.getHttpServer())
        .post('/event-labels')
        .send({ organizationId: orgId, name: '', slug: 'x' })
        .expect(400);
    });

    it('rejects name longer than 60 chars with 400', async () => {
      await request(app.getHttpServer())
        .post('/event-labels')
        .send({ organizationId: orgId, name: 'a'.repeat(61), slug: 'long' })
        .expect(400);
    });

    it('rejects invalid slug (uppercase) with 400', async () => {
      await request(app.getHttpServer())
        .post('/event-labels')
        .send({ organizationId: orgId, name: 'Concerts', slug: 'Concerts' })
        .expect(400);
    });

    it('rejects slug starting with a hyphen with 400', async () => {
      await request(app.getHttpServer())
        .post('/event-labels')
        .send({ organizationId: orgId, name: 'Concerts', slug: '-concerts' })
        .expect(400);
    });

    it('missing organizationId body returns 400', async () => {
      await request(app.getHttpServer())
        .post('/event-labels')
        .send({ name: 'Orphan', slug: 'orphan' })
        .expect(400);
    });
  });

  describe('PATCH /event-labels/:id', () => {
    async function createLabel(
      data: { name: string; slug: string; sortOrder?: number } = {
        name: 'Concerts',
        slug: 'concerts',
      },
    ): Promise<string> {
      const label = await prisma.eventLabel.create({
        data: { organizationId: orgId, sortOrder: 0, ...data },
      });
      return label.id;
    }

    it('owner renames a label; sortOrder change persists', async () => {
      const id = await createLabel();
      const res = await request(app.getHttpServer())
        .patch(`/event-labels/${id}`)
        .send({ name: 'Live Music', sortOrder: 5 })
        .expect(200);
      expect(jsonBody<LabelView>(res)).toMatchObject({
        name: 'Live Music',
        slug: 'concerts',
        sortOrder: 5,
      });
    });

    it('admin can update', async () => {
      const id = await createLabel();
      currentSub.value = 'admin-sub';
      await request(app.getHttpServer())
        .patch(`/event-labels/${id}`)
        .send({ name: 'Updated' })
        .expect(200);
    });

    it('member 403 on update', async () => {
      const id = await createLabel();
      currentSub.value = 'member-sub';
      await request(app.getHttpServer())
        .patch(`/event-labels/${id}`)
        .send({ name: 'Nope' })
        .expect(403);
    });

    it('returns 404 when caller has no membership in the label owning org', async () => {
      const foreignLabel = await prisma.eventLabel.create({
        data: { organizationId: otherOrgId, name: 'Foreign', slug: 'foreign' },
      });
      // owner-sub is not a member of otherOrgId — same shape as RolesGuard 404.
      await request(app.getHttpServer())
        .patch(`/event-labels/${foreignLabel.id}`)
        .send({ name: 'Should Not' })
        .expect(404);
    });

    it('returns 404 for a non-existent label id', async () => {
      await request(app.getHttpServer())
        .patch('/event-labels/clxxxxxxxxxxxxxxxxxxxxxxx')
        .send({ name: 'Nope' })
        .expect(404);
    });

    it('rename to a slug already in use returns 409', async () => {
      const idA = await createLabel({ name: 'Concerts', slug: 'concerts' });
      await createLabel({ name: 'Workshops', slug: 'workshops' });
      await request(app.getHttpServer())
        .patch(`/event-labels/${idA}`)
        .send({ slug: 'workshops' })
        .expect(409);
    });
  });

  describe('DELETE /event-labels/:id', () => {
    async function createLabel(slug = 'concerts'): Promise<string> {
      const label = await prisma.eventLabel.create({
        data: { organizationId: orgId, name: 'Concerts', slug },
      });
      return label.id;
    }

    it('owner deletes when no events reference it; 204', async () => {
      const id = await createLabel();
      await request(app.getHttpServer())
        .delete(`/event-labels/${id}`)
        .expect(204);
      const after = await prisma.eventLabel.findUnique({ where: { id } });
      expect(after).toBeNull();
    });

    it('admin can delete', async () => {
      const id = await createLabel('admin-del');
      currentSub.value = 'admin-sub';
      await request(app.getHttpServer())
        .delete(`/event-labels/${id}`)
        .expect(204);
    });

    it('member 403 on delete', async () => {
      const id = await createLabel('member-del');
      currentSub.value = 'member-sub';
      await request(app.getHttpServer())
        .delete(`/event-labels/${id}`)
        .expect(403);
    });

    it('returns 409 with eventCount when an event references the label', async () => {
      const id = await createLabel();
      await prisma.event.create({
        data: {
          organizationId: orgId,
          title: 'Linked',
          slug: 'linked',
          startsAt: new Date('2026-09-01T18:00:00.000Z'),
          createdBy: 'owner-sub',
          labelId: id,
        },
      });
      const res = await request(app.getHttpServer())
        .delete(`/event-labels/${id}`)
        .expect(409);
      expect(jsonBody<{ message: unknown; eventCount: number }>(res).eventCount).toBe(1);
    });

    it('returns 404 when caller has no membership in the label owning org', async () => {
      const foreignLabel = await prisma.eventLabel.create({
        data: { organizationId: otherOrgId, name: 'Foreign', slug: 'foreign' },
      });
      await request(app.getHttpServer())
        .delete(`/event-labels/${foreignLabel.id}`)
        .expect(404);
    });
  });
});
