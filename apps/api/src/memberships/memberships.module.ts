import { Module } from '@nestjs/common';
import { MembershipsService } from './memberships.service';

// HTTP controllers (checkout, billing portal, webhook routing into this
// service) are wired by U4. U3 lands the service alone so coverage callers
// can already depend on getActiveMembershipForUser / canClaimFree.
@Module({
  providers: [MembershipsService],
  exports: [MembershipsService],
})
export class MembershipsModule {}
