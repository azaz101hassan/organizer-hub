import { Controller, Get } from '@nestjs/common';
import {
  MembershipsService,
  type MembershipPlanView,
} from './memberships.service';

// Anonymous read of the seeded MembershipPlan catalog. The pricing page
// renders six cards from this response; the lookupKey is what the user's
// subsequent /billing/checkout/membership call carries.
@Controller('public/memberships')
export class PublicMembershipsController {
  constructor(private readonly memberships: MembershipsService) {}

  @Get()
  async list(): Promise<MembershipPlanView[]> {
    return this.memberships.listPlans();
  }
}
