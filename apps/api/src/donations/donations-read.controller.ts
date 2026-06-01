import {
  BadRequestException,
  Controller,
  Get,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { DonationsService } from './donations.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DonationsFeatureFlagGuard } from './donations-feature-flag.guard';

const VALID_MODES = ['ONE_TIME', 'RECURRING'] as const;
type Mode = (typeof VALID_MODES)[number];

@Controller('donations')
@UseGuards(JwtAuthGuard, DonationsFeatureFlagGuard)
export class DonationsReadController {
  constructor(private readonly donations: DonationsService) {}

  @Get('mine')
  mine(@Req() req: Request, @Query('mode') mode?: string) {
    if (mode !== undefined && !VALID_MODES.includes(mode as Mode)) {
      throw new BadRequestException('mode must be ONE_TIME or RECURRING');
    }
    const user = (req as any).user as { sub: string };
    return this.donations.listForUser({ userSub: user.sub, mode: mode as Mode | undefined });
  }
}
