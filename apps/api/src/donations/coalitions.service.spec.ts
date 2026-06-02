import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { CoalitionsService } from './coalitions.service';
import { PrismaService } from '../prisma/prisma.service';

describe('CoalitionsService', () => {
  let service: CoalitionsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      coalition: { findMany: jest.fn(), findUnique: jest.fn() },
      campaign: { findMany: jest.fn() },
      paymentEvent: { aggregate: jest.fn(), groupBy: jest.fn() },
      $queryRaw: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CoalitionsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(CoalitionsService);
  });

  describe('listForOrg', () => {
    it('returns only ACTIVE coalitions ordered by displayOrder then name', async () => {
      const coalitions = [
        {
          id: 'coal_1',
          slug: 'first',
          name: 'Alpha',
          description: null,
          coverImageUrl: null,
          organizationId: 'org_1',
          status: 'ACTIVE',
          displayOrder: 0,
        },
        {
          id: 'coal_2',
          slug: 'second',
          name: 'Beta',
          description: 'desc',
          coverImageUrl: 'https://img.test/b.jpg',
          organizationId: 'org_1',
          status: 'ACTIVE',
          displayOrder: 1,
        },
      ];
      prisma.coalition.findMany.mockResolvedValue(coalitions);
      prisma.$queryRaw.mockResolvedValue([
        { coalition_id: 'coal_1', child_count: BigInt(2), total_raised: BigInt(5000) },
        { coalition_id: 'coal_2', child_count: BigInt(1), total_raised: BigInt(2500) },
      ]);

      const result = await service.listForOrg('org_1');

      expect(prisma.coalition.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: 'org_1', status: 'ACTIVE' },
          orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
        }),
      );

      expect(result).toEqual([
        {
          id: 'coal_1',
          slug: 'first',
          name: 'Alpha',
          description: null,
          coverImageUrl: null,
          childCampaignCount: 2,
          totalRaisedCents: 5000,
        },
        {
          id: 'coal_2',
          slug: 'second',
          name: 'Beta',
          description: 'desc',
          coverImageUrl: 'https://img.test/b.jpg',
          childCampaignCount: 1,
          totalRaisedCents: 2500,
        },
      ]);
    });

    it('returns [] when there are no coalitions (no $queryRaw call)', async () => {
      prisma.coalition.findMany.mockResolvedValue([]);

      const result = await service.listForOrg('org_empty');

      expect(result).toEqual([]);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('maps child_count from $queryRaw result without multiplication (COUNT DISTINCT contract)', async () => {
      // Simulates a coalition with 2 campaigns and payment history: the SQL
      // now uses COUNT(DISTINCT c.id) so child_count must equal the number of
      // distinct campaigns, not the join expansion factor.
      const coalitions = [
        {
          id: 'coal_distinct',
          slug: 'distinct',
          name: 'Distinct Coalition',
          description: null,
          coverImageUrl: null,
          organizationId: 'org_1',
          status: 'ACTIVE',
          displayOrder: 0,
        },
      ];
      prisma.coalition.findMany.mockResolvedValue(coalitions);
      // $queryRaw returns child_count = 2 (two distinct campaigns),
      // NOT 6 (2 campaigns × 3 payment events each) as the old COUNT(c.id) would.
      prisma.$queryRaw.mockResolvedValue([
        { coalition_id: 'coal_distinct', child_count: BigInt(2), total_raised: BigInt(30000) },
      ]);

      const result = await service.listForOrg('org_1');

      expect(result).toHaveLength(1);
      expect(result[0].childCampaignCount).toBe(2);
      expect(result[0].totalRaisedCents).toBe(30000);
    });

    it('fills 0 for coalitions absent from the stats result', async () => {
      const coalitions = [
        {
          id: 'coal_no_campaigns',
          slug: 'empty',
          name: 'Empty Coalition',
          description: null,
          coverImageUrl: null,
          organizationId: 'org_1',
          status: 'ACTIVE',
          displayOrder: 0,
        },
      ];
      prisma.coalition.findMany.mockResolvedValue(coalitions);
      // No rows returned from aggregate — coalition has no matching campaigns
      prisma.$queryRaw.mockResolvedValue([]);

      const result = await service.listForOrg('org_1');

      expect(result).toEqual([
        {
          id: 'coal_no_campaigns',
          slug: 'empty',
          name: 'Empty Coalition',
          description: null,
          coverImageUrl: null,
          childCampaignCount: 0,
          totalRaisedCents: 0,
        },
      ]);
    });
  });

  describe('getBySlug', () => {
    it('404s on ARCHIVED coalition', async () => {
      prisma.coalition.findUnique.mockResolvedValue({
        id: 'coal_arch',
        slug: 'archived',
        name: 'Archived',
        description: null,
        coverImageUrl: null,
        organizationId: 'org_1',
        status: 'ARCHIVED',
        displayOrder: 0,
      });

      await expect(service.getBySlug('org_1', 'archived')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('404s when the slug does not match', async () => {
      prisma.coalition.findUnique.mockResolvedValue(null);

      await expect(service.getBySlug('org_1', 'no-such-slug')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('returns coalition + campaign summaries with raised + donor count', async () => {
      const coalition = {
        id: 'coal_active',
        slug: 'active',
        name: 'Active Coalition',
        description: 'A great coalition',
        coverImageUrl: null,
        organizationId: 'org_1',
        status: 'ACTIVE',
        displayOrder: 0,
      };
      prisma.coalition.findUnique.mockResolvedValue(coalition);

      const campaign = {
        id: 'camp_1',
        slug: 'camp-one',
        name: 'Campaign One',
        coverImageUrl: null,
        targetAmountCents: 100_000,
        currency: 'usd',
        deadline: null,
        status: 'ACTIVE',
        coalitionId: 'coal_active',
        organizationId: 'org_1',
        displayOrder: 0,
      };
      prisma.campaign.findMany.mockResolvedValue([campaign]);

      prisma.paymentEvent.aggregate.mockResolvedValue({
        _sum: { amountCents: 7500 },
      });
      prisma.paymentEvent.groupBy.mockResolvedValue([
        { userId: 'user_a' },
        { userId: 'user_b' },
      ]);

      const result = await service.getBySlug('org_1', 'active');

      expect(result.coalition).toEqual({
        id: 'coal_active',
        slug: 'active',
        name: 'Active Coalition',
        description: 'A great coalition',
        coverImageUrl: null,
        childCampaignCount: 1,
        totalRaisedCents: 7500,
      });

      expect(result.campaigns).toEqual([
        {
          id: 'camp_1',
          slug: 'camp-one',
          name: 'Campaign One',
          coverImageUrl: null,
          targetAmountCents: 100_000,
          raisedCents: 7500,
          donorCount: 2,
          deadline: null,
          status: 'ACTIVE',
        },
      ]);

      expect(prisma.paymentEvent.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          _sum: { amountCents: true },
          where: expect.objectContaining({
            donation: { campaignId: 'camp_1' },
            status: 'SUCCEEDED',
          }),
        }),
      );

      expect(prisma.paymentEvent.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          by: ['userId'],
          where: expect.objectContaining({
            donation: { campaignId: 'camp_1' },
            status: 'SUCCEEDED',
          }),
        }),
      );
    });
  });
});
