import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard, type AuthenticatedUser } from '../auth/jwt-auth.guard';
import {
  MembershipsService,
  type MembershipView,
} from './memberships.service';

@Controller('memberships')
@UseGuards(JwtAuthGuard)
export class MembershipsController {
  constructor(private readonly memberships: MembershipsService) {}

  // GET /memberships/me — returns the caller's current Membership row
  // regardless of status (or null when none exists). Used by the dashboard
  // status page; the success page after Checkout also calls this and relies
  // on the opportunistic syncStripeData fallback inside getMembershipForUser
  // for the brief window before the webhook lands.
  @Get('me')
  async getMine(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MembershipView | null> {
    return this.memberships.getMembershipForUser(user.sub);
  }
}
