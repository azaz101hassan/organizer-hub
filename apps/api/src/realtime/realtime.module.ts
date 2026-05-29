import { Global, Module } from '@nestjs/common';
import { WaitlistStream } from './waitlist-stream';

// Phase 4 realtime module. U4 ships ONLY the emit hub (WaitlistStream); the
// authenticated @Sse consume endpoint + single-use token guard arrive in U14.
// Split out (per the deepening) so the intake/lifecycle units (U5–U9) depend on
// this trivial emit seam, not on the SSE-auth surface. @Global so every emitter
// (ticket-requests, billing, tickets, webhooks, scheduler) injects WaitlistStream
// without importing this module.
@Global()
@Module({
  providers: [WaitlistStream],
  exports: [WaitlistStream],
})
export class RealtimeModule {}
