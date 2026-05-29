import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AUTO_REJECT_BATCH_LIMIT, AutoRejectJob } from './auto-reject.job';
import { CLOCK, systemClock } from './clock';

// Phase 4 scheduled-job runner (U9). In-process, single-instance posture: one
// API instance runs the cron (the documented scale-up is a pg_try_advisory_lock
// around the sweep — U13 ops note). Prisma, Mailer, and WaitlistStream all
// arrive via @Global modules, so nothing extra is imported. The 100-row batch
// limit is a token so e2e can shrink it to exercise the multi-loop path.
@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [
    AutoRejectJob,
    { provide: CLOCK, useValue: systemClock },
    { provide: AUTO_REJECT_BATCH_LIMIT, useValue: 100 },
  ],
})
export class SchedulerModule {}
