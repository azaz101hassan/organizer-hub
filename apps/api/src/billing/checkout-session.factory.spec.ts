import { ConfigService } from '@nestjs/config';
import {
  CheckoutSessionFactory,
  MintTicketSessionParams,
} from './checkout-session.factory';
import { StripeClient } from './stripe.client';

function makeStripeClient(overrides: Record<string, unknown> = {}): StripeClient {
  return {
    stripe: {
      checkout: {
        sessions: {
          create: jest.fn().mockResolvedValue({ id: 'cs_test', url: 'https://checkout.stripe.com/test' }),
          retrieve: jest.fn(),
        },
      },
    },
    ...overrides,
  } as unknown as StripeClient;
}

function makeConfig(webOrigin = 'https://example.com'): ConfigService {
  return { get: jest.fn().mockReturnValue(webOrigin) } as unknown as ConfigService;
}

const BASE_PARAMS: MintTicketSessionParams = {
  userSub: 'user-1',
  customerId: 'cus_123',
  eventId: 'evt-1',
  ticketTypeId: 'tt-1',
  stripePriceId: 'price_123',
};

describe('CheckoutSessionFactory.mintTicketSession', () => {
  it('stamps metadata.source="ticket" on the Checkout Session', async () => {
    const stripeClient = makeStripeClient();
    const factory = new CheckoutSessionFactory(stripeClient, makeConfig());

    await factory.mintTicketSession(BASE_PARAMS);

    const createArgs = (
      stripeClient.stripe.checkout.sessions.create as jest.Mock
    ).mock.calls[0][0];
    expect(createArgs.metadata.source).toBe('ticket');
  });

  it('preserves userId, eventId, ticketTypeId in metadata', async () => {
    const stripeClient = makeStripeClient();
    const factory = new CheckoutSessionFactory(stripeClient, makeConfig());

    await factory.mintTicketSession(BASE_PARAMS);

    const createArgs = (
      stripeClient.stripe.checkout.sessions.create as jest.Mock
    ).mock.calls[0][0];
    expect(createArgs.metadata).toMatchObject({
      userId: 'user-1',
      eventId: 'evt-1',
      ticketTypeId: 'tt-1',
    });
  });

  it('includes ticketRequestId in metadata when provided', async () => {
    const stripeClient = makeStripeClient();
    const factory = new CheckoutSessionFactory(stripeClient, makeConfig());

    await factory.mintTicketSession({ ...BASE_PARAMS, ticketRequestId: 'tr-99' });

    const createArgs = (
      stripeClient.stripe.checkout.sessions.create as jest.Mock
    ).mock.calls[0][0];
    expect(createArgs.metadata.ticketRequestId).toBe('tr-99');
  });

  it('omits ticketRequestId from metadata when not provided', async () => {
    const stripeClient = makeStripeClient();
    const factory = new CheckoutSessionFactory(stripeClient, makeConfig());

    await factory.mintTicketSession(BASE_PARAMS);

    const createArgs = (
      stripeClient.stripe.checkout.sessions.create as jest.Mock
    ).mock.calls[0][0];
    expect(createArgs.metadata).not.toHaveProperty('ticketRequestId');
  });

  it('returns id and url from Stripe response', async () => {
    const stripeClient = makeStripeClient();
    const factory = new CheckoutSessionFactory(stripeClient, makeConfig());

    const result = await factory.mintTicketSession(BASE_PARAMS);

    expect(result).toEqual({ id: 'cs_test', url: 'https://checkout.stripe.com/test' });
  });

  it('throws when Stripe returns no url', async () => {
    const stripeClient = makeStripeClient();
    (stripeClient.stripe.checkout.sessions.create as jest.Mock).mockResolvedValue({
      id: 'cs_no_url',
      url: null,
    });
    const factory = new CheckoutSessionFactory(stripeClient, makeConfig());

    await expect(factory.mintTicketSession(BASE_PARAMS)).rejects.toThrow(
      'cs_no_url',
    );
  });
});
