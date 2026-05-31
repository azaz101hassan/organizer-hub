import { Test } from '@nestjs/testing';
import { PaymentEventKind, PaymentEventStatus } from '@organizer-hub/db/api';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentEventsService } from '../payment-events/payment-events.service';
import { MembershipsService } from '../memberships/memberships.service';
import { StripeClient } from '../billing/stripe.client';
import { WaitlistStream } from '../realtime/waitlist-stream';
import { StripeWebhookService } from './stripe-webhook.service';
import type { Stripe } from '../billing/stripe-types';

// These tests exercise StripeWebhookService against the real api_db.
// They verify that handle() on payment_intent.* events correctly transitions
// the PENDING PaymentEvent row to the appropriate terminal status. A mock
// approach would reduce these to tautologies; the real DB lets us assert
// the state transition actually happened.
describe('StripeWebhookService — payment_intent.* transitions', () => {
  let service: StripeWebhookService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        StripeWebhookService,
        PaymentEventsService,
        PrismaService,
        { provide: MembershipsService, useValue: { syncStripeData: jest.fn() } },
        { provide: StripeClient, useValue: { stripe: {} } },
        { provide: WaitlistStream, useValue: { emit: jest.fn() } },
      ],
    }).compile();
    service = mod.get(StripeWebhookService);
    prisma = mod.get(PrismaService);
    await prisma.paymentEvent.deleteMany();
  });

  afterAll(async () => prisma.$disconnect());

  it('payment_intent.succeeded transitions PENDING row to SUCCEEDED', async () => {
    // Arrange: insert a PENDING PaymentEvent row keyed on pi_t_succ
    await prisma.paymentEvent.create({
      data: {
        organizationId: 'org_house_000000000000000001',
        userId: 'user_test',
        kind: PaymentEventKind.TICKET,
        status: PaymentEventStatus.PENDING,
        amountCents: 1000,
        currency: 'usd',
        stripePaymentIntentId: 'pi_t_succ',
        stripeCheckoutSessionId: 'cs_t_succ',
      },
    });

    // Act
    const event = {
      id: 'evt_succ_1',
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_t_succ' } },
    } as unknown as Stripe.Event;
    await service.handle(event);

    // Assert
    const row = await prisma.paymentEvent.findFirst({
      where: { stripePaymentIntentId: 'pi_t_succ' },
    });
    expect(row?.status).toBe(PaymentEventStatus.SUCCEEDED);
    expect(row?.succeededAt).toBeTruthy();
  });

  it('payment_intent.payment_failed transitions PENDING -> FAILED with failureReason', async () => {
    // Arrange
    await prisma.paymentEvent.create({
      data: {
        organizationId: 'org_house_000000000000000001',
        userId: 'user_test',
        kind: PaymentEventKind.TICKET,
        status: PaymentEventStatus.PENDING,
        amountCents: 1000,
        currency: 'usd',
        stripePaymentIntentId: 'pi_t_fail',
        stripeCheckoutSessionId: 'cs_t_fail',
      },
    });

    // Act
    const event = {
      id: 'evt_fail_1',
      type: 'payment_intent.payment_failed',
      data: {
        object: {
          id: 'pi_t_fail',
          last_payment_error: { message: 'card declined' },
        },
      },
    } as unknown as Stripe.Event;
    await service.handle(event);

    // Assert
    const row = await prisma.paymentEvent.findFirst({
      where: { stripePaymentIntentId: 'pi_t_fail' },
    });
    expect(row?.status).toBe(PaymentEventStatus.FAILED);
    expect(row?.failureReason).toBe('card declined');
  });

  it('payment_intent.canceled transitions PENDING -> CANCELED with canceledAt', async () => {
    // Arrange
    await prisma.paymentEvent.create({
      data: {
        organizationId: 'org_house_000000000000000001',
        userId: 'user_test',
        kind: PaymentEventKind.TICKET,
        status: PaymentEventStatus.PENDING,
        amountCents: 1000,
        currency: 'usd',
        stripePaymentIntentId: 'pi_t_cncl',
        stripeCheckoutSessionId: 'cs_t_cncl',
      },
    });

    // Act
    const event = {
      id: 'evt_cncl_1',
      type: 'payment_intent.canceled',
      data: { object: { id: 'pi_t_cncl' } },
    } as unknown as Stripe.Event;
    await service.handle(event);

    // Assert
    const row = await prisma.paymentEvent.findFirst({
      where: { stripePaymentIntentId: 'pi_t_cncl' },
    });
    expect(row?.status).toBe(PaymentEventStatus.CANCELED);
    expect(row?.canceledAt).toBeTruthy();
  });
});
