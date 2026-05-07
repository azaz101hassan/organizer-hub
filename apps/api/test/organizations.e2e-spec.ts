import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from './../src/prisma/prisma.service';
import {
  bootTestApp,
  makeSubHolder,
  stubJwtAuthGuard,
} from './helpers/boot-test-app';
import { jsonBody } from './helpers/http';

type OrgView = { id: string; name: string; slug: string; role: string };

const currentSub = makeSubHolder('user-a');

describe('Organizations (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await bootTestApp(stubJwtAuthGuard(currentSub)));
  });

  beforeEach(async () => {
    await prisma.organization.deleteMany({});
    currentSub.value = 'user-a';
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /organizations', () => {
    it('creates an org and an OWNER membership atomically', async () => {
      const res = await request(app.getHttpServer())
        .post('/organizations')
        .send({ name: 'Acme Events' })
        .expect(201);

      const body = jsonBody<OrgView>(res);
      expect(body).toMatchObject({
        name: 'Acme Events',
        slug: 'acme-events',
        role: 'OWNER',
      });
      expect(body.id).toEqual(expect.any(String));

      const members = await prisma.organizationMember.findMany({
        where: { userId: 'user-a' },
      });
      expect(members).toHaveLength(1);
      expect(members[0].role).toBe('OWNER');
    });

    it('rejects empty name with 400', async () => {
      await request(app.getHttpServer())
        .post('/organizations')
        .send({ name: '' })
        .expect(400);
    });

    it('rejects unknown fields with 400 (whitelist)', async () => {
      await request(app.getHttpServer())
        .post('/organizations')
        .send({ name: 'Acme', extra: 'nope' })
        .expect(400);
    });

    it('suffixes slug on collision instead of failing', async () => {
      await request(app.getHttpServer())
        .post('/organizations')
        .send({ name: 'Acme Events' })
        .expect(201);

      currentSub.value = 'user-b';
      const res = await request(app.getHttpServer())
        .post('/organizations')
        .send({ name: 'Acme Events' })
        .expect(201);
      expect(jsonBody<OrgView>(res).slug).toMatch(/^acme-events-[0-9a-f]{4}$/);
    });
  });

  describe('GET /organizations', () => {
    it('returns only orgs the current user belongs to, with their role', async () => {
      await request(app.getHttpServer())
        .post('/organizations')
        .send({ name: 'User A Org 1' })
        .expect(201);
      await request(app.getHttpServer())
        .post('/organizations')
        .send({ name: 'User A Org 2' })
        .expect(201);

      currentSub.value = 'user-b';
      await request(app.getHttpServer())
        .post('/organizations')
        .send({ name: 'User B Org' })
        .expect(201);

      currentSub.value = 'user-a';
      const res = await request(app.getHttpServer())
        .get('/organizations')
        .expect(200);
      const orgs = jsonBody<OrgView[]>(res);
      expect(orgs).toHaveLength(2);
      expect(orgs.map((o) => o.name).sort()).toEqual([
        'User A Org 1',
        'User A Org 2',
      ]);
      for (const org of orgs) expect(org.role).toBe('OWNER');
    });
  });

  describe('GET /organizations/:id', () => {
    it('returns the org for a member', async () => {
      const created = await request(app.getHttpServer())
        .post('/organizations')
        .send({ name: 'Acme' })
        .expect(201);

      const createdBody = jsonBody<OrgView>(created);
      const res = await request(app.getHttpServer())
        .get(`/organizations/${createdBody.id}`)
        .expect(200);
      const body = jsonBody<OrgView>(res);
      expect(body.id).toBe(createdBody.id);
      expect(body.role).toBe('OWNER');
    });

    it('returns 404 (not 403) for a non-member to avoid existence leak', async () => {
      const created = await request(app.getHttpServer())
        .post('/organizations')
        .send({ name: 'Private Org' })
        .expect(201);

      currentSub.value = 'user-b';
      await request(app.getHttpServer())
        .get(`/organizations/${jsonBody<OrgView>(created).id}`)
        .expect(404);
    });

    it('returns 404 for an unknown id', async () => {
      await request(app.getHttpServer())
        .get('/organizations/does-not-exist')
        .expect(404);
    });
  });
});
