import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard, type AuthenticatedUser } from '../auth/jwt-auth.guard';
import {
  type CoverageVerdict,
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

  // GET /memberships/me/coverage?ticketTypeIds=t1,t2,...
  // Returns the per-ticketType verdict (OWNED | CLAIMABLE | BUY) so the
  // event detail page can pick the right primary CTA without re-deriving
  // the membership rules client-side. Empty / missing query returns {}.
  @Get('me/coverage')
  async coverage(
    @CurrentUser() user: AuthenticatedUser,
    @Query('ticketTypeIds') ticketTypeIds?: string,
  ): Promise<Record<string, CoverageVerdict>> {
    const ids = (ticketTypeIds ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    return this.memberships.getCoverageVerdicts(user.sub, ids);
  }
}
