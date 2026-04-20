import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { errors as joseErrors, jwtVerify, type JWTPayload } from 'jose';
import { JwksService } from './jwks.service';

export interface AuthenticatedUser {
  sub: string;
  email?: string;
  emailVerified?: boolean;
  name?: string;
  claims: JWTPayload;
}

declare module 'express' {
  interface Request {
    user?: AuthenticatedUser;
  }
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwks: JwksService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization;
    if (!header || !header.toLowerCase().startsWith('bearer ')) {
      throw new UnauthorizedException('missing or malformed Authorization header');
    }
    const token = header.slice(7).trim();
    if (!token) throw new UnauthorizedException('empty bearer token');

    try {
      const { payload } = await jwtVerify(token, this.jwks.keySet, {
        issuer: this.jwks.issuer,
        audience: this.jwks.audience,
      });
      if (!payload.sub) throw new UnauthorizedException('token missing sub claim');
      req.user = {
        sub: payload.sub,
        email: typeof payload.email === 'string' ? payload.email : undefined,
        emailVerified:
          typeof payload.email_verified === 'boolean' ? payload.email_verified : undefined,
        name: typeof payload.name === 'string' ? payload.name : undefined,
        claims: payload,
      };
      return true;
    } catch (err) {
      if (err instanceof joseErrors.JOSEError) {
        throw new UnauthorizedException(`token rejected: ${err.code}`);
      }
      throw err;
    }
  }
}
