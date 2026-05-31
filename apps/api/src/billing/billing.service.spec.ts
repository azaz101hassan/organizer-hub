import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BillingService } from './billing.service';
import { CheckoutSessionFactory } from './checkout-session.factory';
import { StripeClient } from './stripe.client';

// Minimal PrismaService stub for the methods BillingService touches.
function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    billingCustomer: {
      findUnique: jest.fn().mockResolvedValue({
        userId: 'user-1',
        stripeCustomerId: 'cus_123',
      }),
      create: jest.fn(),
    },
    membership: { findUnique: jest.fn() },
    ticketType: { findUnique: jest.fn() },
    ticket: { findFirst: jest.fn(), count: jest.fn() },
    ...overrides,
  };
}

function makeStripeClient(sessionOverrides: Record<string, unknown> = {}): StripeClient {
  return {
    stripe: {
      customers: { create: jest.fn() },
      prices: {
        list: jest.fn().mockResolvedValue({
          data: [{ id: 'price_mem_123' }],
        }),
      },
      checkout: {
        sessions: {
          create: jest.fn().mockResolvedValue({
            id: 'cs_mem_test',
            url: 'https://checkout.stripe.com/mem',
            ...sessionOverrides,
          }),
        },
      },
      subscriptions: { update: jest.fn() },
    },
  } as unknown as StripeClient;
}

function makeConfig(webOrigin = 'https://example.com'): ConfigService {
  return { get: jest.fn().mockReturnValue(webOrigin) } as unknown as ConfigService;
}

function makeCheckoutSessionFactory(): CheckoutSessionFactory {
  return {
    mintTicketSession: jest.fn(),
    retrieveTicketSession: jest.fn(),
  } as unknown as CheckoutSessionFactory;
}

describe('BillingService.createMembershipCheckoutSession', () => {
  it('stamps metadata.source="membership" on the session', async () => {
    const stripeClient = makeStripeClient();
    const service = new BillingService(
      makePrisma() as any,
      stripeClient,
      makeConfig(),
      makeCheckoutSessionFactory(),
    );

    await service.createMembershipCheckoutSession('user-1', 'member_monthly');

    const createArgs = (
      stripeClient.stripe.checkout.sessions.create as jest.Mock
    ).mock.calls[0][0];
    expect(createArgs.metadata.source).toBe('membership');
  });

  it('stamps metadata.userId on the session', async () => {
    const stripeClient = makeStripeClient();
    const service = new BillingService(
      makePrisma() as any,
      stripeClient,
      makeConfig(),
      makeCheckoutSessionFactory(),
    );

    await service.createMembershipCheckoutSession('user-1', 'member_monthly');

    const createArgs = (
      stripeClient.stripe.checkout.sessions.create as jest.Mock
    ).mock.calls[0][0];
    expect(createArgs.metadata.userId).toBe('user-1');
  });

  it('propagates source="membership" onto subscription_data.metadata', async () => {
    const stripeClient = makeStripeClient();
    const service = new BillingService(
      makePrisma() as any,
      stripeClient,
      makeConfig(),
      makeCheckoutSessionFactory(),
    );

    await service.createMembershipCheckoutSession('user-1', 'member_monthly');

    const createArgs = (
      stripeClient.stripe.checkout.sessions.create as jest.Mock
    ).mock.calls[0][0];
    expect(createArgs.subscription_data?.metadata?.source).toBe('membership');
  });

  it('propagates userId onto subscription_data.metadata', async () => {
    const stripeClient = makeStripeClient();
    const service = new BillingService(
      makePrisma() as any,
      stripeClient,
      makeConfig(),
      makeCheckoutSessionFactory(),
    );

    await service.createMembershipCheckoutSession('user-1', 'member_monthly');

    const createArgs = (
      stripeClient.stripe.checkout.sessions.create as jest.Mock
    ).mock.calls[0][0];
    expect(createArgs.subscription_data?.metadata?.userId).toBe('user-1');
  });

  it('throws NotFoundException when no active Stripe Price matches the lookup key', async () => {
    const stripeClient = makeStripeClient();
    (stripeClient.stripe.prices.list as jest.Mock).mockResolvedValue({ data: [] });
    const service = new BillingService(
      makePrisma() as any,
      stripeClient,
      makeConfig(),
      makeCheckoutSessionFactory(),
    );

    await expect(
      service.createMembershipCheckoutSession('user-1', 'nonexistent_key'),
    ).rejects.toThrow(NotFoundException);
  });

  it('returns id and url from the Stripe session', async () => {
    const stripeClient = makeStripeClient();
    const service = new BillingService(
      makePrisma() as any,
      stripeClient,
      makeConfig(),
      makeCheckoutSessionFactory(),
    );

    const result = await service.createMembershipCheckoutSession(
      'user-1',
      'member_monthly',
    );

    expect(result).toEqual({ id: 'cs_mem_test', url: 'https://checkout.stripe.com/mem' });
  });
});
