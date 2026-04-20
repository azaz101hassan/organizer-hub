import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { default as ProviderType, ClientMetadata } from 'oidc-provider';
import { PrismaService } from '../prisma/prisma.service';
import { loadOrGenerateJWKS } from './jwks';
import { createPrismaAdapter } from './prisma-adapter';

@Injectable()
export class OidcService {
  private readonly logger = new Logger(OidcService.name);
  private _provider: ProviderType | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  get provider(): ProviderType {
    if (!this._provider) {
      throw new Error('OidcService.provider accessed before initProvider()');
    }
    return this._provider;
  }

  /**
   * Build the OIDC provider. Called manually from main.ts BEFORE app.listen()
   * so the express middleware can be mounted ahead of Nest's route registration.
   * Idempotent.
   */
  async initProvider(): Promise<void> {
    if (this._provider) return;
    const { default: Provider } = await import('oidc-provider');

    const issuer = this.config.get<string>('ACCOUNTS_ISSUER_URL') ?? 'http://localhost:3002';
    const keysDir = this.config.get<string>('OIDC_KEYS_DIR') ?? './.keys';
    const cookieKeys = (this.config.get<string>('OIDC_COOKIE_KEYS') ?? 'dev-secret').split(',');
    const apiAudience = this.config.get<string>('API_AUDIENCE') ?? 'organizer-api';

    const jwks = await loadOrGenerateJWKS(keysDir);
    const clients = await this.loadClients();
    const Adapter = createPrismaAdapter(this.prisma);

    this._provider = new Provider(issuer, {
      adapter: Adapter,
      jwks,
      clients,
      cookies: { keys: cookieKeys },
      pkce: { required: () => true },
      features: {
        devInteractions: { enabled: false },
        resourceIndicators: {
          enabled: true,
          defaultResource: () => apiAudience,
          getResourceServerInfo: () => ({
            scope: 'openid profile email',
            audience: apiAudience,
            accessTokenTTL: 60 * 60, // 1h
            accessTokenFormat: 'jwt',
          }),
          useGrantedResource: () => true,
        },
        // rpInitiatedLogout is on by default in oidc-provider v9 and its default
        // logoutSource already auto-submits the confirmation form, so no override.
      },
      claims: {
        openid: ['sub'],
        email: ['email', 'email_verified'],
        profile: ['name'],
      },
      findAccount: async (_ctx, sub) => {
        const user = await this.prisma.user.findUnique({ where: { id: sub } });
        if (!user) return undefined;
        return {
          accountId: user.id,
          claims: async () => ({
            sub: user.id,
            email: user.email,
            email_verified: user.emailVerified,
            name: user.name ?? undefined,
          }),
        };
      },
      interactions: {
        url(_ctx, interaction) {
          return `/interaction/${interaction.uid}`;
        },
      },
    });

    this.logger.log(`OIDC provider ready — issuer=${issuer}, clients=${clients.length}`);
  }

  private async loadClients(): Promise<ClientMetadata[]> {
    const rows = await this.prisma.oAuthClient.findMany();
    return rows.map((c) => ({
      client_id: c.clientId,
      client_name: c.name,
      client_secret: c.clientSecret ?? undefined,
      redirect_uris: c.redirectUris,
      post_logout_redirect_uris: c.postLogoutRedirectUris,
      grant_types: c.grantTypes,
      response_types: c.responseTypes as ClientMetadata['response_types'],
      scope: c.scopes.join(' '),
      token_endpoint_auth_method: c.isPublic ? 'none' : 'client_secret_post',
    }));
  }
}
