import { Module } from '@nestjs/common';
import { MembershipsController } from './memberships.controller';
import { MembershipsService } from './memberships.service';
import { PublicMembershipsController } from './public-memberships.controller';

// /memberships/me (auth) + /public/memberships (anon) live together because
// they share MembershipsService. The auth boundary is per-route via the
// JwtAuthGuard decorator on MembershipsController, not per-module.
@Module({
  controllers: [MembershipsController, PublicMembershipsController],
  providers: [MembershipsService],
  exports: [MembershipsService],
})
export class MembershipsModule {}
