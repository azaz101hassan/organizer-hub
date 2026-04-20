import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet } from 'jose';

@Injectable()
export class JwksService {
  private readonly logger = new Logger(JwksService.name);
  readonly issuer: string;
  readonly audience: string;
  readonly keySet: ReturnType<typeof createRemoteJWKSet>;

  constructor(config: ConfigService) {
    this.issuer = config.get<string>('ACCOUNTS_ISSUER_URL') ?? 'http://localhost:3002';
    this.audience = config.get<string>('API_AUDIENCE') ?? 'organizer-api';
    const jwksUrl = new URL(`${this.issuer}/oidc/jwks`);
    this.keySet = createRemoteJWKSet(jwksUrl);
    this.logger.log(`JWKS source: ${jwksUrl}  audience: ${this.audience}`);
  }
}
