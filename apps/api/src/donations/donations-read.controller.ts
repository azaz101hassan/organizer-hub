import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { DonationsService } from './donations.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard';
import { DonationsFeatureFlagGuard } from './donations-feature-flag.guard';

const VALID_MODES = ['ONE_TIME', 'RECURRING'] as const;
type Mode = (typeof VALID_MODES)[number];

@Controller('donations')
@UseGuards(JwtAuthGuard, DonationsFeatureFlagGuard)
export class DonationsReadController {
  constructor(private readonly donations: DonationsService) {}

  @Get('mine')
  mine(@CurrentUser() user: AuthenticatedUser, @Query('mode') mode?: string) {
    if (mode !== undefined && !VALID_MODES.includes(mode as Mode)) {
      throw new BadRequestException('mode must be ONE_TIME or RECURRING');
    }
    return this.donations.listForUser({ userSub: user.sub, mode: mode as Mode | undefined });
  }

  @Get('by-session/:id')
  bySession(@CurrentUser() user: AuthenticatedUser, @Param('id') sessionId: string) {
    if (sessionId.length === 0 || sessionId.length > 256) {
      throw new BadRequestException('invalid session id');
    }
    return this.donations.findBySession({ userSub: user.sub, sessionId });
  }
}
