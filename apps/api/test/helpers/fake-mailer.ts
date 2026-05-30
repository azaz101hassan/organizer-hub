/* eslint-disable @typescript-eslint/require-await -- the fake mirrors Mailer's
 * async surface so production code can `await mailer.send(...)`; the fake does
 * no real async work but must match the contract. */
import { MailMessage, MailTemplateName } from '../../src/mail/types';

// In-memory Mailer stand-in for e2e specs. Records every message so tests can
// assert "an email of template X went to recipient Y with these props" without
// hitting Resend. Overrides the Mailer token via bootTestApp providerOverrides,
// exactly as FakeStripeClient overrides StripeClient.
export class FakeMailer {
  readonly sent: MailMessage[] = [];

  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }

  reset(): void {
    this.sent.length = 0;
  }

  // The most recent message of a given template, if any.
  lastOf<T extends MailTemplateName>(
    template: T,
  ): Extract<MailMessage, { template: T }> | undefined {
    for (let i = this.sent.length - 1; i >= 0; i--) {
      const m = this.sent[i];
      if (m.template === template) {
        return m as Extract<MailMessage, { template: T }>;
      }
    }
    return undefined;
  }
}
