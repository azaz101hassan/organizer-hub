import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { CampaignsService } from './campaigns.service';
import { DonationsFeatureFlagGuard } from './donations-feature-flag.guard';

@Controller('campaigns')
@UseGuards(DonationsFeatureFlagGuard)
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Get(':slug')
  get(@Req() req: Request, @Param('slug') slug: string) {
    const org = (req as any).organization as { id: string };
    return this.campaigns.getBySlug(org.id, slug);
  }
}
