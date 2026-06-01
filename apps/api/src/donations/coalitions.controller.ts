import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { CoalitionsService } from './coalitions.service';
import { DonationsFeatureFlagGuard } from './donations-feature-flag.guard';

@Controller('coalitions')
@UseGuards(DonationsFeatureFlagGuard)
export class CoalitionsController {
  constructor(private readonly coalitions: CoalitionsService) {}

  @Get()
  list(@Req() req: Request) {
    const org = (req as any).organization as { id: string };
    return this.coalitions.listForOrg(org.id);
  }

  @Get(':slug')
  get(@Req() req: Request, @Param('slug') slug: string) {
    const org = (req as any).organization as { id: string };
    return this.coalitions.getBySlug(org.id, slug);
  }
}
