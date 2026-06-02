import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { CampaignsService } from './campaigns.service';
import { DonationsService } from './donations.service';
import { PrismaService } from '../prisma/prisma.service';

describe('CampaignsService', () => {
  let service: CampaignsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      campaign: { findUnique: jest.fn() },
      paymentEvent: {
        aggregate: jest.fn(),
        groupBy: jest.fn(),
        count: jest.fn(),
      },
    };
    // Provide a no-op stub for DonationsService — the unit tests here only
    // exercise getBySlug, which does not call cancelAllRecurringForCampaign.
    const donationsStub = {
      cancelAllRecurringForCampaign: jest.fn().mockResolvedValue({ canceled: 0, failed: 0 }),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CampaignsService,
        { provide: PrismaService, useValue: prisma },
        { provide: DonationsService, useValue: donationsStub },
      ],
    }).compile();
    service = module.get(CampaignsService);
  });

  describe('getBySlug', () => {
    const coalition = {
      id: 'coal_1',
      slug: 'coalition-one',
      name: 'Coalition One',
      organizationId: 'org_1',
      status: 'ACTIVE',
      description: null,
      coverImageUrl: null,
      displayOrder: 0,
    };

    const cmp = {
      id: 'camp_1',
      slug: 'campaign-one',
      name: 'Campaign One',
      description: 'A test campaign',
      coverImageUrl: null,
      targetAmountCents: 100_000,
      currency: 'usd',
      deadline: null,
      status: 'ACTIVE',
      organizationId: 'org_1',
      coalitionId: 'coal_1',
      coalition,
    };

    it('returns campaign + coalition + aggregates on happy path', async () => {
      prisma.campaign.findUnique.mockResolvedValue(cmp);
      prisma.paymentEvent.aggregate.mockResolvedValue({
        _sum: { amountCents: 7500 },
      });
      prisma.paymentEvent.groupBy.mockResolvedValue([
        { userId: 'user_a' },
        { userId: 'user_b' },
      ]);
      prisma.paymentEvent.count.mockResolvedValue(3);

      const result = await service.getBySlug('org_1', 'campaign-one');

      expect(result.campaign).toMatchObject({
        id: 'camp_1',
        slug: 'campaign-one',
        name: 'Campaign One',
        description: 'A test campaign',
        coverImageUrl: null,
        targetAmountCents: 100_000,
        currency: 'usd',
        deadline: null,
        status: 'ACTIVE',
        raisedCents: 7500,
        donorCount: 2,
        recentGiftCount: 3,
      });

      expect(result.coalition).toEqual({
        id: 'coal_1',
        slug: 'coalition-one',
        name: 'Coalition One',
      });
    });

    it('passes correct where clause to paymentEvent.aggregate', async () => {
      prisma.campaign.findUnique.mockResolvedValue(cmp);
      prisma.paymentEvent.aggregate.mockResolvedValue({
        _sum: { amountCents: null },
      });
      prisma.paymentEvent.groupBy.mockResolvedValue([]);
      prisma.paymentEvent.count.mockResolvedValue(0);

      await service.getBySlug('org_1', 'campaign-one');

      expect(prisma.paymentEvent.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          _sum: { amountCents: true },
          where: expect.objectContaining({
            donation: { campaignId: cmp.id },
            status: 'SUCCEEDED',
          }),
        }),
      );
    });

    it('uses paymentEvent.groupBy for donorCount with correct where clause', async () => {
      prisma.campaign.findUnique.mockResolvedValue(cmp);
      prisma.paymentEvent.aggregate.mockResolvedValue({
        _sum: { amountCents: 5000 },
      });
      prisma.paymentEvent.groupBy.mockResolvedValue([
        { userId: 'u_canceled' },
        { userId: 'u_active' },
        { userId: 'u_third' },
      ]);
      prisma.paymentEvent.count.mockResolvedValue(0);

      const result = await service.getBySlug('org_1', 'campaign-one');

      expect(prisma.paymentEvent.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          by: ['userId'],
          where: expect.objectContaining({
            donation: { campaignId: cmp.id },
            status: 'SUCCEEDED',
          }),
        }),
      );
      // donorCount is the length of the groupBy result, not filtered by donation status
      expect(result.campaign.donorCount).toBe(3);
    });

    it('returns raisedCents=0 when aggregate returns null sum', async () => {
      prisma.campaign.findUnique.mockResolvedValue(cmp);
      prisma.paymentEvent.aggregate.mockResolvedValue({
        _sum: { amountCents: null },
      });
      prisma.paymentEvent.groupBy.mockResolvedValue([]);
      prisma.paymentEvent.count.mockResolvedValue(0);

      const result = await service.getBySlug('org_1', 'campaign-one');

      expect(result.campaign.raisedCents).toBe(0);
    });

    it('throws NotFoundException on DRAFT status', async () => {
      prisma.campaign.findUnique.mockResolvedValue({ ...cmp, status: 'DRAFT' });

      await expect(
        service.getBySlug('org_1', 'campaign-one'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFoundException on ARCHIVED status', async () => {
      prisma.campaign.findUnique.mockResolvedValue({
        ...cmp,
        status: 'ARCHIVED',
      });

      await expect(
        service.getBySlug('org_1', 'campaign-one'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFoundException when slug not found', async () => {
      prisma.campaign.findUnique.mockResolvedValue(null);

      await expect(
        service.getBySlug('org_1', 'no-such-slug'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns 200 on COMPLETE status', async () => {
      prisma.campaign.findUnique.mockResolvedValue({
        ...cmp,
        status: 'COMPLETE',
      });
      prisma.paymentEvent.aggregate.mockResolvedValue({
        _sum: { amountCents: 100_000 },
      });
      prisma.paymentEvent.groupBy.mockResolvedValue([{ userId: 'user_a' }]);
      prisma.paymentEvent.count.mockResolvedValue(5);

      const result = await service.getBySlug('org_1', 'campaign-one');

      expect(result.campaign.status).toBe('COMPLETE');
      expect(result.campaign.raisedCents).toBe(100_000);
    });
  });
});
