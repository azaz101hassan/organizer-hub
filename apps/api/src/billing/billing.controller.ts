import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard, type AuthenticatedUser } from '../auth/jwt-auth.guard';
import { MembershipsService } from '../memberships/memberships.service';
import { BillingService } from './billing.service';
import { CreateMembershipCheckoutDto } from './dto/create-membership-checkout.dto';

// Authenticated billing surface. The matching unauth side — Stripe webhooks
// — lives in apps/api/src/webhooks/ to make the auth/no-auth split obvious
// at the file-tree level.
@Controller('billing')
@UseGuards(JwtAuthGuard)
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly memberships: MembershipsService,
  ) {}

  @Post('checkout/membership')
  @HttpCode(HttpStatus.OK)
  async createMembershipCheckout(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateMembershipCheckoutDto,
  ): Promise<{ url: string }> {
    const session = await this.billing.createMembershipCheckoutSession(
      user.sub,
      dto.lookupKey,
      user.email,
    );
    return { url: session.url };
  }

  @Post('membership/cancel')
  @HttpCode(HttpStatus.OK)
  async cancelMembership(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ status: 'scheduled' }> {
    await this.billing.cancelMembership(user.sub);
    // Sync immediately so the dashboard reflects cancel_at_period_end=true
    // without waiting for Stripe's webhook to arrive.
    const customer = await this.billing.getOrCreateStripeCustomer(user.sub);
    await this.memberships.syncStripeData(customer.stripeCustomerId);
    return { status: 'scheduled' };
  }
}
