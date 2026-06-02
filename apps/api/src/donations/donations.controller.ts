import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { DonationsService } from './donations.service';
import { CreateDonationCheckoutDto } from './dto/create-donation-checkout.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DonationsFeatureFlagGuard } from './donations-feature-flag.guard';

@Controller('billing/checkout')
@UseGuards(JwtAuthGuard, DonationsFeatureFlagGuard)
export class DonationsController {
  constructor(private readonly donations: DonationsService) {}

  @Post('donation')
  async createDonationCheckout(
    @Req() req: Request,
    @Body() dto: CreateDonationCheckoutDto,
  ): Promise<{ url: string; donationId: string }> {
    const user = req.user as { sub: string; email?: string };
    return this.donations.createCheckoutSession({
      userSub: user.sub,
      userEmail: user.email,
      campaignId: dto.campaignId,
      cadence: dto.cadence,
      amountCents: dto.amountCents,
      currency: dto.currency,
    });
  }
}
