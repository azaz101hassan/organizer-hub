import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';

// Per-user throttle for the SSE token mint endpoint. The default tracker keys
// by req.ip, which collapses every admin behind a NAT (or every browser tab on
// one developer's machine) into a single bucket. The mint endpoint is gated by
// JwtAuthGuard before this runs, so req.user.sub is always populated for any
// request that reaches the throttler.
@Injectable()
export class SseMintThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Request): Promise<string> {
    const sub = req.user?.sub;
    return Promise.resolve(sub ? `user:${sub}` : `ip:${req.ip ?? 'anon'}`);
  }
}
