import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  OrganizationRole,
  PaymentEventKind,
  PaymentEventStatus,
} from '@organizer-hub/db/api';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentEventsReadService } from './payment-events.read.service';

// These tests run against the real api_db to verify cursor-pagination, role
// gating, and org-scoping under actual Prisma/Postgres semantics.
describe('PaymentEventsReadService', () => {
  let service: PaymentEventsReadService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [PaymentEventsReadService, PrismaService],
    }).compile();
    service = mod.get(PaymentEventsReadService);
    prisma = mod.get(PrismaService);

    // Clean up in FK-safe order
    await prisma.paymentEvent.deleteMany();
    await prisma.organizationMember.deleteMany({
      where: { organizationId: { startsWith: 'org_test_' } },
    });
    await prisma.organization.deleteMany({
      where: { id: { startsWith: 'org_test_' } },
    });
  });

  afterAll(async () => prisma.$disconnect());

  // ─── Helpers ────────────────────────────────────────────────────────────────

  async function seedOrg(suffix: string) {
    return prisma.organization.create({
      data: {
        id: `org_test_${suffix}`,
        slug: `test-org-${suffix}`,
        name: `Test ${suffix}`,
        createdBy: 'user_seed',
      },
    });
  }

  async function seedMember(
    organizationId: string,
    userId: string,
    role: OrganizationRole,
  ) {
    return prisma.organizationMember.create({
      data: { organizationId, userId, role },
    });
  }

  async function seedPaymentEvent(
    overrides: Partial<{
      userId: string;
      organizationId: string;
      kind: PaymentEventKind;
      status: PaymentEventStatus;
      amountCents: number;
      currency: string;
    }> = {},
  ) {
    return prisma.paymentEvent.create({
      data: {
        userId: overrides.userId ?? 'user_a',
        organizationId: overrides.organizationId ?? 'org_test_default',
        kind: overrides.kind ?? PaymentEventKind.TICKET,
        status: overrides.status ?? PaymentEventStatus.SUCCEEDED,
        amountCents: overrides.amountCents ?? 1000,
        currency: overrides.currency ?? 'usd',
      },
    });
  }

  // ─── listForUser ────────────────────────────────────────────────────────────

  it('listForUser returns only the caller\'s rows', async () => {
    await seedPaymentEvent({ userId: 'user_a', organizationId: 'org_house_000000000000000001' });
    await seedPaymentEvent({ userId: 'user_b', organizationId: 'org_house_000000000000000001' });

    const result = await service.listForUser('user_a', {});
    expect(result.items).toHaveLength(1);
    expect(result.items[0].userId).toBe('user_a');
  });

  it('listForUser filters by kind', async () => {
    await seedPaymentEvent({ userId: 'user_a', kind: PaymentEventKind.TICKET });
    await seedPaymentEvent({ userId: 'user_a', kind: PaymentEventKind.REFUND });

    const result = await service.listForUser('user_a', { kind: PaymentEventKind.REFUND });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].kind).toBe(PaymentEventKind.REFUND);
  });

  it('listForUser paginates with cursor', async () => {
    for (let i = 0; i < 25; i++) {
      await seedPaymentEvent({ userId: 'user_a' });
    }

    const result = await service.listForUser('user_a', { limit: 10 });
    expect(result.items).toHaveLength(10);
    expect(result.nextCursor).toBeTruthy();
  });

  // ─── listForAdmin ────────────────────────────────────────────────────────────

  it('listForAdmin throws ForbiddenException when organizationId is missing', async () => {
    await expect(service.listForAdmin('user_a', {})).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('listForAdmin throws NotFoundException for non-member', async () => {
    await seedOrg('non-member');

    await expect(
      service.listForAdmin('user_a', { organizationId: 'org_test_non-member' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('listForAdmin throws ForbiddenException for MEMBER role', async () => {
    await seedOrg('member-role');
    await seedMember('org_test_member-role', 'user_a', OrganizationRole.MEMBER);

    await expect(
      service.listForAdmin('user_a', { organizationId: 'org_test_member-role' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('listForAdmin returns rows for an ADMIN', async () => {
    await seedOrg('admin-list');
    await seedMember('org_test_admin-list', 'user_admin', OrganizationRole.ADMIN);
    await seedPaymentEvent({ organizationId: 'org_test_admin-list', userId: 'user_x' });
    await seedPaymentEvent({ organizationId: 'org_test_admin-list', userId: 'user_y' });

    const result = await service.listForAdmin('user_admin', {
      organizationId: 'org_test_admin-list',
    });
    expect(result.items).toHaveLength(2);
  });

  // ─── getDetail ───────────────────────────────────────────────────────────────

  it('getDetail returns own row', async () => {
    const row = await seedPaymentEvent({ userId: 'user_a' });

    const view = await service.getDetail('user_a', row.id);
    expect(view.id).toBe(row.id);
    expect(view.userId).toBe('user_a');
  });

  it('getDetail returns NotFoundException for non-owner non-admin', async () => {
    await seedOrg('get-detail');
    const row = await seedPaymentEvent({
      userId: 'user_a',
      organizationId: 'org_test_get-detail',
    });

    // user_b has no membership in org_test_get-detail
    await expect(service.getDetail('user_b', row.id)).rejects.toThrow(
      NotFoundException,
    );
  });

  // ─── adminStream ─────────────────────────────────────────────────────────────

  it('adminStream yields all rows', async () => {
    await seedOrg('stream');
    await seedMember('org_test_stream', 'user_admin', OrganizationRole.ADMIN);
    for (let i = 0; i < 5; i++) {
      await seedPaymentEvent({
        organizationId: 'org_test_stream',
        userId: 'user_x',
      });
    }

    const views: unknown[] = [];
    for await (const v of service.adminStream('user_admin', 'org_test_stream', {})) {
      views.push(v);
    }
    expect(views).toHaveLength(5);
  });
});
