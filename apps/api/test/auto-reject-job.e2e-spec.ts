import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  OrganizationRole,
  TicketRequestIntent,
  TicketRequestStatus,
} from '@organizer-hub/db/api';
import { Mailer } from './../src/mail/mailer';
import { PrismaService } from './../src/prisma/prisma.service';
import {
  AUTO_REJECT_BATCH_LIMIT,
  AutoRejectJob,
} from './../src/scheduler/auto-reject.job';
import { CLOCK } from './../src/scheduler/clock';
import {
  bootTestApp,
  makeSubHolder,
  stubJwtAuthGuard,
} from './helpers/boot-test-app';
import { FakeMailer } from './helpers/fake-mailer';

// Fixed, advanceable now() so the `startsAt <= now` sweep boundary is
// deterministic regardless of wall clock. Tests seed event startsAt relative to
// NOW below.
class FakeClock {
  constructor(private t: Date) {}
  now(): Date {
    return this.t;
  }
  set(d: Date): void {
    this.t = d;
  }
}

const NOW = new Date('2026-06-15T12:00:00Z');
const PAST = new Date('2026-06-01T00:00:00Z'); // <= NOW → eligible to auto-reject
const FUTURE = new Date('2027-01-01T00:00:00Z'); // > NOW → never swept

const REQUESTER = 'buyer-1';
const REQUESTER_EMAIL = 'buyer@example.com';

// Tiny batch limit so a 3-row fixture exercises the multi-loop sweep path.
const TEST_BATCH_LIMIT = 2;

describe('Auto-reject scheduler (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let fakeMailer: FakeMailer;
  const clock = new FakeClock(NOW);
  const currentSub = makeSubHolder('owner-sub');
  let seq = 0;

  beforeAll(async () => {
    fakeMailer = new FakeMailer();
    ({ app, prisma } = await bootTestApp(stubJwtAuthGuard(currentSub), [
      { token: Mailer, useValue: fakeMailer },
      { token: CLOCK, useValue: clock },
      { token: AUTO_REJECT_BATCH_LIMIT, useValue: TEST_BATCH_LIMIT },
    ]));
  });

  beforeEach(async () => {
    await prisma.ticketRequestAudit.deleteMany({});
    await prisma.ticket.deleteMany({});
    await prisma.ticketRequest.deleteMany({});
    await prisma.ticketType.deleteMany({});
    await prisma.organization.deleteMany({});
    fakeMailer.reset();
    clock.set(NOW);
    currentSub.value = 'owner-sub';
  });

  afterAll(async () => {
    await app.close();
  });

  function job(): AutoRejectJob {
    return app.get(AutoRejectJob);
  }

  // Seed an org + event (at `startsAt`) + capped tier + one TicketRequest.
  // owner-sub is the OWNER so the AE15 race test can drive a real admin approve.
  async function seedRequest(opts: {
    startsAt: Date;
    status?: TicketRequestStatus;
    intent?: TicketRequestIntent;
    userId?: string;
    userEmail?: string | null;
  }): Promise<{ orgId: string; eventId: string; requestId: string }> {
    const n = seq++;
    const org = await prisma.organization.create({
      data: {
        name: `Org ${n}`,
        slug: `org-${n}`,
        createdBy: 'owner-sub',
        members: {
          create: { userId: 'owner-sub', role: OrganizationRole.OWNER },
        },
      },
    });
    const event = await prisma.event.create({
      data: {
        organizationId: org.id,
        title: `Event ${n}`,
        slug: `event-${n}`,
        startsAt: opts.startsAt,
        createdBy: 'owner-sub',
      },
    });
    const tt = await prisma.ticketType.create({
      data: {
        eventId: event.id,
        name: 'GA',
        priceCents: 5000,
        cap: 1,
        stripeProductId: `prod_${n}`,
        stripePriceId: `price_${n}`,
      },
    });
    const req = await prisma.ticketRequest.create({
      data: {
        userId: opts.userId ?? REQUESTER,
        userEmail:
          opts.userEmail === undefined ? REQUESTER_EMAIL : opts.userEmail,
        userName: 'Ada',
        ticketTypeId: tt.id,
        eventId: event.id,
        intent: opts.intent ?? TicketRequestIntent.MEMBERSHIP_CLAIM,
        status: opts.status ?? TicketRequestStatus.PENDING,
      },
    });
    return { orgId: org.id, eventId: event.id, requestId: req.id };
  }

  function statusOf(id: string): Promise<TicketRequestStatus | undefined> {
    return prisma.ticketRequest
      .findUnique({ where: { id } })
      .then((r) => r?.status);
  }

  it('rejects a PENDING request whose event has started, emails, writes no audit (AE9)', async () => {
    const { requestId } = await seedRequest({ startsAt: PAST });

    const result = await job().run();

    expect(result.rejectedCount).toBe(1);
    expect(await statusOf(requestId)).toBe(TicketRequestStatus.REJECTED);

    const mail = fakeMailer.lastOf('rejected');
    expect(mail?.to).toBe(REQUESTER_EMAIL);
    // Scheduler auto-reject carries no admin reason (types.ts contract).
    expect(mail?.props.reason ?? null).toBeNull();

    // Scheduler is not an admin → no audit row (R7/AE9).
    expect(await prisma.ticketRequestAudit.count()).toBe(0);
  });

  it('leaves a PENDING request whose event is in the future untouched', async () => {
    const { requestId } = await seedRequest({ startsAt: FUTURE });

    const result = await job().run();

    expect(result.rejectedCount).toBe(0);
    expect(await statusOf(requestId)).toBe(TicketRequestStatus.PENDING);
    expect(fakeMailer.sent).toHaveLength(0);
  });

  it('is idempotent — a second sweep does not re-reject or re-email', async () => {
    const { requestId } = await seedRequest({ startsAt: PAST });

    await job().run();
    fakeMailer.reset();

    const second = await job().run();

    expect(second.rejectedCount).toBe(0);
    expect(await statusOf(requestId)).toBe(TicketRequestStatus.REJECTED);
    expect(fakeMailer.sent).toHaveLength(0);
  });

  it('skips non-PENDING requests on a started event', async () => {
    const { requestId } = await seedRequest({
      startsAt: PAST,
      status: TicketRequestStatus.APPROVED,
    });

    const result = await job().run();

    expect(result.rejectedCount).toBe(0);
    expect(await statusOf(requestId)).toBe(TicketRequestStatus.APPROVED);
  });

  it('still rejects when the requester has no email on file (best-effort mail)', async () => {
    const { requestId } = await seedRequest({
      startsAt: PAST,
      userEmail: null,
    });

    const result = await job().run();

    expect(result.rejectedCount).toBe(1);
    expect(await statusOf(requestId)).toBe(TicketRequestStatus.REJECTED);
    expect(fakeMailer.sent).toHaveLength(0);
  });

  it('processes a batch larger than the limit across loops', async () => {
    // Three eligible PENDING requests, distinct users so the partial unique
    // index never trips; TEST_BATCH_LIMIT is 2 → forces a second loop.
    const seeded = await Promise.all([
      seedRequest({
        startsAt: PAST,
        userId: 'u1',
        userEmail: 'u1@example.com',
      }),
      seedRequest({
        startsAt: PAST,
        userId: 'u2',
        userEmail: 'u2@example.com',
      }),
      seedRequest({
        startsAt: PAST,
        userId: 'u3',
        userEmail: 'u3@example.com',
      }),
    ]);

    const result = await job().run();

    expect(result.rejectedCount).toBe(3);
    for (const s of seeded) {
      expect(await statusOf(s.requestId)).toBe(TicketRequestStatus.REJECTED);
    }
    expect(fakeMailer.sent).toHaveLength(3);
  });

  it('admin approve racing the sweep yields exactly one terminal state (AE15)', async () => {
    const { orgId, requestId } = await seedRequest({ startsAt: PAST });

    // Drive a real admin approve concurrently with the sweep. The CAS +
    // FOR UPDATE SKIP LOCKED guarantee one winner: either APPROVED (with a
    // linked Ticket) or REJECTED (no Ticket) — never both.
    await Promise.all([
      request(app.getHttpServer())
        .post(`/orgs/${orgId}/requests/${requestId}/approve`)
        .then((r) => r.status)
        .catch(() => 0),
      job().run(),
    ]);

    const status = await statusOf(requestId);
    const ticketCount = await prisma.ticket.count({
      where: { ticketRequestId: requestId },
    });

    expect([
      TicketRequestStatus.APPROVED,
      TicketRequestStatus.REJECTED,
    ]).toContain(status);
    if (status === TicketRequestStatus.APPROVED) {
      expect(ticketCount).toBe(1);
    } else {
      expect(ticketCount).toBe(0);
    }
  });
});
