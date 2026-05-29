import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { Mailer, RESEND_CLIENT, ResendLike } from './mailer';

// @Global so every emitter (ticket-requests admin/requester services, the
// scheduler) can inject Mailer without importing MailModule — mirrors the
// BillingModule pattern. The Resend SDK is provided behind the RESEND_CLIENT
// token so it can be stubbed; e2e overrides the whole Mailer with FakeMailer.
@Global()
@Module({
  providers: [
    {
      provide: RESEND_CLIENT,
      useFactory: (config: ConfigService): ResendLike => {
        const apiKey = config.get<string>('RESEND_API_KEY');
        if (!apiKey) {
          new Logger('MailModule').warn(
            'RESEND_API_KEY not set — the app boots, but any outbound email ' +
              'will fail to send. Set it in .env to enable delivery.',
          );
        }
        // Resend's constructor needs a non-empty key; the placeholder lets the
        // app boot without delivery (the warning above flags it).
        return new Resend(apiKey || 're_placeholder_unused');
      },
      inject: [ConfigService],
    },
    Mailer,
  ],
  exports: [Mailer],
})
export class MailModule {}
