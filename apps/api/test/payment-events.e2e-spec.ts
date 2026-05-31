import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { OrganizationRole, PaymentEventKind, PaymentEventStatus } from '@organizer-hub/db/api';
import { PrismaService } from './../src/prisma/prisma.service';
import {
  bootTestApp,
  makeSubHolder,
  stubJwtAuthGuard,
} from './helpers/boot-test-app';
import { jsonBody } from './helpers/http';

const currentSub = makeSubHolder('user-a');

interface PEView {
  id: string;
  organizationId: string;
  userId: string;
  kind: string;
  status: string;
  amountCents: number;
  currency: string;
}

interface PEListPage {
  items: PEView[];
  nextCursor: string | null;
}

describe('PaymentEvents (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let orgId: string;

  beforeAll(async () => {
    ({ app, prisma } = await bootTestApp(stubJwtAuthGuard(currentSub)));
  });

  beforeEach(async () => {
    await prisma.organization.deleteMany({});
    currentSub.value = 'user-a';

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
            { userId: 'user-a', role: OrganizationRole.MEMBER },
            { userId: 'user-b', role: OrganizationRole.MEMBER },
          ],
        },
      },
    });
    orgId = org.id;
  });

  afterAll(async () => {
    await app.close();
  });

  // Helper to create a minimal PaymentEvent row.
  async function createPE(
    userId: string,
    overrides: Partial<{
      kind: PaymentEventKind;
      status: PaymentEventStatus;
      amountCents: number;
    }> = {},
  ) {
    return prisma.paymentEvent.create({
      data: {
        organizationId: orgId,
        userId,
        kind: overrides.kind ?? PaymentEventKind.TICKET,
        status: overrides.status ?? PaymentEventStatus.SUCCEEDED,
        amountCents: overrides.amountCents ?? 1000,
        currency: 'usd',
      },
    });
  }

  describe('GET /payment-events (user-scoped)', () => {
    it('returns only the calling user own rows', async () => {
      const peA = await createPE('user-a');
      await createPE('user-b');

      currentSub.value = 'user-a';
      const res = await request(app.getHttpServer())
        .get('/payment-events')
        .expect(200);

      const body = jsonBody<PEListPage>(res);
      expect(body.items).toHaveLength(1);
      expect(body.items[0].id).toBe(peA.id);
      expect(body.items[0].userId).toBe('user-a');
    });
  });

  describe('GET /payment-events?organizationId=...', () => {
    it('returns 404 for a caller with no membership in the org', async () => {
      currentSub.value = 'stranger-sub';
      await request(app.getHttpServer())
        .get(`/payment-events?organizationId=${orgId}`)
        .expect(404);
    });

    it('returns 403 when caller is a MEMBER (not OWNER/ADMIN)', async () => {
      currentSub.value = 'member-sub';
      await request(app.getHttpServer())
        .get(`/payment-events?organizationId=${orgId}`)
        .expect(403);
    });

    it('returns rows for the org when caller is an ADMIN', async () => {
      await createPE('user-a');
      await createPE('user-b');

      currentSub.value = 'admin-sub';
      const res = await request(app.getHttpServer())
        .get(`/payment-events?organizationId=${orgId}`)
        .expect(200);

      const body = jsonBody<PEListPage>(res);
      expect(body.items).toHaveLength(2);
      expect(body.items.every((i) => i.organizationId === orgId)).toBe(true);
    });
  });

  describe('GET /payment-events/:id', () => {
    it('returns 404 when caller is not the owner and not an admin', async () => {
      const pe = await createPE('user-b');

      currentSub.value = 'user-a'; // member but not owner of this PE
      await request(app.getHttpServer())
        .get(`/payment-events/${pe.id}`)
        .expect(404);
    });

    it('returns the row when caller is the owner', async () => {
      const pe = await createPE('user-a');

      currentSub.value = 'user-a';
      const res = await request(app.getHttpServer())
        .get(`/payment-events/${pe.id}`)
        .expect(200);

      expect(jsonBody<PEView>(res).id).toBe(pe.id);
    });

    it('returns the row when caller is an admin of the org', async () => {
      const pe = await createPE('user-b');

      currentSub.value = 'admin-sub';
      const res = await request(app.getHttpServer())
        .get(`/payment-events/${pe.id}`)
        .expect(200);

      expect(jsonBody<PEView>(res).id).toBe(pe.id);
    });
  });

  describe('GET /transactions.csv', () => {
    it('returns 400 when organizationId is missing', async () => {
      currentSub.value = 'admin-sub';
      await request(app.getHttpServer())
        .get('/transactions.csv')
        .expect(400);
    });

    it('returns text/csv with header + one data row per PE', async () => {
      await createPE('user-a');
      await createPE('user-b');

      currentSub.value = 'admin-sub';
      const res = await request(app.getHttpServer())
        .get(`/transactions.csv?organizationId=${orgId}`)
        .expect(200);

      expect(res.headers['content-type']).toMatch(/text\/csv/);
      const lines = (res.text as string)
        .split('\n')
        .filter((l) => l.trim() !== '');
      // First line is the header; remaining lines are data rows.
      expect(lines[0]).toContain('id');
      expect(lines[0]).toContain('kind');
      expect(lines[0]).toContain('amountCents');
      // Two PE rows seeded.
      expect(lines.length - 1).toBe(2);
    });
  });
});
