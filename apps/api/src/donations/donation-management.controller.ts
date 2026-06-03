import { Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { DonationsService } from './donations.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

// Cancel is placed under a separate controller because the route prefix
// (/billing/donation/) differs from the checkout controller (/billing/checkout/).
@Controller('billing/donation')
@UseGuards(JwtAuthGuard)
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
