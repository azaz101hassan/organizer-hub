import { ConfigService } from '@nestjs/config';
import { Mailer, ResendLike, ResendSendPayload } from './mailer';

function configWith(values: Record<string, string | undefined>): ConfigService {
  return {
    get: <T>(key: string): T | undefined => values[key] as T | undefined,
  } as unknown as ConfigService;
}

function makeResendSpy(): { client: ResendLike; calls: ResendSendPayload[] } {
  const calls: ResendSendPayload[] = [];
  const client: ResendLike = {
    emails: {
      send: (payload) => {
        calls.push(payload);
        return Promise.resolve({ data: { id: 'em_test_1' }, error: null });
      },
    },
  };
  return { client, calls };
}

const VALID_ENV = {
  MAIL_FROM: 'OrganizerHub <test@resend.dev>',
  WEB_ORIGIN: 'https://app.example.com',
};

describe('Mailer', () => {
  it('sends the rendered template to the recipient via the Resend client', async () => {
    const { client, calls } = makeResendSpy();
    const mailer = new Mailer(configWith(VALID_ENV), client);

    await mailer.send({
      template: 'claim-approved',
      to: 'buyer@example.com',
      props: {
        requesterName: 'Ada',
        eventTitle: 'Spring Gala',
        tierName: 'GA',
      },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      to: 'buyer@example.com',
      from: 'OrganizerHub <test@resend.dev>',
    });
    expect(calls[0].subject).toMatch(/confirmed/i);
    expect(calls[0].html).toContain('Spring Gala');
  });

  it('never throws when the Resend client fails — best-effort delivery (R26)', async () => {
    const throwing: ResendLike = {
      emails: { send: () => Promise.reject(new Error('network down')) },
    };
    const mailer = new Mailer(configWith(VALID_ENV), throwing);

    await expect(
      mailer.send({
        template: 'claim-approved',
        to: 'buyer@example.com',
        props: { requesterName: 'Ada', eventTitle: 'Gala', tierName: 'GA' },
      }),
    ).resolves.toBeUndefined();
  });

  it('paid-approved embeds the direct Stripe URL + expiry and a WEB_ORIGIN deep-link', async () => {
    const { client, calls } = makeResendSpy();
    const mailer = new Mailer(configWith(VALID_ENV), client);
    const expiresAt = new Date('2026-06-01T12:00:00Z');

    await mailer.send({
      template: 'paid-approved',
      to: 'buyer@example.com',
      props: {
        requesterName: 'Ada',
        eventTitle: 'Gala',
        tierName: 'VIP',
        checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_123',
        expiresAt,
      },
    });

    const html = calls[0].html;
    expect(html).toContain('https://checkout.stripe.com/c/pay/cs_test_123');
    expect(html).toContain(expiresAt.toUTCString());
    expect(html).toContain('https://app.example.com/dashboard/requests');
  });

  it('escapes a crafted reject reason instead of rendering it as HTML (R26)', async () => {
    const { client, calls } = makeResendSpy();
    const mailer = new Mailer(configWith(VALID_ENV), client);

    await mailer.send({
      template: 'rejected',
      to: 'buyer@example.com',
      props: {
        requesterName: 'Ada',
        eventTitle: 'Gala',
        tierName: 'GA',
        reason: '<script>alert(1)</script>',
      },
    });

    const html = calls[0].html;
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('throws at construction when WEB_ORIGIN is missing or malformed (fail fast)', () => {
    const { client } = makeResendSpy();
    expect(
      () => new Mailer(configWith({ WEB_ORIGIN: undefined }), client),
    ).toThrow(/WEB_ORIGIN/);
    expect(
      () => new Mailer(configWith({ WEB_ORIGIN: 'not a url' }), client),
    ).toThrow(/WEB_ORIGIN/);
    expect(
      () =>
        new Mailer(configWith({ WEB_ORIGIN: 'ftp://app.example.com' }), client),
    ).toThrow(/http/);
  });
});
