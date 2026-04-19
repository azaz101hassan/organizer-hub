import {
  Body,
  Controller,
  Get,
  HttpException,
  Param,
  Post,
  Render,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { OidcService } from '../oidc/oidc.service';

interface InteractionBody {
  email?: string;
  password?: string;
  name?: string;
}

@Controller('interaction')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly oidc: OidcService,
  ) {}

  /**
   * Entry point during an OIDC auth flow — oidc-provider redirects the browser
   * here with an interaction uid. We resolve the prompt and render the right page,
   * or auto-grant consent for first-party clients.
   */
  @Get(':uid')
  async showInteraction(
    @Param('uid') uid: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const details = await this.oidc.provider.interactionDetails(req, res);
    const { prompt, params } = details;

    if (prompt.name === 'login') {
      return res.render('login', {
        uid,
        clientId: params.client_id,
        error: null,
      });
    }

    if (prompt.name === 'consent') {
      // Auto-grant: for Phase 1 every client is first-party.
      const accountId = details.session?.accountId;
      if (!accountId) throw new HttpException('no session', 400);

      const Provider = this.oidc.provider.constructor as unknown as {
        Grant: new (opts: { accountId: string; clientId: string }) => InstanceType<
          typeof this.oidc.provider.Grant
        >;
      };
      const grant = details.grantId
        ? await this.oidc.provider.Grant.find(details.grantId)
        : new this.oidc.provider.Grant({ accountId, clientId: params.client_id as string });

      if (!grant) throw new HttpException('grant lookup failed', 500);

      const missingOIDC = (details.prompt.details.missingOIDCScope as string[] | undefined) ?? [];
      const missingResource = (details.prompt.details.missingResourceScopes as
        | Record<string, string[]>
        | undefined) ?? {};

      if (missingOIDC.length) grant.addOIDCScope(missingOIDC.join(' '));
      for (const [resource, scopes] of Object.entries(missingResource)) {
        grant.addResourceScope(resource, scopes.join(' '));
      }

      const grantId = await grant.save();
      await this.oidc.provider.interactionFinished(
        req,
        res,
        { consent: { grantId } },
        { mergeWithLastSubmission: true },
      );
      return;
    }

    // shouldn't happen with current config but be defensive
    throw new HttpException(`unsupported prompt: ${prompt.name}`, 500);
  }

  @Get(':uid/signup')
  signupForm(@Param('uid') uid: string, @Res() res: Response): void {
    res.render('signup', { uid, error: null });
  }

  @Post(':uid/login')
  async submitLogin(
    @Param('uid') uid: string,
    @Body() body: InteractionBody,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    try {
      const user = await this.auth.verifyCredentials(body.email ?? '', body.password ?? '');
      await this.oidc.provider.interactionFinished(
        req,
        res,
        { login: { accountId: user.id } },
        { mergeWithLastSubmission: false },
      );
    } catch (err) {
      const message = err instanceof HttpException ? err.message : 'something went wrong';
      res.render('login', { uid, clientId: undefined, error: message });
    }
  }

  @Post(':uid/signup')
  async submitSignup(
    @Param('uid') uid: string,
    @Body() body: InteractionBody,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    try {
      const user = await this.auth.createUser(
        body.email ?? '',
        body.password ?? '',
        body.name,
      );
      await this.oidc.provider.interactionFinished(
        req,
        res,
        { login: { accountId: user.id } },
        { mergeWithLastSubmission: false },
      );
    } catch (err) {
      const message = err instanceof HttpException ? err.message : 'something went wrong';
      res.render('signup', { uid, error: message });
    }
  }
}
