import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DonationsService } from './donations.service';
import { PrismaService } from '../prisma/prisma.service';
import { StripeClient } from '../billing/stripe.client';
import { BillingService } from '../billing/billing.service';
import { campaignFactory, coalitionFactory } from '../../test/factories';

describe('DonationsService (one-time)', () => {
  let service: DonationsService;
  let prisma: { campaign: any; donation: any; organization: any };
  let stripe: { stripe: { checkout: { sessions: { create: jest.Mock } } } };
  let billing: { getOrCreateStripeCustomer: jest.Mock };
  let config: ConfigService;

  beforeEach(async () => {
    prisma = {
      campaign: { findUnique: jest.fn() },
      donation: { create: jest.fn(), update: jest.fn() },
      organization: { findUnique: jest.fn() },
    };
    stripe = {
      stripe: {
        checkout: {
          sessions: {
            create: jest.fn().mockResolvedValue({ id: 'cs_test_1', url: 'https://stripe.test/cs_test_1' }),
          },
        },
      },
    };
    billing = {
      getOrCreateStripeCustomer: jest.fn().mockResolvedValue({ stripeCustomerId: 'cus_test_1' }),
    };
    config = { get: jest.fn().mockReturnValue('https://app.test') } as unknown as ConfigService;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DonationsService,
        { provide: PrismaService, useValue: prisma as any },
        { provide: StripeClient, useValue: stripe as any },
        { provide: BillingService, useValue: billing as any },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    service = module.get(DonationsService);
  });

  it('creates a PENDING Donation row and returns the Stripe URL for a one-time gift', async () => {
    prisma.campaign.findUnique.mockResolvedValue({
      ...campaignFactory({ id: 'camp_1', organizationId: 'org_1', status: 'ACTIVE', currency: 'usd' }),
      coalition: coalitionFactory({ id: 'coal_1', organizationId: 'org_1' }),
    });
    prisma.donation.create.mockResolvedValue({ id: 'don_1' });

    const result = await service.createCheckoutSession({
      userSub: 'user_1',
      userEmail: 'donor@test',
      campaignId: 'camp_1',
      cadence: 'ONCE',
      amountCents: 2500,
    });

    expect(result).toEqual({ url: 'https://stripe.test/cs_test_1', donationId: 'don_1' });

    expect(prisma.donation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user_1',
          campaignId: 'camp_1',
          mode: 'ONE_TIME',
          cadence: 'ONCE',
          amountCents: 2500,
          status: 'PENDING',
        }),
      }),
    );

    expect(stripe.stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'payment',
        customer: 'cus_test_1',
        client_reference_id: 'user_1',
        metadata: expect.objectContaining({
          source: 'donation',
          userId: 'user_1',
          donationId: 'don_1',
          campaignId: 'camp_1',
        }),
        line_items: [
          expect.objectContaining({
            quantity: 1,
            price_data: expect.objectContaining({
              currency: 'usd',
              unit_amount: 2500,
              product_data: expect.objectContaining({ name: expect.stringContaining('Donation') }),
            }),
          }),
        ],
      }),
    );
  });

  it('rejects amount below $1.00', async () => {
    prisma.campaign.findUnique.mockResolvedValue({
      ...campaignFactory({ id: 'camp_1', organizationId: 'org_1', status: 'ACTIVE' }),
      coalition: coalitionFactory({ id: 'coal_1', organizationId: 'org_1' }),
    });
    await expect(
      service.createCheckoutSession({
        userSub: 'user_1',
        userEmail: 'donor@test',
        campaignId: 'camp_1',
        cadence: 'ONCE',
        amountCents: 99,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects amount above $10,000.00 (fat-finger guard)', async () => {
    prisma.campaign.findUnique.mockResolvedValue({
      ...campaignFactory({ id: 'camp_1', organizationId: 'org_1', status: 'ACTIVE' }),
      coalition: coalitionFactory({ id: 'coal_1', organizationId: 'org_1' }),
    });
    await expect(
      service.createCheckoutSession({
        userSub: 'user_1',
        userEmail: 'donor@test',
        campaignId: 'camp_1',
        cadence: 'ONCE',
        amountCents: 1_000_001,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects ONCE cadence on a campaign that is not ACTIVE', async () => {
    prisma.campaign.findUnique.mockResolvedValue({
      ...campaignFactory({ id: 'camp_1', organizationId: 'org_1', status: 'DRAFT' }),
      coalition: coalitionFactory({ id: 'coal_1', organizationId: 'org_1' }),
    });
    await expect(
      service.createCheckoutSession({
        userSub: 'user_1',
        userEmail: 'donor@test',
        campaignId: 'camp_1',
        cadence: 'ONCE',
        amountCents: 2500,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects ONCE on a campaign whose deadline has passed', async () => {
    prisma.campaign.findUnique.mockResolvedValue({
      ...campaignFactory({
        id: 'camp_1',
        organizationId: 'org_1',
        status: 'ACTIVE',
        deadline: new Date(Date.now() - 86_400_000), // yesterday
      }),
      coalition: coalitionFactory({ id: 'coal_1', organizationId: 'org_1' }),
    });
    await expect(
      service.createCheckoutSession({
        userSub: 'user_1',
        userEmail: 'donor@test',
        campaignId: 'camp_1',
        cadence: 'ONCE',
        amountCents: 2500,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('DonationsService (recurring)', () => {
  let service: DonationsService;
  let prisma: { campaign: any; donation: any; organization: any };
  let stripe: { stripe: { checkout: { sessions: { create: jest.Mock } } } };
  let billing: { getOrCreateStripeCustomer: jest.Mock };
  let config: ConfigService;

  beforeEach(async () => {
    prisma = {
      campaign: { findUnique: jest.fn() },
      donation: { create: jest.fn(), update: jest.fn() },
      organization: { findUnique: jest.fn() },
    };
    stripe = {
      stripe: {
        checkout: {
          sessions: {
            create: jest.fn().mockResolvedValue({ id: 'cs_test_2', url: 'https://stripe.test/cs_test_2' }),
          },
        },
      },
    };
    billing = {
      getOrCreateStripeCustomer: jest.fn().mockResolvedValue({ stripeCustomerId: 'cus_test_1' }),
    };
    config = { get: jest.fn().mockReturnValue('https://app.test') } as unknown as ConfigService;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DonationsService,
        { provide: PrismaService, useValue: prisma as any },
        { provide: StripeClient, useValue: stripe as any },
        { provide: BillingService, useValue: billing as any },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    service = module.get(DonationsService);
  });

  const setupCampaign = () => {
    prisma.campaign.findUnique.mockResolvedValue({
      ...campaignFactory({ id: 'camp_1', organizationId: 'org_1', status: 'ACTIVE', currency: 'usd' }),
      coalition: coalitionFactory({ id: 'coal_1', organizationId: 'org_1' }),
    });
    prisma.donation.create.mockResolvedValue({ id: 'don_2' });
  };

  it('maps MONTHLY to interval=month, interval_count=1', async () => {
    setupCampaign();
    await service.createCheckoutSession({
      userSub: 'user_1',
      userEmail: 'donor@test',
      campaignId: 'camp_1',
      cadence: 'MONTHLY',
      amountCents: 2500,
    });
    expect(stripe.stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'subscription',
        line_items: [
          expect.objectContaining({
            price_data: expect.objectContaining({
              recurring: { interval: 'month', interval_count: 1 },
            }),
          }),
        ],
        subscription_data: expect.objectContaining({
          metadata: expect.objectContaining({ source: 'donation' }),
        }),
      }),
    );
    expect(prisma.donation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ mode: 'RECURRING', cadence: 'MONTHLY' }) }),
    );
  });

  it('maps QUARTERLY to interval=month, interval_count=3', async () => {
    setupCampaign();
    await service.createCheckoutSession({
      userSub: 'user_1',
      userEmail: 'donor@test',
      campaignId: 'camp_1',
      cadence: 'QUARTERLY',
      amountCents: 2500,
    });
    expect(stripe.stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: [
          expect.objectContaining({
            price_data: expect.objectContaining({
              recurring: { interval: 'month', interval_count: 3 },
            }),
          }),
        ],
      }),
    );
  });

  it('maps YEARLY to interval=year, interval_count=1', async () => {
    setupCampaign();
    await service.createCheckoutSession({
      userSub: 'user_1',
      userEmail: 'donor@test',
      campaignId: 'camp_1',
      cadence: 'YEARLY',
      amountCents: 2500,
    });
    expect(stripe.stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: [
          expect.objectContaining({
            price_data: expect.objectContaining({
              recurring: { interval: 'year', interval_count: 1 },
            }),
          }),
        ],
      }),
    );
  });
});

describe('DonationsService (cancel)', () => {
  let service: DonationsService;
  let prisma: { campaign: any; donation: any; organization: any };
  let stripe: { stripe: any };
  let billing: { getOrCreateStripeCustomer: jest.Mock };
  let config: ConfigService;

  beforeEach(async () => {
    prisma = {
      campaign: { findUnique: jest.fn() },
      donation: { create: jest.fn(), update: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
      organization: { findUnique: jest.fn() },
    };
    stripe = {
      stripe: {
        checkout: {
          sessions: {
            create: jest.fn().mockResolvedValue({ id: 'cs_test_3', url: 'https://stripe.test/cs_test_3' }),
          },
        },
        subscriptions: { update: jest.fn().mockResolvedValue({}) },
      },
    };
    billing = {
      getOrCreateStripeCustomer: jest.fn().mockResolvedValue({ stripeCustomerId: 'cus_test_1' }),
    };
    config = { get: jest.fn().mockReturnValue('https://app.test') } as unknown as ConfigService;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DonationsService,
        { provide: PrismaService, useValue: prisma as any },
        { provide: StripeClient, useValue: stripe as any },
        { provide: BillingService, useValue: billing as any },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    service = module.get(DonationsService);
  });

  it('returns 404 (NotFoundException) when the donation belongs to another user', async () => {
    prisma.donation.findUnique.mockResolvedValue({
      id: 'don_1', userId: 'user_other', mode: 'RECURRING', status: 'ACTIVE',
      stripeSubscriptionId: 'sub_1',
    });
    await expect(service.cancel({ userSub: 'user_1', donationId: 'don_1' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns 409 (ConflictException) when the donation is not ACTIVE', async () => {
    prisma.donation.findUnique.mockResolvedValue({
      id: 'don_1', userId: 'user_1', mode: 'RECURRING', status: 'COMPLETED',
      stripeSubscriptionId: 'sub_1',
    });
    await expect(service.cancel({ userSub: 'user_1', donationId: 'don_1' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('returns 409 when the donation is not RECURRING', async () => {
    prisma.donation.findUnique.mockResolvedValue({
      id: 'don_1', userId: 'user_1', mode: 'ONE_TIME', status: 'ACTIVE',
      stripeSubscriptionId: null,
    });
    await expect(service.cancel({ userSub: 'user_1', donationId: 'don_1' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('schedules cancel-at-period-end on Stripe and flips Donation to CANCELED optimistically', async () => {
    prisma.donation.findUnique.mockResolvedValue({
      id: 'don_1', userId: 'user_1', mode: 'RECURRING', status: 'ACTIVE',
      stripeSubscriptionId: 'sub_1',
    });
    prisma.donation.update.mockResolvedValue({ id: 'don_1', status: 'CANCELED' });

    const result = await service.cancel({ userSub: 'user_1', donationId: 'don_1' });
    expect(result).toEqual({ status: 'canceled' });
    expect((stripe.stripe.subscriptions.update as jest.Mock)).toHaveBeenCalledWith('sub_1', { cancel_at_period_end: true });
    expect(prisma.donation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'don_1' },
        data: expect.objectContaining({ status: 'CANCELED', canceledAt: expect.any(Date) }),
      }),
    );
  });
});

describe('DonationsService.listForUser', () => {
  let service: DonationsService;
  let prisma: { campaign: any; donation: any; organization: any };

  beforeEach(async () => {
    prisma = {
      campaign: { findUnique: jest.fn() },
      donation: { create: jest.fn(), update: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
      organization: { findUnique: jest.fn() },
    };
    const stripe = {
      stripe: {
        checkout: { sessions: { create: jest.fn() } },
        subscriptions: { update: jest.fn() },
      },
    };
    const billing = {
      getOrCreateStripeCustomer: jest.fn(),
    };
    const config = { get: jest.fn() } as unknown as ConfigService;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DonationsService,
        { provide: PrismaService, useValue: prisma as any },
        { provide: StripeClient, useValue: stripe as any },
        { provide: BillingService, useValue: billing as any },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    service = module.get(DonationsService);
  });

  const EXPECTED_INCLUDE = {
    campaign: {
      select: {
        id: true,
        slug: true,
        name: true,
        coalition: { select: { id: true, slug: true, name: true } },
      },
    },
  };

  it('calls findMany with the correct where, orderBy, and include shape', async () => {
    prisma.donation.findMany.mockResolvedValue([]);
    await service.listForUser({ userSub: 'user_1', mode: 'ONE_TIME' });
    expect(prisma.donation.findMany).toHaveBeenCalledWith({
      where: { userId: 'user_1', mode: 'ONE_TIME' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: EXPECTED_INCLUDE,
    });
  });

  it('omits mode from where when mode is not provided', async () => {
    prisma.donation.findMany.mockResolvedValue([]);
    await service.listForUser({ userSub: 'user_1' });
    expect(prisma.donation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user_1' } }),
    );
    const call = prisma.donation.findMany.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(Object.keys(call.where)).not.toContain('mode');
  });

  it('includes mode in where when mode is provided', async () => {
    prisma.donation.findMany.mockResolvedValue([]);
    await service.listForUser({ userSub: 'user_1', mode: 'RECURRING' });
    expect(prisma.donation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user_1', mode: 'RECURRING' } }),
    );
  });

  it('returns the array from findMany without transformation', async () => {
    const rows = [{ id: 'don_1', userId: 'user_1', mode: 'ONE_TIME' }];
    prisma.donation.findMany.mockResolvedValue(rows);
    const result = await service.listForUser({ userSub: 'user_1' });
    expect(result).toBe(rows);
  });
});
