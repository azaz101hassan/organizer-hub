import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { EventStatus, OrganizationRole } from '@organizer-hub/db/api';
import { PrismaService } from './../src/prisma/prisma.service';
import { bootTestApp, DenyAllGuard } from './helpers/boot-test-app';
import { jsonBody } from './helpers/http';

type PublicEvent = {
  id: string;
  title: string;
  slug: string;
  organization: { name: string; slug: string };
};
type PublicList = { items: PublicEvent[]; nextCursor: string | null };

describe('PublicEvents (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let orgId: string;

  beforeAll(async () => {
    // Public routes must work without auth even when the JWT guard would deny.
    ({ app, prisma } = await bootTestApp(DenyAllGuard));
  });

  beforeEach(async () => {
    await prisma.organization.deleteMany({});
    const org = await prisma.organization.create({
      data: {
        name: 'Acme Events',
        slug: 'acme-events',
        createdBy: 'owner-sub',
        members: {
          create: { userId: 'owner-sub', role: OrganizationRole.OWNER },
        },
      },
    });
    orgId = org.id;
  });

  afterAll(async () => {
    await app.close();
  });

  async function seedEvent(input: {
    title: string;
    startsAt: Date;
    status: EventStatus;
    slug?: string;
  }): Promise<string> {
    const e = await prisma.event.create({
      data: {
        organizationId: orgId,
        title: input.title,
        slug: input.slug ?? input.title.toLowerCase().replace(/\s+/g, '-'),
        startsAt: input.startsAt,
        status: input.status,
        publishedAt: input.status === EventStatus.PUBLISHED ? new Date() : null,
        createdBy: 'owner-sub',
      },
    });
    return e.id;
  }

  function daysFromNow(days: number): Date {
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }

  describe('GET /public/events', () => {
    it('returns published upcoming events with no auth, sorted by startsAt asc', async () => {
      await seedEvent({
        title: 'Later',
        startsAt: daysFromNow(10),
        status: EventStatus.PUBLISHED,
        slug: 'later',
      });
      await seedEvent({
        title: 'Sooner',
        startsAt: daysFromNow(2),
        status: EventStatus.PUBLISHED,
        slug: 'sooner',
      });

      const res = await request(app.getHttpServer())
        .get('/public/events')
        .expect(200);
      const body = jsonBody<PublicList>(res);
      expect(body.items.map((e) => e.title)).toEqual(['Sooner', 'Later']);
      expect(body.nextCursor).toBeNull();
    });

    it('hides drafts and cancelled events', async () => {
      await seedEvent({
        title: 'Draft',
        startsAt: daysFromNow(5),
        status: EventStatus.DRAFT,
        slug: 'draft',
      });
      await seedEvent({
        title: 'Cancelled',
        startsAt: daysFromNow(5),
        status: EventStatus.CANCELLED,
        slug: 'cancelled',
      });
      await seedEvent({
        title: 'Visible',
        startsAt: daysFromNow(5),
        status: EventStatus.PUBLISHED,
        slug: 'visible',
      });

      const res = await request(app.getHttpServer())
        .get('/public/events')
        .expect(200);
      const body = jsonBody<PublicList>(res);
      expect(body.items).toHaveLength(1);
      expect(body.items[0].title).toBe('Visible');
    });

    it('hides past events', async () => {
      await seedEvent({
        title: 'Past',
        startsAt: daysFromNow(-5),
        status: EventStatus.PUBLISHED,
        slug: 'past',
      });
      await seedEvent({
        title: 'Future',
        startsAt: daysFromNow(5),
        status: EventStatus.PUBLISHED,
        slug: 'future',
      });

      const res = await request(app.getHttpServer())
        .get('/public/events')
        .expect(200);
      expect(jsonBody<PublicList>(res).items.map((e) => e.title)).toEqual([
        'Future',
      ]);
    });

    it('embeds organization name without leaking createdBy', async () => {
      await seedEvent({
        title: 'Org Embed',
        startsAt: daysFromNow(3),
        status: EventStatus.PUBLISHED,
        slug: 'org-embed',
      });

      const res = await request(app.getHttpServer())
        .get('/public/events')
        .expect(200);
      const items = jsonBody<PublicList>(res).items;
      expect(items[0].organization).toEqual({
        name: 'Acme Events',
        slug: 'acme-events',
      });
      expect(items[0]).not.toHaveProperty('createdBy');
      expect(items[0]).not.toHaveProperty('status');
      expect(items[0]).not.toHaveProperty('organizationId');
    });

    it('paginates by cursor with limit', async () => {
      for (let i = 1; i <= 5; i++) {
        await seedEvent({
          title: `Event ${i}`,
          startsAt: daysFromNow(i),
          status: EventStatus.PUBLISHED,
          slug: `event-${i}`,
        });
      }

      const page1 = await request(app.getHttpServer())
        .get('/public/events?limit=2')
        .expect(200);
      const p1 = jsonBody<PublicList>(page1);
      expect(p1.items.map((e) => e.title)).toEqual(['Event 1', 'Event 2']);
      expect(p1.nextCursor).toEqual(expect.any(String));

      const page2 = await request(app.getHttpServer())
        .get(`/public/events?limit=2&cursor=${p1.nextCursor}`)
        .expect(200);
      const p2 = jsonBody<PublicList>(page2);
      expect(p2.items.map((e) => e.title)).toEqual(['Event 3', 'Event 4']);

      const page3 = await request(app.getHttpServer())
        .get(`/public/events?limit=2&cursor=${p2.nextCursor}`)
        .expect(200);
      const p3 = jsonBody<PublicList>(page3);
      expect(p3.items.map((e) => e.title)).toEqual(['Event 5']);
      expect(p3.nextCursor).toBeNull();
    });

    it('rejects malformed cursor with 400', async () => {
      await request(app.getHttpServer())
        .get('/public/events?cursor=not-a-real-cursor')
        .expect(400);
    });
  });

  describe('GET /public/events/:id', () => {
    it('returns 200 for a published event', async () => {
      const id = await seedEvent({
        title: 'Visible',
        startsAt: daysFromNow(3),
        status: EventStatus.PUBLISHED,
        slug: 'visible',
      });
      const res = await request(app.getHttpServer())
        .get(`/public/events/${id}`)
        .expect(200);
      const body = jsonBody<PublicEvent>(res);
      expect(body.title).toBe('Visible');
      expect(body.organization.name).toBe('Acme Events');
    });

    it('returns 404 for a draft event', async () => {
      const id = await seedEvent({
        title: 'Draft',
        startsAt: daysFromNow(3),
        status: EventStatus.DRAFT,
        slug: 'draft',
      });
      await request(app.getHttpServer())
        .get(`/public/events/${id}`)
        .expect(404);
    });

    it('returns 404 for a cancelled event', async () => {
      const id = await seedEvent({
        title: 'Cancelled',
        startsAt: daysFromNow(3),
        status: EventStatus.CANCELLED,
        slug: 'cancelled',
      });
      await request(app.getHttpServer())
        .get(`/public/events/${id}`)
        .expect(404);
    });

    it('returns 404 for an unknown id', async () => {
      await request(app.getHttpServer())
        .get('/public/events/does-not-exist')
        .expect(404);
    });
  });
});
