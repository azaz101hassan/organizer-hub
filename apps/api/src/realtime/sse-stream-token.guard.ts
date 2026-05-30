import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { SseTokenService } from './sse-token.service';

// Authenticates the @Sse stream from a single-use ?token= query param (R23).
// Runs BEFORE the @Sse handler, so an unauthenticated / invalid / cross-org
// connect returns a clean HTTP 401 and no stream is ever opened. The token is
// burned on read (single-use) and its bound orgId must equal the :orgId path
// param — a token minted for org A cannot tap org B's queue.
@Injectable()
export class SseStreamTokenGuard implements CanActivate {
  constructor(private readonly tokens: SseTokenService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const token =
      typeof req.query.token === 'string' ? req.query.token : undefined;
    if (!token) {
      throw new UnauthorizedException('missing stream token');
    }

    const claims = this.tokens.verifyAndBurn(token);
    if (!claims) {
      throw new UnauthorizedException('invalid or expired stream token');
    }

    if (claims.orgId !== req.params.orgId) {
      throw new UnauthorizedException('stream token org mismatch');
    }
    return true;
  }
}
