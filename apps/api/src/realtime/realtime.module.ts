import { Global, Module } from '@nestjs/common';
import { SseController } from './sse.controller';
import { SseMintThrottlerGuard } from './sse-mint-throttler.guard';
import { SseStreamTokenGuard } from './sse-stream-token.guard';
import { SseTokenService } from './sse-token.service';
import { WaitlistStream } from './waitlist-stream';

// Phase 4 realtime module. U4 shipped the emit hub (WaitlistStream); U14 adds
// the consume side — the @Sse stream endpoint, the single-use query-token mint
// endpoint, and the token guard/service. @Global so every emitter
// (ticket-requests, billing, tickets, webhooks, scheduler) injects
// WaitlistStream without importing this module.
@Global()
@Module({
  controllers: [SseController],
  providers: [
    WaitlistStream,
    SseTokenService,
    SseStreamTokenGuard,
    SseMintThrottlerGuard,
  ],
  exports: [WaitlistStream],
})
export class RealtimeModule {}
