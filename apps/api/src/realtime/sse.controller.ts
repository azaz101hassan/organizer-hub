import {
  Controller,
  Header,
  MessageEvent,
  Param,
  Post,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { OrganizationRole } from '@organizer-hub/db/api';
import { Observable, takeUntil, timer } from 'rxjs';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard, type AuthenticatedUser } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { SseStreamTokenGuard } from './sse-stream-token.guard';
import { SseTokenService } from './sse-token.service';
import { WaitlistStream } from './waitlist-stream';

// Hard ceiling on a single stream's lifetime. Bounds how long a just-demoted
// admin keeps receiving the org's requester-PII payload: the connection closes,
// and to resume the client must re-mint through the RolesGuard-gated endpoint,
// which now denies them (R23 mid-stream authorization).
const MAX_STREAM_LIFETIME_MS = 90_000;

// The consume side of realtime (U14), split from the U4 emit hub. Shares the
// orgs/:orgId/requests prefix with the admin queue controller but applies its
// own per-route guards.
@Controller('orgs/:orgId/requests')
export class SseController {
  constructor(
    private readonly tokens: SseTokenService,
    private readonly stream: WaitlistStream,
  ) {}

  // Mint a single-use stream token. Header-Bearer JwtAuthGuard + RolesGuard
  // (only an OWNER/ADMIN of :orgId mints) + ThrottlerGuard. ThrottlerGuard MUST
  // be in the list — it is NOT global in this app, so @Throttle alone is a
  // no-op (deepening feasibility). 10/min is ample (a healthy client mints ~once
  // per reconnect).
  @Post('stream-token')
  @UseGuards(JwtAuthGuard, RolesGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Roles(OrganizationRole.OWNER, OrganizationRole.ADMIN)
  mintStreamToken(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orgId') orgId: string,
  ): { token: string } {
    return { token: this.tokens.mint(user.sub, orgId) };
  }

  // The authenticated SSE stream. The token guard runs pre-handler (clean 401
  // before any stream opens). X-Accel-Buffering:no defeats proxy buffering; the
  // max-lifetime recycle bounds the demoted-admin window (the client reconnects
  // transparently via a fresh mint).
  @Sse('stream')
  @UseGuards(SseStreamTokenGuard)
  @Header('X-Accel-Buffering', 'no')
  streamRequests(@Param('orgId') orgId: string): Observable<MessageEvent> {
    return this.stream
      .stream(orgId)
      .pipe(takeUntil(timer(MAX_STREAM_LIFETIME_MS)));
  }
}
