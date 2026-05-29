import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { OrganizationRole } from '@organizer-hub/db/api';
import { PrismaService } from './../src/prisma/prisma.service';
import { SseTokenService } from './../src/realtime/sse-token.service';
import { WaitlistStream } from './../src/realtime/waitlist-stream';
import {
  bootTestApp,
  makeSubHolder,
  stubJwtAuthGuard,
} from './helpers/boot-test-app';
import { jsonBody } from './helpers/http';

describe('SSE stream + query-token auth (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let port: number;
  const currentSub = makeSubHolder('owner-sub');

  let orgId: string;
  let otherOrgId: string;

  beforeAll(async () => {
    ({ app, prisma } = await bootTestApp(stubJwtAuthGuard(currentSub)));
    // A bound port so the happy-path test can read the open SSE stream over a
    // raw http client (supertest buffers to end-of-response, which never comes
    // for a live stream).
    await app.listen(0);
    const server = app.getHttpServer() as unknown as http.Server;
    port = (server.address() as AddressInfo).port;
  });

  beforeEach(async () => {
    await prisma.ticketRequest.deleteMany({});
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
        createdBy: 'someone',
        members: {
          create: { userId: 'someone', role: OrganizationRole.OWNER },
        },
      },
    });
    otherOrgId = other.id;
  });

  afterAll(async () => {
    await app.close();
  });

  function mintReq(targetOrg: string) {
    return request(app.getHttpServer()).post(
      `/orgs/${targetOrg}/requests/stream-token`,
    );
  }

  it('mints a token for an OWNER and streams an emitted event to the connection (R15, R23)', async () => {
    const res = await mintReq(orgId).expect(201);
    const token = jsonBody<{ token: string }>(res).token;
    expect(token).toMatch(/^[0-9a-f]{64}$/);

    const hub = app.get(WaitlistStream);

    const chunk = await new Promise<string>((resolve, reject) => {
      const req = http.get(
        {
          host: '127.0.0.1',
          port,
          path: `/orgs/${orgId}/requests/stream?token=${token}`,
        },
        (res) => {
          if (res.statusCode !== 200) {
            reject(new Error(`unexpected status ${res.statusCode}`));
            return;
          }
          res.setEncoding('utf8');
          // Emit repeatedly until a frame arrives — the RxJS subscription
          // (which acquires the org channel) activates a tick after headers.
          const emitTimer = setInterval(() => {
            hub.emit(orgId, {
              type: 'request.created',
              id: 'req-1',
              data: { id: 'req-1' },
            });
          }, 20);
          res.on('data', (d: string) => {
            if (d.includes('request.created')) {
              clearInterval(emitTimer);
              req.destroy();
              resolve(d);
            }
          });
        },
      );
      req.on('error', reject);
      setTimeout(() => {
        req.destroy();
        reject(new Error('SSE read timed out'));
      }, 4000);
    });

    expect(chunk).toContain('request.created');
    expect(chunk).toContain('req-1');
  });

  it('returns 401 when connecting with no token, before any stream opens (R23)', async () => {
    await request(app.getHttpServer())
      .get(`/orgs/${orgId}/requests/stream`)
      .expect(401);
  });

  it('returns 401 when reconnecting with an already-burned token (single-use)', async () => {
    const res = await mintReq(orgId).expect(201);
    const token = jsonBody<{ token: string }>(res).token;

    // Burn it through the same path the guard uses.
    expect(app.get(SseTokenService).verifyAndBurn(token)).toMatchObject({
      orgId,
    });

    await request(app.getHttpServer())
      .get(`/orgs/${orgId}/requests/stream?token=${token}`)
      .expect(401);
  });

  it('returns 401 for a token minted for another org (org isolation, R23)', async () => {
    const res = await mintReq(orgId).expect(201);
    const token = jsonBody<{ token: string }>(res).token;
    await request(app.getHttpServer())
      .get(`/orgs/${otherOrgId}/requests/stream?token=${token}`)
      .expect(401);
  });

  it('denies the mint endpoint to a MEMBER (403) and a non-member (404)', async () => {
    currentSub.value = 'member-sub';
    await mintReq(orgId).expect(403);

    currentSub.value = 'stranger';
    await mintReq(orgId).expect(404);
  });

  // Runs last: prior successful mints share this throttle window, so firing a
  // burst well over the limit reliably trips 429 regardless of prior usage.
  it('throttles the mint endpoint', async () => {
    currentSub.value = 'owner-sub';
    const statuses: number[] = [];
    for (let i = 0; i < 20; i++) {
      const res = await mintReq(orgId);
      statuses.push(res.status);
    }
    expect(statuses).toContain(429);
  });
});
