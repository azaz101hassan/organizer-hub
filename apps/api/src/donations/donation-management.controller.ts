import { Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { DonationsService } from './donations.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DonationsFeatureFlagGuard } from './donations-feature-flag.guard';

// Cancel is placed under a separate controller because the route prefix
// (/billing/donation/) differs from the checkout controller (/billing/checkout/).
// DonationsFeatureFlagGuard is kept here intentionally: if an org turns off the
// donations flag, donors will 404 on cancel until an admin re-enables it. This
// matches the plan's literal intent; a future phase can strip the flag guard
// from management routes if that UX is unacceptable.
@Controller('billing/donation')
@UseGuards(JwtAuthGuard, DonationsFeatureFlagGuard)
export class DonationManagementController {
  constructor(private readonly donations: DonationsService) {}

  @Post(':id/cancel')
  async cancel(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<{ status: 'canceled' }> {
    const user = (req as any).user as { sub: string };
    return this.donations.cancel({ userSub: user.sub, donationId: id });
  }
}
