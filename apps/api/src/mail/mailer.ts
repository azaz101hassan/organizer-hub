import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { renderClaimApproved } from './templates/claim-approved';
import { RenderedMail, renderPaidApproved } from './templates/paid-approved';
import { renderRejected } from './templates/rejected';
import { MailMessage } from './types';

// DI token for the Resend SDK seam. The SDK lives behind a token (mirroring the
// StripeClient seam) so e2e overrides the whole Mailer with a FakeMailer, while
// the Mailer unit spec constructs the real Mailer with a stub client.
export const RESEND_CLIENT = Symbol('RESEND_CLIENT');

export interface ResendSendPayload {
  from: string;
  to: string | string[];
  subject: string;
  html: string;
}

export interface ResendLike {
  emails: {
    send(payload: ResendSendPayload): Promise<{
      data: { id: string } | null;
      error: { message: string } | null;
    }>;
  };
}

// Validates WEB_ORIGIN as a well-formed http(s) absolute URL and returns it
// without a trailing slash. Throws (never warns) so a missing/malformed origin
// fails fast at boot rather than shipping relative or broken hrefs in mail.
export function assertWebOrigin(value: string | undefined): string {
  if (!value) {
    throw new Error(
      'WEB_ORIGIN is required for email deep-links but is not set',
    );
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`WEB_ORIGIN must be an absolute URL; got "${value}"`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`WEB_ORIGIN must be an http(s) URL; got "${value}"`);
  }
  return value.replace(/\/+$/, '');
}

export function renderMail(
  message: MailMessage,
  webOrigin: string,
): RenderedMail {
  switch (message.template) {
    case 'paid-approved':
      return renderPaidApproved(message.props, webOrigin);
    case 'claim-approved':
      return renderClaimApproved(message.props, webOrigin);
    case 'rejected':
      return renderRejected(message.props, webOrigin);
  }
}

@Injectable()
export class Mailer {
  private readonly logger = new Logger(Mailer.name);
  private readonly from: string;
  private readonly webOrigin: string;

  constructor(
    config: ConfigService,
    @Inject(RESEND_CLIENT) private readonly client: ResendLike,
  ) {
    this.from =
      config.get<string>('MAIL_FROM') ?? 'OrganizerHub <onboarding@resend.dev>';
    this.webOrigin = assertWebOrigin(config.get<string>('WEB_ORIGIN'));
  }

  // Commit-then-send, best-effort (R26): callers invoke this ONLY after the DB
  // transition has committed, and it NEVER throws — a delivery failure is
  // logged, not propagated, so the HTTP response is never blocked or rolled
  // back. The /dashboard/requests UI is the system of record if mail is lost.
  async send(message: MailMessage): Promise<void> {
    try {
      const { subject, html } = renderMail(message, this.webOrigin);
      const { error } = await this.client.emails.send({
        from: this.from,
        to: message.to,
        subject,
        html,
      });
      if (error) {
        this.logger.error(
          `Resend rejected ${message.template} to ${message.to}: ${error.message}`,
        );
      }
    } catch (err) {
      this.logger.error(
        `Failed to send ${message.template} to ${message.to}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
