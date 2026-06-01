import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DonationsService,
        { provide: PrismaService, useValue: prisma as any },
        { provide: StripeClient, useValue: stripe as any },
        { provide: BillingService, useValue: billing as any },
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
      webOrigin: 'https://app.test',
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
        webOrigin: 'https://app.test',
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
        webOrigin: 'https://app.test',
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
        webOrigin: 'https://app.test',
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
        webOrigin: 'https://app.test',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
