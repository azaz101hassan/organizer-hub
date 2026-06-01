import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { StripeClient } from './../src/billing/stripe.client';
import { StripeWebhookVerifier } from './../src/billing/stripe-webhook.verifier';
import { StripeWebhookService } from './../src/webhooks/stripe-webhook.service';
import { PrismaService } from './../src/prisma/prisma.service';
import { bootTestApp, DenyAllGuard } from './helpers/boot-test-app';
import {
  FakeStripeClient,
  FakeStripeWebhookVerifier,
} from './helpers/fake-stripe';
import { coalitionFactory, campaignFactory, donationFactory } from './factories';
import { HOUSE_ORG_ID } from '../src/common/house-org';
import type { Stripe } from './../src/billing/stripe-types';

const USER = 'user-don-wh-1';
const CAMPAIGN_ID = 'camp_don_wh_1';
const COALITION_ID = 'coal_don_wh_1';

function makeStripeEvent(
  type: string,
  data: object,
  id = 'evt_test_1',
): Stripe.Event {
  return {
    id,
    type,
    object: 'event',
    api_version: '2026-04-22.dahlia',
    created: 1700000000,
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    data: { object: data as Stripe.Event['data']['object'] },
  } as unknown as Stripe.Event;
}

describe('Donation webhook arm (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let fakeStripe: FakeStripeClient;
  let fakeVerifier: FakeStripeWebhookVerifier;
  let service: StripeWebhookService;

  beforeAll(async () => {
    fakeStripe = new FakeStripeClient();
    fakeVerifier = new FakeStripeWebhookVerifier();
    ({ app, prisma } = await bootTestApp(DenyAllGuard, [
      { token: StripeClient, useValue: fakeStripe },
      { token: StripeWebhookVerifier, useValue: fakeVerifier },
    ]));
    service = app.get(StripeWebhookService);
  });

  beforeEach(async () => {
    await prisma.paymentEvent.deleteMany({});
    await prisma.donation.deleteMany({});
    await prisma.campaign.deleteMany({});
    await prisma.coalition.deleteMany({});
    await prisma.ticket.deleteMany({});

    await prisma.organization.upsert({
      where: { id: HOUSE_ORG_ID },
      update: { donationsEnabled: true },
      create: {
        id: HOUSE_ORG_ID,
        name: 'House',
        slug: 'house',
        createdBy: 'seed',
        donationsEnabled: true,
      },
    });

    await prisma.coalition.create({
      data: coalitionFactory({ id: COALITION_ID, organizationId: HOUSE_ORG_ID }),
    });
    await prisma.campaign.create({
      data: campaignFactory({
        id: CAMPAIGN_ID,
        coalitionId: COALITION_ID,
        organizationId: HOUSE_ORG_ID,
        status: 'ACTIVE',
      }),
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('one-time donation: does NOT issue a Ticket and flips Donation to COMPLETED', async () => {
    const donation = await prisma.donation.create({
      data: donationFactory({
        userId: USER,
        campaignId: CAMPAIGN_ID,
        organizationId: HOUSE_ORG_ID,
        mode: 'ONE_TIME',
        cadence: 'ONCE',
        status: 'PENDING',
        stripeCheckoutSessionId: 'cs_test_1',
      }),
    });

    await service.handle(
      makeStripeEvent(
        'checkout.session.completed',
        {
          id: 'cs_test_1',
          mode: 'payment',
          metadata: {
            source: 'donation',
            donationId: donation.id,
            userId: USER,
            campaignId: CAMPAIGN_ID,
          },
          customer: 'cus_test_1',
          payment_intent: 'pi_test_1',
        },
        'evt_don_onetime_1',
      ),
    );

    const ticketCount = await prisma.ticket.count();
    expect(ticketCount).toBe(0);

    const updated = await prisma.donation.findUniqueOrThrow({
      where: { id: donation.id },
    });
    expect(updated.status).toBe('COMPLETED');
    expect(updated.stripeCustomerId).toBe('cus_test_1');
  });

  it('one-time donation: PaymentEvent gets donationId stamped', async () => {
    const donation = await prisma.donation.create({
      data: donationFactory({
        userId: USER,
        campaignId: CAMPAIGN_ID,
        organizationId: HOUSE_ORG_ID,
        mode: 'ONE_TIME',
        cadence: 'ONCE',
        status: 'PENDING',
        stripeCheckoutSessionId: 'cs_test_2',
      }),
    });

    // Simulate the PENDING PaymentEvent that handleCheckoutCreated writes
    // (donationId is NOT set at that point).
    await prisma.paymentEvent.create({
      data: {
        organizationId: HOUSE_ORG_ID,
        userId: USER,
        kind: 'DONATION',
        status: 'PENDING',
        amountCents: 2500,
        currency: 'usd',
        stripeCheckoutSessionId: 'cs_test_2',
        stripePaymentIntentId: 'pi_test_2',
      },
    });

    await service.handle(
      makeStripeEvent(
        'checkout.session.completed',
        {
          id: 'cs_test_2',
          mode: 'payment',
          metadata: {
            source: 'donation',
            donationId: donation.id,
            userId: USER,
            campaignId: CAMPAIGN_ID,
          },
          customer: 'cus_test_2',
          payment_intent: 'pi_test_2',
        },
        'evt_don_stamp_1',
      ),
    );

    const pe = await prisma.paymentEvent.findFirstOrThrow({
      where: { stripeCheckoutSessionId: 'cs_test_2', kind: 'DONATION' },
    });
    expect(pe.donationId).toBe(donation.id);
  });

  it('recurring donation: subscription mode stamps stripeSubscriptionId but Donation stays PENDING', async () => {
    const donation = await prisma.donation.create({
      data: donationFactory({
        userId: USER,
        campaignId: CAMPAIGN_ID,
        organizationId: HOUSE_ORG_ID,
        mode: 'RECURRING',
        cadence: 'MONTHLY',
        status: 'PENDING',
        stripeCheckoutSessionId: 'cs_test_3',
      }),
    });

    await service.handle(
      makeStripeEvent(
        'checkout.session.completed',
        {
          id: 'cs_test_3',
          mode: 'subscription',
          metadata: {
            source: 'donation',
            donationId: donation.id,
            userId: USER,
            campaignId: CAMPAIGN_ID,
          },
          customer: 'cus_test_1',
          subscription: 'sub_test_1',
        },
        'evt_don_recurring_1',
      ),
    );

    const updated = await prisma.donation.findUniqueOrThrow({
      where: { id: donation.id },
    });
    expect(updated.status).toBe('PENDING');
    expect(updated.stripeSubscriptionId).toBe('sub_test_1');
    expect(updated.stripeCustomerId).toBe('cus_test_1');
  });

  it('checkout.session.created for a donation session writes a PaymentEvent with donationId already stamped', async () => {
    const donation = await prisma.donation.create({
      data: donationFactory({
        userId: USER,
        campaignId: CAMPAIGN_ID,
        organizationId: HOUSE_ORG_ID,
        mode: 'ONE_TIME',
        cadence: 'ONCE',
        status: 'PENDING',
        stripeCheckoutSessionId: 'cs_test_created_1',
      }),
    });

    await service.handle(
      makeStripeEvent(
        'checkout.session.created',
        {
          id: 'cs_test_created_1',
          mode: 'payment',
          amount_total: 2500,
          currency: 'usd',
          metadata: {
            source: 'donation',
            donationId: donation.id,
            userId: USER,
          },
          customer: 'cus_test_c1',
          payment_intent: 'pi_test_c1',
        },
        'evt_don_created_1',
      ),
    );

    const pe = await prisma.paymentEvent.findFirstOrThrow({
      where: { stripeCheckoutSessionId: 'cs_test_created_1', kind: 'DONATION' },
    });
    expect(pe.donationId).toBe(donation.id);
  });

  it('race-safe: checkout.session.completed arriving before checkout.session.created still leaves PaymentEvent.donationId set', async () => {
    const donation = await prisma.donation.create({
      data: donationFactory({
        userId: USER,
        campaignId: CAMPAIGN_ID,
        organizationId: HOUSE_ORG_ID,
        mode: 'ONE_TIME',
        cadence: 'ONCE',
        status: 'PENDING',
        stripeCheckoutSessionId: 'cs_test_race_1',
      }),
    });

    // completed arrives first — no PaymentEvent row exists yet, so the
    // PE-stamp branch in handleDonationCheckoutCompleted is a no-op.
    await service.handle(
      makeStripeEvent(
        'checkout.session.completed',
        {
          id: 'cs_test_race_1',
          mode: 'payment',
          metadata: {
            source: 'donation',
            donationId: donation.id,
            userId: USER,
          },
          customer: 'cus_test_r1',
          payment_intent: 'pi_test_r1',
        },
        'evt_don_race_completed',
      ),
    );

    // No PaymentEvent row yet — the completed handler found nothing to stamp.
    const peBefore = await prisma.paymentEvent.findFirst({
      where: { stripeCheckoutSessionId: 'cs_test_race_1', kind: 'DONATION' },
    });
    expect(peBefore).toBeNull();

    // created arrives second — must write the row with donationId already set.
    await service.handle(
      makeStripeEvent(
        'checkout.session.created',
        {
          id: 'cs_test_race_1',
          mode: 'payment',
          amount_total: 2500,
          currency: 'usd',
          metadata: {
            source: 'donation',
            donationId: donation.id,
            userId: USER,
          },
          customer: 'cus_test_r1',
          payment_intent: 'pi_test_r1',
        },
        'evt_don_race_created',
      ),
    );

    const pe = await prisma.paymentEvent.findFirstOrThrow({
      where: { stripeCheckoutSessionId: 'cs_test_race_1', kind: 'DONATION' },
    });
    expect(pe.donationId).toBe(donation.id);
  });

  it('checkout.session.completed redelivered is idempotent', async () => {
    const donation = await prisma.donation.create({
      data: donationFactory({
        userId: USER,
        campaignId: CAMPAIGN_ID,
        organizationId: HOUSE_ORG_ID,
        mode: 'ONE_TIME',
        cadence: 'ONCE',
        status: 'PENDING',
        stripeCheckoutSessionId: 'cs_test_idem_1',
      }),
    });

    // Simulate pre-existing PENDING PaymentEvent from checkout.session.created.
    await prisma.paymentEvent.create({
      data: {
        organizationId: HOUSE_ORG_ID,
        userId: USER,
        kind: 'DONATION',
        status: 'PENDING',
        amountCents: 2500,
        currency: 'usd',
        stripeCheckoutSessionId: 'cs_test_idem_1',
        stripePaymentIntentId: 'pi_test_idem_1',
        donationId: donation.id,
      },
    });

    const completedEvent = makeStripeEvent(
      'checkout.session.completed',
      {
        id: 'cs_test_idem_1',
        mode: 'payment',
        metadata: {
          source: 'donation',
          donationId: donation.id,
          userId: USER,
        },
        customer: 'cus_test_idem_1',
        payment_intent: 'pi_test_idem_1',
      },
      'evt_don_idem_1',
    );

    // First delivery.
    await service.handle(completedEvent);

    const afterFirst = await prisma.donation.findUniqueOrThrow({
      where: { id: donation.id },
    });
    expect(afterFirst.status).toBe('COMPLETED');

    // Second delivery of the identical event — must be a no-op.
    await service.handle(completedEvent);

    const afterSecond = await prisma.donation.findUniqueOrThrow({
      where: { id: donation.id },
    });
    expect(afterSecond.status).toBe('COMPLETED');

    // Exactly one PaymentEvent for this session.
    const peCount = await prisma.paymentEvent.count({
      where: { stripeCheckoutSessionId: 'cs_test_idem_1', kind: 'DONATION' },
    });
    expect(peCount).toBe(1);

    // donationId is still set.
    const pe = await prisma.paymentEvent.findFirstOrThrow({
      where: { stripeCheckoutSessionId: 'cs_test_idem_1', kind: 'DONATION' },
    });
    expect(pe.donationId).toBe(donation.id);
  });

  it('missing Donation row: warn + no-op (no exception, no rows created)', async () => {
    const initialDonationCount = await prisma.donation.count();
    const initialPeCount = await prisma.paymentEvent.count();

    await expect(
      service.handle(
        makeStripeEvent(
          'checkout.session.completed',
          {
            id: 'cs_test_missing',
            mode: 'payment',
            metadata: {
              source: 'donation',
              donationId: 'don_nonexistent_xyz',
              userId: USER,
              campaignId: CAMPAIGN_ID,
            },
            customer: 'cus_test_1',
            payment_intent: 'pi_test_missing',
          },
          'evt_don_missing_1',
        ),
      ),
    ).resolves.not.toThrow();

    expect(await prisma.donation.count()).toBe(initialDonationCount);
    expect(await prisma.paymentEvent.count()).toBe(initialPeCount);
  });
});
