import { Test } from '@nestjs/testing';
import { PaymentEventKind, PaymentEventStatus, Prisma } from '@organizer-hub/db/api';
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
        {
          provide: StripeClient,
          useValue: {
            stripe: {
              charges: { retrieve: jest.fn().mockResolvedValue({ metadata: { userId: 'u' } }) },
              subscriptions: { retrieve: jest.fn().mockResolvedValue({ metadata: { userId: 'u' } }) },
            },
          },
        },
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

  it('payment_intent.payment_failed without last_payment_error leaves failureReason null', async () => {
    // Arrange
    await prisma.paymentEvent.create({
      data: {
        organizationId: 'org_house_000000000000000001',
        userId: 'user_test',
        kind: PaymentEventKind.TICKET,
        status: PaymentEventStatus.PENDING,
        amountCents: 1000,
        currency: 'usd',
        stripePaymentIntentId: 'pi_t_fail_bare',
        stripeCheckoutSessionId: 'cs_t_fail_bare',
      },
    });

    // Act — last_payment_error absent (Stripe sometimes omits it)
    const event = {
      id: 'evt_fail_bare',
      type: 'payment_intent.payment_failed',
      data: { object: { id: 'pi_t_fail_bare' } },
    } as unknown as Stripe.Event;
    await service.handle(event);

    // Assert
    const row = await prisma.paymentEvent.findFirst({
      where: { stripePaymentIntentId: 'pi_t_fail_bare' },
    });
    expect(row?.status).toBe(PaymentEventStatus.FAILED);
    expect(row?.failureReason).toBeNull();
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

describe('StripeWebhookService — charge.refunded', () => {
  let service: StripeWebhookService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        StripeWebhookService,
        PaymentEventsService,
        PrismaService,
        { provide: MembershipsService, useValue: { syncStripeData: jest.fn() } },
        {
          provide: StripeClient,
          useValue: {
            stripe: {
              charges: { retrieve: jest.fn().mockResolvedValue({ metadata: { userId: 'u' } }) },
              subscriptions: { retrieve: jest.fn().mockResolvedValue({ metadata: { userId: 'u' } }) },
            },
          },
        },
        { provide: WaitlistStream, useValue: { emit: jest.fn() } },
      ],
    }).compile();
    service = mod.get(StripeWebhookService);
    prisma = mod.get(PrismaService);
    await prisma.paymentEvent.deleteMany();
  });

  afterAll(async () => prisma.$disconnect());

  it('inserts one REFUND row per Refund object', async () => {
    const event = {
      id: 'evt_ref_1',
      type: 'charge.refunded',
      data: {
        object: {
          id: 'ch_ref_1',
          currency: 'usd',
          customer: 'cus_ref_1',
          payment_intent: 'pi_ref_1',
          metadata: { userId: 'u' },
          refunds: { data: [{ id: 're_a', amount: 60 }, { id: 're_b', amount: 40 }] },
        },
      },
    } as unknown as Stripe.Event;

    await service.handle(event);

    const rows = await prisma.paymentEvent.findMany({
      where: { kind: PaymentEventKind.REFUND },
      orderBy: { amountCents: 'asc' },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.amountCents).toBe(-60);
    expect(rows[1]?.amountCents).toBe(-40);
  });

  it('is idempotent on replay', async () => {
    const event = {
      id: 'evt_ref_idem',
      type: 'charge.refunded',
      data: {
        object: {
          id: 'ch_ref_idem',
          currency: 'usd',
          payment_intent: 'pi_ref_idem',
          metadata: { userId: 'u' },
          refunds: { data: [{ id: 're_idem', amount: 100 }] },
        },
      },
    } as unknown as Stripe.Event;

    await service.handle(event);
    await service.handle(event);

    const rows = await prisma.paymentEvent.findMany({
      where: { kind: PaymentEventKind.REFUND, stripeRefundId: 're_idem' },
    });
    expect(rows).toHaveLength(1);
  });

  it('missing userId/PI is skipped silently without throwing', async () => {
    const event = {
      id: 'evt_ref_skip',
      type: 'charge.refunded',
      data: {
        object: {
          id: 'ch_ref_skip',
          currency: 'usd',
          refunds: { data: [{ id: 're_skip', amount: 50 }] },
        },
      },
    } as unknown as Stripe.Event;

    await expect(service.handle(event)).resolves.toEqual({ recorded: false });
    const count = await prisma.paymentEvent.count({ where: { kind: PaymentEventKind.REFUND } });
    expect(count).toBe(0);
  });
});

describe('StripeWebhookService — charge.dispute.created', () => {
  let service: StripeWebhookService;
  let prisma: PrismaService;
  let stripeClientMock: { stripe: { charges: { retrieve: jest.Mock }; subscriptions: { retrieve: jest.Mock } } };

  beforeEach(async () => {
    stripeClientMock = {
      stripe: {
        charges: { retrieve: jest.fn().mockResolvedValue({ metadata: { userId: 'u' } }) },
        subscriptions: { retrieve: jest.fn().mockResolvedValue({ metadata: { userId: 'u' } }) },
      },
    };
    const mod = await Test.createTestingModule({
      providers: [
        StripeWebhookService,
        PaymentEventsService,
        PrismaService,
        { provide: MembershipsService, useValue: { syncStripeData: jest.fn() } },
        { provide: StripeClient, useValue: stripeClientMock },
        { provide: WaitlistStream, useValue: { emit: jest.fn() } },
      ],
    }).compile();
    service = mod.get(StripeWebhookService);
    prisma = mod.get(PrismaService);
    await prisma.paymentEvent.deleteMany();
  });

  afterAll(async () => prisma.$disconnect());

  it('inserts a DISPUTE row with negative amount and description containing dispute id', async () => {
    const event = {
      id: 'evt_disp_1',
      type: 'charge.dispute.created',
      data: {
        object: {
          id: 'dp_1',
          amount: 1000,
          currency: 'usd',
          charge: 'ch_x',
          payment_intent: 'pi_disp_1',
          metadata: { userId: 'u' },
        },
      },
    } as unknown as Stripe.Event;

    await service.handle(event);

    const row = await prisma.paymentEvent.findFirst({ where: { kind: PaymentEventKind.DISPUTE } });
    expect(row?.amountCents).toBe(-1000);
    expect(row?.description).toContain('dp_1');
  });

  it('falls back to charge.metadata when dispute payload omits userId', async () => {
    const event = {
      id: 'evt_disp_fallback',
      type: 'charge.dispute.created',
      data: {
        object: {
          id: 'dp_fb',
          amount: 500,
          currency: 'usd',
          charge: 'ch_fb',
          payment_intent: 'pi_disp_fb',
        },
      },
    } as unknown as Stripe.Event;

    await service.handle(event);

    expect(stripeClientMock.stripe.charges.retrieve).toHaveBeenCalledWith('ch_fb');
    const row = await prisma.paymentEvent.findFirst({ where: { kind: PaymentEventKind.DISPUTE } });
    expect(row?.amountCents).toBe(-500);
  });
});

describe('StripeWebhookService — invoice.payment_succeeded', () => {
  let service: StripeWebhookService;
  let prisma: PrismaService;
  let stripeClientMock: { stripe: { charges: { retrieve: jest.Mock }; subscriptions: { retrieve: jest.Mock } } };

  beforeEach(async () => {
    stripeClientMock = {
      stripe: {
        charges: { retrieve: jest.fn().mockResolvedValue({ metadata: { userId: 'u' } }) },
        subscriptions: { retrieve: jest.fn().mockResolvedValue({ metadata: { userId: 'u' } }) },
      },
    };
    const mod = await Test.createTestingModule({
      providers: [
        StripeWebhookService,
        PaymentEventsService,
        PrismaService,
        { provide: MembershipsService, useValue: { syncStripeData: jest.fn() } },
        { provide: StripeClient, useValue: stripeClientMock },
        { provide: WaitlistStream, useValue: { emit: jest.fn() } },
      ],
    }).compile();
    service = mod.get(StripeWebhookService);
    prisma = mod.get(PrismaService);
    await prisma.paymentEvent.deleteMany();
  });

  afterAll(async () => prisma.$disconnect());

  it('skips first invoice with billing_reason=subscription_create', async () => {
    const event = {
      id: 'evt_inv_create',
      type: 'invoice.payment_succeeded',
      data: {
        object: {
          id: 'in_create_1',
          amount_paid: 1500,
          currency: 'usd',
          customer: 'cus_x',
          payment_intent: 'pi_inv_create',
          billing_reason: 'subscription_create',
          metadata: { userId: 'u' },
        },
      },
    } as unknown as Stripe.Event;

    await service.handle(event);

    const count = await prisma.paymentEvent.count({ where: { kind: PaymentEventKind.MEMBERSHIP } });
    expect(count).toBe(0);
  });

  it('inserts a MEMBERSHIP row for a renewal invoice', async () => {
    const event = {
      id: 'evt_inv_renew',
      type: 'invoice.payment_succeeded',
      data: {
        object: {
          id: 'in_renew_1',
          amount_paid: 1500,
          currency: 'usd',
          customer: 'cus_x',
          payment_intent: 'pi_renew_1',
          billing_reason: 'subscription_cycle',
          metadata: { userId: 'u' },
        },
      },
    } as unknown as Stripe.Event;

    await service.handle(event);

    const row = await prisma.paymentEvent.findFirst({ where: { kind: PaymentEventKind.MEMBERSHIP } });
    expect(row?.status).toBe(PaymentEventStatus.SUCCEEDED);
    expect(row?.amountCents).toBe(1500);
    expect(row?.stripeInvoiceId).toBe('in_renew_1');
    expect(row?.stripePaymentIntentId).toBe('pi_renew_1');
  });

  it('falls back to subscription.metadata for userId when invoice has none', async () => {
    const event = {
      id: 'evt_inv_sub_fb',
      type: 'invoice.payment_succeeded',
      data: {
        object: {
          id: 'in_sub_fb',
          amount_paid: 2000,
          currency: 'usd',
          customer: 'cus_x',
          payment_intent: 'pi_sub_fb',
          subscription: 'sub_123',
          billing_reason: 'subscription_cycle',
        },
      },
    } as unknown as Stripe.Event;

    await service.handle(event);

    expect(stripeClientMock.stripe.subscriptions.retrieve).toHaveBeenCalledWith('sub_123');
    const row = await prisma.paymentEvent.findFirst({ where: { kind: PaymentEventKind.MEMBERSHIP } });
    expect(row?.amountCents).toBe(2000);
  });
});

describe('StripeWebhookService — donation invoice P2002 catch', () => {
  let service: StripeWebhookService;
  let prisma: PrismaService;

  const ORG_ID = 'org_house_000000000000000001';
  const COAL_ID = 'coal_p2002_1';
  const CAMP_ID = 'camp_p2002_1';

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        StripeWebhookService,
        PaymentEventsService,
        PrismaService,
        { provide: MembershipsService, useValue: { syncStripeData: jest.fn() } },
        {
          provide: StripeClient,
          useValue: {
            stripe: {
              charges: { retrieve: jest.fn() },
              subscriptions: { retrieve: jest.fn() },
            },
          },
        },
        { provide: WaitlistStream, useValue: { emit: jest.fn() } },
      ],
    }).compile();
    service = mod.get(StripeWebhookService);
    prisma = mod.get(PrismaService);
    await prisma.paymentEvent.deleteMany();
    await prisma.donation.deleteMany();
    await prisma.campaign.deleteMany({ where: { id: CAMP_ID } });
    await prisma.coalition.deleteMany({ where: { id: COAL_ID } });
    await prisma.organization.upsert({
      where: { id: ORG_ID },
      update: {},
      create: { id: ORG_ID, name: 'House', slug: 'house', createdBy: 'seed', donationsEnabled: true },
    });
    await prisma.coalition.create({
      data: { id: COAL_ID, organizationId: ORG_ID, name: 'Coal P2002', slug: 'coal-p2002' },
    });
    await prisma.campaign.create({
      data: {
        id: CAMP_ID,
        organizationId: ORG_ID,
        coalitionId: COAL_ID,
        name: 'Camp P2002',
        slug: 'camp-p2002',
        targetAmountCents: 10000,
        currency: 'usd',
        status: 'ACTIVE',
      },
    });
  });

  afterAll(async () => prisma.$disconnect());

  it('returns { recorded: false } instead of throwing when paymentEvent.create throws P2002', async () => {
    // Insert an ACTIVE donation so the handler reaches the create call.
    const donation = await prisma.donation.create({
      data: {
        userId: 'u_p2002',
        organizationId: ORG_ID,
        campaignId: CAMP_ID,
        mode: 'RECURRING',
        cadence: 'MONTHLY',
        amountCents: 500,
        currency: 'usd',
        status: 'ACTIVE',
        stripeSubscriptionId: 'sub_p2002',
        stripeCustomerId: 'cus_p2002',
      },
    });

    // Mock paymentEvent.create to throw P2002, simulating the concurrent
    // redelivery race where two deliveries both pass the findFirst check and
    // then both attempt the insert.
    const p2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint', {
      code: 'P2002',
      clientVersion: '0.0.0',
    });
    jest.spyOn(prisma.paymentEvent, 'create').mockRejectedValueOnce(p2002);

    const event = {
      id: 'evt_p2002_1',
      type: 'invoice.payment_succeeded',
      data: {
        object: {
          id: 'in_p2002_1',
          amount_paid: 500,
          currency: 'usd',
          customer: 'cus_p2002',
          payment_intent: 'pi_p2002_1',
          subscription: 'sub_p2002',
          billing_reason: 'subscription_cycle',
          metadata: { source: 'donation', donationId: donation.id, userId: 'u_p2002' },
        },
      },
    } as unknown as Stripe.Event;

    // Must not throw; must return { recorded: false }.
    await expect(service.handle(event)).resolves.toEqual({ recorded: false });
  });
});
