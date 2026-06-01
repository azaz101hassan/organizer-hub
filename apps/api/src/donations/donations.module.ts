import { Module } from '@nestjs/common';
import { DonationsFeatureFlagGuard } from './donations-feature-flag.guard';

@Module({
  providers: [DonationsFeatureFlagGuard],
  exports: [DonationsFeatureFlagGuard],
})
export class DonationsModule {}
