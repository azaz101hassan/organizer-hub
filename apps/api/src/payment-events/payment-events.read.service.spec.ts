import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  DonationCadence,
  DonationMode,
  DonationStatus,
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
    await prisma.donation.deleteMany({ where: { organizationId: { startsWith: 'org_test_' } } });
    await prisma.campaign.deleteMany({ where: { organizationId: { startsWith: 'org_test_' } } });
    await prisma.coalition.deleteMany({ where: { organizationId: { startsWith: 'org_test_' } } });
    await prisma.organizationMember.deleteMany({
      where: { organizationId: { startsWith: 'org_test_' } },
    });
    await prisma.organization.deleteMany({
      where: { id: { startsWith: 'org_test_' } },
    });
  });

  afterAll(async () => prisma.$disconnect());

  // ─── Helpers ────────────────────────────────────────────────────────────────

  async function seedCampaign(orgSuffix: string, opts: { slug: string }) {
    const coalition = await prisma.coalition.create({
      data: {
        organizationId: `org_test_${orgSuffix}`,
        name: `Coalition-${opts.slug}`,
        slug: `coalition-${opts.slug}`,
      },
    });
    return prisma.campaign.create({
      data: {
        organizationId: `org_test_${orgSuffix}`,
        coalitionId: coalition.id,
        name: `Campaign-${opts.slug}`,
        slug: opts.slug,
        targetAmountCents: 100_000,
      },
    });
  }

  async function seedDonationPE(opts: {
    userId: string;
    organizationId: string;
    campaignId: string;
    mode: DonationMode;
  }) {
    const donation = await prisma.donation.create({
      data: {
        organizationId: opts.organizationId,
        userId: opts.userId,
        campaignId: opts.campaignId,
        mode: opts.mode,
        cadence: opts.mode === DonationMode.RECURRING ? DonationCadence.MONTHLY : DonationCadence.ONCE,
        amountCents: 2500,
        status: opts.mode === DonationMode.RECURRING ? DonationStatus.ACTIVE : DonationStatus.COMPLETED,
      },
    });
    return prisma.paymentEvent.create({
      data: {
        organizationId: opts.organizationId,
        userId: opts.userId,
        kind: PaymentEventKind.DONATION,
        status: PaymentEventStatus.SUCCEEDED,
        amountCents: 2500,
        currency: 'usd',
        donationId: donation.id,
      },
    });
  }

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

  it('listForUser filters by campaignId', async () => {
    await seedOrg('fid-camp');
    const campA = await seedCampaign('fid-camp', { slug: 'camp-a' });
    const campB = await seedCampaign('fid-camp', { slug: 'camp-b' });
    const peA = await seedDonationPE({
      userId: 'user_a',
      organizationId: 'org_test_fid-camp',
      campaignId: campA.id,
      mode: DonationMode.ONE_TIME,
    });
    await seedDonationPE({
      userId: 'user_a',
      organizationId: 'org_test_fid-camp',
      campaignId: campB.id,
      mode: DonationMode.ONE_TIME,
    });

    const result = await service.listForUser('user_a', { campaignId: campA.id });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe(peA.id);
  });

  it('listForUser filters by recurringOnly=true', async () => {
    await seedOrg('fid-recur');
    const camp = await seedCampaign('fid-recur', { slug: 'camp-recur' });
    await seedDonationPE({
      userId: 'user_a',
      organizationId: 'org_test_fid-recur',
      campaignId: camp.id,
      mode: DonationMode.ONE_TIME,
    });
    const peRecurring = await seedDonationPE({
      userId: 'user_a',
      organizationId: 'org_test_fid-recur',
      campaignId: camp.id,
      mode: DonationMode.RECURRING,
    });

    const result = await service.listForUser('user_a', { recurringOnly: 'true' });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe(peRecurring.id);
  });

  it('listForUser throws BadRequestException when kind is non-DONATION combined with campaignId', async () => {
    await expect(
      service.listForUser('user_a', { kind: PaymentEventKind.TICKET, campaignId: 'any' }),
    ).rejects.toThrow(BadRequestException);
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

  it('listForAdmin filters by campaignId', async () => {
    await seedOrg('admin-camp');
    await seedMember('org_test_admin-camp', 'user_admin', OrganizationRole.ADMIN);
    const campA = await seedCampaign('admin-camp', { slug: 'adm-camp-a' });
    const campB = await seedCampaign('admin-camp', { slug: 'adm-camp-b' });
    const peA = await seedDonationPE({
      userId: 'user_x',
      organizationId: 'org_test_admin-camp',
      campaignId: campA.id,
      mode: DonationMode.ONE_TIME,
    });
    await seedDonationPE({
      userId: 'user_y',
      organizationId: 'org_test_admin-camp',
      campaignId: campB.id,
      mode: DonationMode.ONE_TIME,
    });

    const result = await service.listForAdmin('user_admin', {
      organizationId: 'org_test_admin-camp',
      campaignId: campA.id,
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe(peA.id);
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
