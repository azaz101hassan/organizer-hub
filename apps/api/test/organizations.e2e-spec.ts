import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Request } from 'express';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { JwtAuthGuard } from './../src/auth/jwt-auth.guard';
import { PrismaService } from './../src/prisma/prisma.service';

// Holder lets each test set the "current user" the override-guard injects.
const currentSub = { value: 'user-a' };

class StubJwtAuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    req.user = { sub: currentSub.value, claims: { sub: currentSub.value } };
    return true;
  }
}

describe('Organizations (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(StubJwtAuthGuard)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    prisma = app.get(PrismaService);
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

      expect(res.body).toMatchObject({
        name: 'Acme Events',
        slug: 'acme-events',
        role: 'OWNER',
      });
      expect(res.body.id).toEqual(expect.any(String));

      const memberships = await prisma.membership.findMany({
        where: { userId: 'user-a' },
      });
      expect(memberships).toHaveLength(1);
      expect(memberships[0].role).toBe('OWNER');
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
      expect(res.body.slug).toMatch(/^acme-events-[0-9a-f]{4}$/);
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
      expect(res.body).toHaveLength(2);
      expect(res.body.map((o: { name: string }) => o.name).sort()).toEqual([
        'User A Org 1',
        'User A Org 2',
      ]);
      for (const org of res.body) expect(org.role).toBe('OWNER');
    });
  });

  describe('GET /organizations/:id', () => {
    it('returns the org for a member', async () => {
      const created = await request(app.getHttpServer())
        .post('/organizations')
        .send({ name: 'Acme' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/organizations/${created.body.id}`)
        .expect(200);
      expect(res.body.id).toBe(created.body.id);
      expect(res.body.role).toBe('OWNER');
    });

    it('returns 404 (not 403) for a non-member to avoid existence leak', async () => {
      const created = await request(app.getHttpServer())
        .post('/organizations')
        .send({ name: 'Private Org' })
        .expect(201);

      currentSub.value = 'user-b';
      await request(app.getHttpServer())
        .get(`/organizations/${created.body.id}`)
        .expect(404);
    });

    it('returns 404 for an unknown id', async () => {
      await request(app.getHttpServer())
        .get('/organizations/does-not-exist')
        .expect(404);
    });
  });
});
