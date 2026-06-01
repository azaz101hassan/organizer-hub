import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { StripeClient } from './../src/billing/stripe.client';
import { StripeWebhookVerifier } from './../src/billing/stripe-webhook.verifier';
import { StripeWebhookService } from './../src/webhooks/stripe-webhook.service';
import { MembershipsService } from './../src/memberships/memberships.service';
import { PrismaService } from './../src/prisma/prisma.service';
import { bootTestApp, DenyAllGuard } from './helpers/boot-test-app';
import {
  FakeStripeClient,
  FakeStripeWebhookVerifier,
} from './helpers/fake-stripe';
import {
  coalitionFactory,
  campaignFactory,
  donationFactory,
} from './factories';
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
      data: coalitionFactory({
        id: COALITION_ID,
        organizationId: HOUSE_ORG_ID,
      }),
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

describe('invoice.payment_succeeded — donation arm (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let fakeStripe: FakeStripeClient;
  let service: StripeWebhookService;

  beforeAll(async () => {
    fakeStripe = new FakeStripeClient();
    const fakeVerifier = new FakeStripeWebhookVerifier();
    ({ app, prisma } = await bootTestApp(DenyAllGuard, [
      { token: StripeClient, useValue: fakeStripe },
      { token: StripeWebhookVerifier, useValue: fakeVerifier },
    ]));
    service = app.get(StripeWebhookService);
  });

  beforeEach(async () => {
    fakeStripe.reset();
    await prisma.paymentEvent.deleteMany({});
    await prisma.donation.deleteMany({});
    await prisma.campaign.deleteMany({});
    await prisma.coalition.deleteMany({});

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
      data: coalitionFactory({
        id: COALITION_ID,
        organizationId: HOUSE_ORG_ID,
      }),
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

  it('first invoice (subscription_create) promotes Donation PENDING→ACTIVE; does NOT write a new PaymentEvent', async () => {
    const donation = await prisma.donation.create({
      data: donationFactory({
        userId: USER,
        campaignId: CAMPAIGN_ID,
        organizationId: HOUSE_ORG_ID,
        mode: 'RECURRING',
        cadence: 'MONTHLY',
        status: 'PENDING',
        stripeSubscriptionId: 'sub_inv_test_1',
        stripeCustomerId: 'cus_inv_test_1',
      }),
    });

    // Simulate the PaymentEvent that handleCheckoutCreated wrote with donationId
    // already stamped — this is the row U10 guarantees exists for the first charge.
    await prisma.paymentEvent.create({
      data: {
        organizationId: HOUSE_ORG_ID,
        userId: USER,
        kind: 'DONATION',
        status: 'PENDING',
        amountCents: 2500,
        currency: 'usd',
        stripeCheckoutSessionId: 'cs_inv_test_1',
        stripePaymentIntentId: 'pi_inv_test_1',
        donationId: donation.id,
      },
    });

    await service.handle(
      makeStripeEvent(
        'invoice.payment_succeeded',
        {
          id: 'in_test_1',
          amount_paid: 2500,
          currency: 'usd',
          customer: 'cus_inv_test_1',
          payment_intent: 'pi_inv_test_1',
          subscription: 'sub_inv_test_1',
          billing_reason: 'subscription_create',
          metadata: {
            source: 'donation',
            donationId: donation.id,
            userId: USER,
          },
        },
        'evt_inv_first_1',
      ),
    );

    const updated = await prisma.donation.findUniqueOrThrow({
      where: { id: donation.id },
    });
    expect(updated.status).toBe('ACTIVE');

    // Only the original checkout-session PE row — no new row was written.
    const peCount = await prisma.paymentEvent.count({
      where: { donationId: donation.id },
    });
    expect(peCount).toBe(1);
  });

  it('renewal invoice writes a fresh SUCCEEDED DONATION PaymentEvent; does not re-flip status', async () => {
    const donation = await prisma.donation.create({
      data: donationFactory({
        userId: USER,
        campaignId: CAMPAIGN_ID,
        organizationId: HOUSE_ORG_ID,
        mode: 'RECURRING',
        cadence: 'MONTHLY',
        status: 'ACTIVE',
        stripeSubscriptionId: 'sub_inv_test_2',
        stripeCustomerId: 'cus_inv_test_2',
      }),
    });

    // Existing PE from the first invoice (subscription_create).
    await prisma.paymentEvent.create({
      data: {
        organizationId: HOUSE_ORG_ID,
        userId: USER,
        kind: 'DONATION',
        status: 'SUCCEEDED',
        amountCents: 2500,
        currency: 'usd',
        stripeInvoiceId: 'in_test_first',
        stripePaymentIntentId: 'pi_inv_test_first',
        donationId: donation.id,
        succeededAt: new Date(),
      },
    });

    await service.handle(
      makeStripeEvent(
        'invoice.payment_succeeded',
        {
          id: 'in_test_2',
          amount_paid: 2500,
          currency: 'usd',
          customer: 'cus_inv_test_2',
          payment_intent: 'pi_inv_test_2',
          charge: 'ch_inv_test_2',
          subscription: 'sub_inv_test_2',
          billing_reason: 'subscription_cycle',
          metadata: {
            source: 'donation',
            donationId: donation.id,
            userId: USER,
          },
        },
        'evt_inv_renewal_1',
      ),
    );

    const updated = await prisma.donation.findUniqueOrThrow({
      where: { id: donation.id },
    });
    expect(updated.status).toBe('ACTIVE'); // unchanged

    const peCount = await prisma.paymentEvent.count({
      where: { donationId: donation.id },
    });
    expect(peCount).toBe(2);

    const newPe = await prisma.paymentEvent.findFirstOrThrow({
      where: { stripeInvoiceId: 'in_test_2', kind: 'DONATION' },
    });
    expect(newPe.status).toBe('SUCCEEDED');
    expect(newPe.donationId).toBe(donation.id);
    expect(newPe.amountCents).toBe(2500);
    expect(newPe.currency).toBe('usd');
    expect(newPe.stripeInvoiceId).toBe('in_test_2');
  });

  it('replaying the same renewal invoice is idempotent (PE count stays at 2)', async () => {
    const donation = await prisma.donation.create({
      data: donationFactory({
        userId: USER,
        campaignId: CAMPAIGN_ID,
        organizationId: HOUSE_ORG_ID,
        mode: 'RECURRING',
        cadence: 'MONTHLY',
        status: 'ACTIVE',
        stripeSubscriptionId: 'sub_inv_test_3',
        stripeCustomerId: 'cus_inv_test_3',
      }),
    });

    // First invoice PE.
    await prisma.paymentEvent.create({
      data: {
        organizationId: HOUSE_ORG_ID,
        userId: USER,
        kind: 'DONATION',
        status: 'SUCCEEDED',
        amountCents: 2500,
        currency: 'usd',
        stripeInvoiceId: 'in_test_idem_first',
        stripePaymentIntentId: 'pi_inv_idem_first',
        donationId: donation.id,
        succeededAt: new Date(),
      },
    });

    const renewalEvent = makeStripeEvent(
      'invoice.payment_succeeded',
      {
        id: 'in_test_idem_2',
        amount_paid: 2500,
        currency: 'usd',
        customer: 'cus_inv_test_3',
        payment_intent: 'pi_inv_idem_2',
        subscription: 'sub_inv_test_3',
        billing_reason: 'subscription_cycle',
        metadata: { source: 'donation', donationId: donation.id, userId: USER },
      },
      'evt_inv_idem_1',
    );

    // First delivery.
    await service.handle(renewalEvent);

    // Second delivery of the same event — must be a no-op.
    await service.handle(renewalEvent);

    const peCount = await prisma.paymentEvent.count({
      where: { donationId: donation.id },
    });
    expect(peCount).toBe(2); // not 3
  });

  it('missing Donation row: warn + no-op (no crash, no PE inserted)', async () => {
    const initialPeCount = await prisma.paymentEvent.count();

    await expect(
      service.handle(
        makeStripeEvent(
          'invoice.payment_succeeded',
          {
            id: 'in_test_missing',
            amount_paid: 2500,
            currency: 'usd',
            customer: 'cus_inv_missing',
            payment_intent: 'pi_inv_missing',
            subscription: 'sub_inv_missing_xyz',
            billing_reason: 'subscription_cycle',
            metadata: {
              source: 'donation',
              donationId: 'don_nonexistent_xyz',
              userId: USER,
            },
          },
          'evt_inv_missing_1',
        ),
      ),
    ).resolves.not.toThrow();

    expect(await prisma.paymentEvent.count()).toBe(initialPeCount);
  });

  it('renewal arriving while Donation still PENDING promotes to ACTIVE and writes a new PE', async () => {
    const donation = await prisma.donation.create({
      data: donationFactory({
        userId: USER,
        campaignId: CAMPAIGN_ID,
        organizationId: HOUSE_ORG_ID,
        mode: 'RECURRING',
        cadence: 'MONTHLY',
        status: 'PENDING',
        stripeSubscriptionId: 'sub_inv_test_5',
        stripeCustomerId: 'cus_inv_test_5',
      }),
    });

    await service.handle(
      makeStripeEvent(
        'invoice.payment_succeeded',
        {
          id: 'in_test_early_renewal',
          amount_paid: 2500,
          currency: 'usd',
          customer: 'cus_inv_test_5',
          payment_intent: 'pi_inv_test_5',
          subscription: 'sub_inv_test_5',
          billing_reason: 'subscription_cycle',
          metadata: {
            source: 'donation',
            donationId: donation.id,
            userId: USER,
          },
        },
        'evt_inv_early_renewal_1',
      ),
    );

    const updated = await prisma.donation.findUniqueOrThrow({
      where: { id: donation.id },
    });
    expect(updated.status).toBe('ACTIVE');

    const newPe = await prisma.paymentEvent.findFirst({
      where: { stripeInvoiceId: 'in_test_early_renewal', kind: 'DONATION' },
    });
    expect(newPe).not.toBeNull();
    expect(newPe!.donationId).toBe(donation.id);
    expect(newPe!.status).toBe('SUCCEEDED');
  });

  // Retrieve-fallback path: production invoices carry donation metadata on the
  // subscription object, not on inv.metadata.  The handler must retrieve the sub
  // to resolve source/donationId and then dispatch to the donation arm correctly.
  it('renewal with metadata only on subscription (retrieve-fallback): promotes PENDING→ACTIVE and writes PE', async () => {
    const donation = await prisma.donation.create({
      data: donationFactory({
        userId: USER,
        campaignId: CAMPAIGN_ID,
        organizationId: HOUSE_ORG_ID,
        mode: 'RECURRING',
        cadence: 'MONTHLY',
        status: 'PENDING',
        stripeSubscriptionId: 'sub_inv_retrieve_1',
        stripeCustomerId: 'cus_inv_retrieve_1',
      }),
    });

    // Seed the subscription in FakeStripe with donation metadata — this is what
    // the handler will retrieve when inv.metadata is empty.
    fakeStripe.seedSubscription({
      id: 'sub_inv_retrieve_1',
      customer: 'cus_inv_retrieve_1',
      status: 'active',
      cancel_at_period_end: false,
      metadata: { source: 'donation', donationId: donation.id, userId: USER },
      items: { data: [] },
    });

    // inv.metadata is empty and subscription_details is absent — forces retrieve.
    await service.handle(
      makeStripeEvent(
        'invoice.payment_succeeded',
        {
          id: 'in_test_retrieve_1',
          amount_paid: 2500,
          currency: 'usd',
          customer: 'cus_inv_retrieve_1',
          payment_intent: 'pi_inv_retrieve_1',
          subscription: 'sub_inv_retrieve_1',
          billing_reason: 'subscription_cycle',
          metadata: {},
          // subscription_details intentionally absent
        },
        'evt_inv_retrieve_1',
      ),
    );

    const updated = await prisma.donation.findUniqueOrThrow({
      where: { id: donation.id },
    });
    expect(updated.status).toBe('ACTIVE');

    const newPe = await prisma.paymentEvent.findFirst({
      where: { stripeInvoiceId: 'in_test_retrieve_1', kind: 'DONATION' },
    });
    expect(newPe).not.toBeNull();
    expect(newPe!.donationId).toBe(donation.id);
    expect(newPe!.status).toBe('SUCCEEDED');
  });

  // subscription_details.metadata path: Stripe embeds sub metadata inline on
  // the invoice object in production, avoiding a retrieve call altogether.
  it('renewal with metadata in subscription_details (no retrieve needed): promotes PENDING→ACTIVE and writes PE', async () => {
    const donation = await prisma.donation.create({
      data: donationFactory({
        userId: USER,
        campaignId: CAMPAIGN_ID,
        organizationId: HOUSE_ORG_ID,
        mode: 'RECURRING',
        cadence: 'MONTHLY',
        status: 'PENDING',
        stripeSubscriptionId: 'sub_inv_details_1',
        stripeCustomerId: 'cus_inv_details_1',
      }),
    });

    const retrieveCallsBefore = fakeStripe.callsFor(
      'subscriptions.retrieve',
    ).length;

    await service.handle(
      makeStripeEvent(
        'invoice.payment_succeeded',
        {
          id: 'in_test_details_1',
          amount_paid: 2500,
          currency: 'usd',
          customer: 'cus_inv_details_1',
          payment_intent: 'pi_inv_details_1',
          subscription: 'sub_inv_details_1',
          billing_reason: 'subscription_cycle',
          metadata: {},
          subscription_details: {
            metadata: {
              source: 'donation',
              donationId: donation.id,
              userId: USER,
            },
          },
        },
        'evt_inv_details_1',
      ),
    );

    // No retrieve should have been issued — metadata came from subscription_details.
    const retrieveCallsAfter = fakeStripe.callsFor(
      'subscriptions.retrieve',
    ).length;
    expect(retrieveCallsAfter).toBe(retrieveCallsBefore);

    const updated = await prisma.donation.findUniqueOrThrow({
      where: { id: donation.id },
    });
    expect(updated.status).toBe('ACTIVE');

    const newPe = await prisma.paymentEvent.findFirst({
      where: { stripeInvoiceId: 'in_test_details_1', kind: 'DONATION' },
    });
    expect(newPe).not.toBeNull();
    expect(newPe!.donationId).toBe(donation.id);
    expect(newPe!.status).toBe('SUCCEEDED');
  });

  // CANCELED guard: a replay of a historical invoice against a since-canceled
  // donation must not write a fresh PaymentEvent into the ledger.
  it('renewal against a CANCELED donation: skips PE insert', async () => {
    const donation = await prisma.donation.create({
      data: donationFactory({
        userId: USER,
        campaignId: CAMPAIGN_ID,
        organizationId: HOUSE_ORG_ID,
        mode: 'RECURRING',
        cadence: 'MONTHLY',
        status: 'CANCELED',
        stripeSubscriptionId: 'sub_inv_canceled_1',
        stripeCustomerId: 'cus_inv_canceled_1',
      }),
    });

    const initialPeCount = await prisma.paymentEvent.count();

    await expect(
      service.handle(
        makeStripeEvent(
          'invoice.payment_succeeded',
          {
            id: 'in_test_canceled_1',
            amount_paid: 2500,
            currency: 'usd',
            customer: 'cus_inv_canceled_1',
            payment_intent: 'pi_inv_canceled_1',
            subscription: 'sub_inv_canceled_1',
            billing_reason: 'subscription_cycle',
            metadata: {
              source: 'donation',
              donationId: donation.id,
              userId: USER,
            },
          },
          'evt_inv_canceled_1',
        ),
      ),
    ).resolves.not.toThrow();

    // Donation status must remain CANCELED — not flipped to ACTIVE.
    const afterHandle = await prisma.donation.findUniqueOrThrow({
      where: { id: donation.id },
    });
    expect(afterHandle.status).toBe('CANCELED');

    // No new PaymentEvent row was inserted.
    expect(await prisma.paymentEvent.count()).toBe(initialPeCount);
  });

  // FAILED → SUCCEEDED upgrade: a prior dunning attempt wrote a FAILED PE for
  // the same invoice; the SUCCEEDED arm must upgrade it in place rather than
  // returning early, so Campaign.raisedCents reflects the actual charge.
  it('prior FAILED PE for same invoice is upgraded in place to SUCCEEDED on successful retry', async () => {
    const donation = await prisma.donation.create({
      data: donationFactory({
        userId: USER,
        campaignId: CAMPAIGN_ID,
        organizationId: HOUSE_ORG_ID,
        mode: 'RECURRING',
        cadence: 'MONTHLY',
        status: 'ACTIVE',
        stripeSubscriptionId: 'sub_inv_upgrade_1',
        stripeCustomerId: 'cus_inv_upgrade_1',
      }),
    });

    // Seed a FAILED PE for the same invoice — the shape U12's handleDonationInvoiceFailed writes.
    await prisma.paymentEvent.create({
      data: {
        organizationId: HOUSE_ORG_ID,
        userId: USER,
        kind: 'DONATION',
        status: 'FAILED',
        amountCents: 2500,
        currency: 'usd',
        donationId: donation.id,
        stripeInvoiceId: 'in_upgrade_1',
        stripePaymentIntentId: 'pi_inv_upgrade_old',
        stripeCustomerId: 'cus_inv_upgrade_1',
        failureReason: 'Your card was declined.',
      },
    });

    // Stripe retries and succeeds — invoice.payment_succeeded arrives for the
    // same invoice with a new payment_intent.
    await service.handle(
      makeStripeEvent(
        'invoice.payment_succeeded',
        {
          id: 'in_upgrade_1',
          amount_paid: 2500,
          currency: 'usd',
          customer: 'cus_inv_upgrade_1',
          payment_intent: 'pi_inv_upgrade_new',
          charge: 'ch_inv_upgrade_1',
          subscription: 'sub_inv_upgrade_1',
          billing_reason: 'subscription_cycle',
          metadata: {
            source: 'donation',
            donationId: donation.id,
            userId: USER,
          },
        },
        'evt_inv_upgrade_1',
      ),
    );

    // Exactly 1 PE row for this invoice — no duplicate was written.
    const peCount = await prisma.paymentEvent.count({
      where: { stripeInvoiceId: 'in_upgrade_1', kind: 'DONATION' },
    });
    expect(peCount).toBe(1);

    const pe = await prisma.paymentEvent.findFirstOrThrow({
      where: { stripeInvoiceId: 'in_upgrade_1', kind: 'DONATION' },
    });
    expect(pe.status).toBe('SUCCEEDED');
    expect(pe.succeededAt).not.toBeNull();
    expect(pe.amountCents).toBe(2500);
    expect(pe.failureReason).toBeNull();
    expect(pe.stripePaymentIntentId).toBe('pi_inv_upgrade_new');
  });
});

describe('customer.subscription.deleted — donation arm (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let fakeStripe: FakeStripeClient;
  let service: StripeWebhookService;
  let memberships: MembershipsService;

  beforeAll(async () => {
    fakeStripe = new FakeStripeClient();
    const fakeVerifier = new FakeStripeWebhookVerifier();
    ({ app, prisma } = await bootTestApp(DenyAllGuard, [
      { token: StripeClient, useValue: fakeStripe },
      { token: StripeWebhookVerifier, useValue: fakeVerifier },
    ]));
    service = app.get(StripeWebhookService);
    memberships = app.get(MembershipsService);
  });

  beforeEach(async () => {
    fakeStripe.reset();
    await prisma.paymentEvent.deleteMany({});
    await prisma.donation.deleteMany({});
    await prisma.campaign.deleteMany({});
    await prisma.coalition.deleteMany({});

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
      data: coalitionFactory({
        id: COALITION_ID,
        organizationId: HOUSE_ORG_ID,
      }),
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

  it('ACTIVE donation → flips to CANCELED and stamps canceledAt', async () => {
    const donation = await prisma.donation.create({
      data: donationFactory({
        userId: USER,
        campaignId: CAMPAIGN_ID,
        organizationId: HOUSE_ORG_ID,
        mode: 'RECURRING',
        cadence: 'MONTHLY',
        status: 'ACTIVE',
        stripeSubscriptionId: 'sub_del_test_1',
        stripeCustomerId: 'cus_del_test_1',
      }),
    });

    await service.handle(
      makeStripeEvent(
        'customer.subscription.deleted',
        {
          id: 'sub_del_test_1',
          customer: 'cus_del_test_1',
          metadata: {
            source: 'donation',
            donationId: donation.id,
            userId: USER,
          },
        },
        'evt_del_1',
      ),
    );

    const updated = await prisma.donation.findUniqueOrThrow({
      where: { id: donation.id },
    });
    expect(updated.status).toBe('CANCELED');
    expect(updated.canceledAt).not.toBeNull();
  });

  it('idempotency: already-CANCELED donation → status stays CANCELED, canceledAt is NOT updated', async () => {
    const originalCanceledAt = new Date(Date.now() - 60_000);
    const donation = await prisma.donation.create({
      data: donationFactory({
        userId: USER,
        campaignId: CAMPAIGN_ID,
        organizationId: HOUSE_ORG_ID,
        mode: 'RECURRING',
        cadence: 'MONTHLY',
        status: 'CANCELED',
        stripeSubscriptionId: 'sub_del_idem_1',
        stripeCustomerId: 'cus_del_idem_1',
        canceledAt: originalCanceledAt,
      }),
    });

    await service.handle(
      makeStripeEvent(
        'customer.subscription.deleted',
        {
          id: 'sub_del_idem_1',
          customer: 'cus_del_idem_1',
          metadata: {
            source: 'donation',
            donationId: donation.id,
            userId: USER,
          },
        },
        'evt_del_idem_1',
      ),
    );

    const updated = await prisma.donation.findUniqueOrThrow({
      where: { id: donation.id },
    });
    expect(updated.status).toBe('CANCELED');
    // canceledAt must still be the original stamp, not a fresh one.
    expect(updated.canceledAt!.getTime()).toBeLessThan(Date.now() - 30_000);
  });

  it('membership regression net: non-donation subscription.deleted still calls syncStripeData and leaves seeded ACTIVE donation untouched', async () => {
    // Seed a donation that must not be touched.
    const donation = await prisma.donation.create({
      data: donationFactory({
        userId: USER,
        campaignId: CAMPAIGN_ID,
        organizationId: HOUSE_ORG_ID,
        mode: 'RECURRING',
        cadence: 'MONTHLY',
        status: 'ACTIVE',
        stripeSubscriptionId: 'sub_del_membership_1',
        stripeCustomerId: 'cus_del_membership_1',
      }),
    });

    // Seed a subscription in FakeStripe so syncStripeData can list subs for
    // the customer and not throw.
    fakeStripe.seedSubscription({
      id: 'sub_del_membership_other',
      customer: 'cus_del_membership_other',
      status: 'canceled',
      cancel_at_period_end: false,
      metadata: {},
      items: { data: [] },
    });

    const syncSpy = jest.spyOn(memberships, 'syncStripeData');

    // No source=donation metadata → should route to membership path.
    await service.handle(
      makeStripeEvent(
        'customer.subscription.deleted',
        {
          id: 'sub_del_membership_other',
          customer: 'cus_del_membership_other',
          metadata: {},
        },
        'evt_del_membership_1',
      ),
    );

    // syncStripeData must have been called.
    expect(syncSpy).toHaveBeenCalledWith('cus_del_membership_other');

    // The seeded donation remains untouched.
    const untouched = await prisma.donation.findUniqueOrThrow({
      where: { id: donation.id },
    });
    expect(untouched.status).toBe('ACTIVE');

    syncSpy.mockRestore();
  });

  it('missing Donation row → warn + no-op (no exception, no rows created)', async () => {
    const initialDonationCount = await prisma.donation.count();

    await expect(
      service.handle(
        makeStripeEvent(
          'customer.subscription.deleted',
          {
            id: 'sub_del_missing_1',
            customer: 'cus_del_missing_1',
            metadata: {
              source: 'donation',
              donationId: 'don_nonexistent_xyz',
              userId: USER,
            },
          },
          'evt_del_missing_1',
        ),
      ),
    ).resolves.not.toThrow();

    expect(await prisma.donation.count()).toBe(initialDonationCount);
  });

  it('donationId in metadata is empty → falls back to subscription-id lookup and cancels successfully', async () => {
    const donation = await prisma.donation.create({
      data: donationFactory({
        userId: USER,
        campaignId: CAMPAIGN_ID,
        organizationId: HOUSE_ORG_ID,
        mode: 'RECURRING',
        cadence: 'MONTHLY',
        status: 'ACTIVE',
        stripeSubscriptionId: 'sub_del_fallback_1',
        stripeCustomerId: 'cus_del_fallback_1',
      }),
    });

    // donationId is absent from metadata — must fall back to stripeSubscriptionId lookup.
    await service.handle(
      makeStripeEvent(
        'customer.subscription.deleted',
        {
          id: 'sub_del_fallback_1',
          customer: 'cus_del_fallback_1',
          metadata: { source: 'donation', userId: USER },
        },
        'evt_del_fallback_1',
      ),
    );

    const updated = await prisma.donation.findUniqueOrThrow({
      where: { id: donation.id },
    });
    expect(updated.status).toBe('CANCELED');
    expect(updated.canceledAt).not.toBeNull();
  });

  // Finding 6: metadata.donationId points to a donation with a DIFFERENT
  // stripeSubscriptionId — the wrong subscription was canceled; D1 must NOT
  // be canceled.
  it('meta.donationId mismatch: donation stripeSubscriptionId differs from webhook sub.id → D1 NOT canceled', async () => {
    // D1 belongs to sub_A.
    const donationA = await prisma.donation.create({
      data: donationFactory({
        userId: USER,
        campaignId: CAMPAIGN_ID,
        organizationId: HOUSE_ORG_ID,
        mode: 'RECURRING',
        cadence: 'MONTHLY',
        status: 'ACTIVE',
        stripeSubscriptionId: 'sub_A_del_mismatch',
        stripeCustomerId: 'cus_del_mismatch_1',
      }),
    });

    // sub_B is deleted; metadata.donationId wrongly points to donationA (sub_A).
    await service.handle(
      makeStripeEvent(
        'customer.subscription.deleted',
        {
          id: 'sub_B_del_mismatch',
          customer: 'cus_del_mismatch_1',
          metadata: {
            source: 'donation',
            donationId: donationA.id,
            userId: USER,
          },
        },
        'evt_del_mismatch_1',
      ),
    );

    // donationA must NOT be canceled — it belongs to sub_A, not sub_B.
    const afterHandle = await prisma.donation.findUniqueOrThrow({
      where: { id: donationA.id },
    });
    expect(afterHandle.status).toBe('ACTIVE');
  });
});

describe('invoice.payment_failed — donation arm (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let fakeStripe: FakeStripeClient;
  let service: StripeWebhookService;
  let memberships: MembershipsService;

  beforeAll(async () => {
    fakeStripe = new FakeStripeClient();
    const fakeVerifier = new FakeStripeWebhookVerifier();
    ({ app, prisma } = await bootTestApp(DenyAllGuard, [
      { token: StripeClient, useValue: fakeStripe },
      { token: StripeWebhookVerifier, useValue: fakeVerifier },
    ]));
    service = app.get(StripeWebhookService);
    memberships = app.get(MembershipsService);
  });

  beforeEach(async () => {
    fakeStripe.reset();
    await prisma.paymentEvent.deleteMany({});
    await prisma.donation.deleteMany({});
    await prisma.campaign.deleteMany({});
    await prisma.coalition.deleteMany({});

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
      data: coalitionFactory({
        id: COALITION_ID,
        organizationId: HOUSE_ORG_ID,
      }),
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

  it('ACTIVE donation → FAILED kind=DONATION PE written; Donation.status remains ACTIVE', async () => {
    const donation = await prisma.donation.create({
      data: donationFactory({
        userId: USER,
        campaignId: CAMPAIGN_ID,
        organizationId: HOUSE_ORG_ID,
        mode: 'RECURRING',
        cadence: 'MONTHLY',
        status: 'ACTIVE',
        stripeSubscriptionId: 'sub_fail_test_1',
        stripeCustomerId: 'cus_fail_test_1',
      }),
    });

    await service.handle(
      makeStripeEvent(
        'invoice.payment_failed',
        {
          id: 'in_fail_test_1',
          amount_due: 2500,
          currency: 'usd',
          customer: 'cus_fail_test_1',
          payment_intent: 'pi_fail_test_1',
          subscription: 'sub_fail_test_1',
          metadata: {
            source: 'donation',
            donationId: donation.id,
            userId: USER,
          },
          last_finalization_error: { message: 'Your card was declined.' },
        },
        'evt_fail_1',
      ),
    );

    const updated = await prisma.donation.findUniqueOrThrow({
      where: { id: donation.id },
    });
    expect(updated.status).toBe('ACTIVE');

    const pe = await prisma.paymentEvent.findFirstOrThrow({
      where: { stripeInvoiceId: 'in_fail_test_1', kind: 'DONATION' },
    });
    expect(pe.status).toBe('FAILED');
    expect(pe.donationId).toBe(donation.id);
    expect(pe.failureReason).toBe('Your card was declined.');
    expect(pe.organizationId).toBe(HOUSE_ORG_ID);
  });

  it('idempotency: redelivery of the same failed invoice → exactly one FAILED PE row', async () => {
    const donation = await prisma.donation.create({
      data: donationFactory({
        userId: USER,
        campaignId: CAMPAIGN_ID,
        organizationId: HOUSE_ORG_ID,
        mode: 'RECURRING',
        cadence: 'MONTHLY',
        status: 'ACTIVE',
        stripeSubscriptionId: 'sub_fail_idem_1',
        stripeCustomerId: 'cus_fail_idem_1',
      }),
    });

    const failEvent = makeStripeEvent(
      'invoice.payment_failed',
      {
        id: 'in_fail_idem_1',
        amount_due: 2500,
        currency: 'usd',
        customer: 'cus_fail_idem_1',
        payment_intent: 'pi_fail_idem_1',
        subscription: 'sub_fail_idem_1',
        metadata: { source: 'donation', donationId: donation.id, userId: USER },
      },
      'evt_fail_idem_1',
    );

    // First delivery.
    await service.handle(failEvent);
    // Second delivery — must be a no-op.
    await service.handle(failEvent);

    const peCount = await prisma.paymentEvent.count({
      where: { stripeInvoiceId: 'in_fail_idem_1', kind: 'DONATION' },
    });
    expect(peCount).toBe(1);
  });

  // PI=null concurrent re-delivery: the (stripe_payment_intent_id, kind)
  // partial unique does NOT fire on (NULL, 'DONATION') under Postgres
  // null semantics. The new (stripe_invoice_id, kind)=DONATION partial unique
  // must prevent a double row from being written.
  it('payment_intent:null concurrent redelivery → exactly 1 FAILED PE (invoice-level unique guards the race)', async () => {
    const donation = await prisma.donation.create({
      data: donationFactory({
        userId: USER,
        campaignId: CAMPAIGN_ID,
        organizationId: HOUSE_ORG_ID,
        mode: 'RECURRING',
        cadence: 'MONTHLY',
        status: 'ACTIVE',
        stripeSubscriptionId: 'sub_fail_nullpi_1',
        stripeCustomerId: 'cus_fail_nullpi_1',
      }),
    });

    const failEvent = makeStripeEvent(
      'invoice.payment_failed',
      {
        id: 'in_fail_nullpi_1',
        amount_due: 2500,
        currency: 'usd',
        customer: 'cus_fail_nullpi_1',
        payment_intent: null,
        subscription: 'sub_fail_nullpi_1',
        metadata: { source: 'donation', donationId: donation.id, userId: USER },
      },
      'evt_fail_nullpi_1',
    );

    // Simulate two concurrent deliveries arriving simultaneously.
    await Promise.all([service.handle(failEvent), service.handle(failEvent)]);

    const peCount = await prisma.paymentEvent.count({
      where: { stripeInvoiceId: 'in_fail_nullpi_1', kind: 'DONATION' },
    });
    expect(peCount).toBe(1);
  });

  // The FAILED path skips subscriptions.retrieve even when metadata is empty
  // (unlike the SUCCEEDED path). The membership failed arm only needs
  // inv.customer; routing through resolveInvoiceSubMetadata would fire a
  // retrieve on every dunning retry for no benefit. An invoice without any
  // inline source hint is treated as a membership invoice.
  it('empty metadata, no subscription_details → routes to membership path; no retrieve, no FAILED PE', async () => {
    fakeStripe.seedSubscription({
      id: 'sub_fail_retrieve_1',
      customer: 'cus_fail_retrieve_1',
      status: 'past_due',
      cancel_at_period_end: false,
      metadata: {},
      items: { data: [] },
    });

    const syncSpy = jest.spyOn(memberships, 'syncStripeData');
    const retrieveCallsBefore = fakeStripe.callsFor(
      'subscriptions.retrieve',
    ).length;
    const initialPeCount = await prisma.paymentEvent.count();

    await service.handle(
      makeStripeEvent(
        'invoice.payment_failed',
        {
          id: 'in_fail_retrieve_1',
          amount_due: 2500,
          currency: 'usd',
          customer: 'cus_fail_retrieve_1',
          payment_intent: 'pi_fail_retrieve_1',
          subscription: 'sub_fail_retrieve_1',
          metadata: {},
          // subscription_details intentionally absent
        },
        'evt_fail_retrieve_1',
      ),
    );

    // No retrieve was issued for the membership path.
    const retrieveCallsAfter = fakeStripe.callsFor(
      'subscriptions.retrieve',
    ).length;
    expect(retrieveCallsAfter).toBe(retrieveCallsBefore);

    // syncStripeData was called with the invoice customer.
    expect(syncSpy).toHaveBeenCalledWith('cus_fail_retrieve_1');

    // No new DONATION PaymentEvent was written.
    expect(await prisma.paymentEvent.count()).toBe(initialPeCount);

    syncSpy.mockRestore();
  });

  it('subscription_details path: metadata on subscription_details.metadata only → subscriptions.retrieve NOT called', async () => {
    const donation = await prisma.donation.create({
      data: donationFactory({
        userId: USER,
        campaignId: CAMPAIGN_ID,
        organizationId: HOUSE_ORG_ID,
        mode: 'RECURRING',
        cadence: 'MONTHLY',
        status: 'ACTIVE',
        stripeSubscriptionId: 'sub_fail_details_1',
        stripeCustomerId: 'cus_fail_details_1',
      }),
    });

    const retrieveCallsBefore = fakeStripe.callsFor(
      'subscriptions.retrieve',
    ).length;

    await service.handle(
      makeStripeEvent(
        'invoice.payment_failed',
        {
          id: 'in_fail_details_1',
          amount_due: 2500,
          currency: 'usd',
          customer: 'cus_fail_details_1',
          payment_intent: 'pi_fail_details_1',
          subscription: 'sub_fail_details_1',
          metadata: {},
          subscription_details: {
            metadata: {
              source: 'donation',
              donationId: donation.id,
              userId: USER,
            },
          },
        },
        'evt_fail_details_1',
      ),
    );

    const retrieveCallsAfter = fakeStripe.callsFor(
      'subscriptions.retrieve',
    ).length;
    expect(retrieveCallsAfter).toBe(retrieveCallsBefore);

    const pe = await prisma.paymentEvent.findFirst({
      where: { stripeInvoiceId: 'in_fail_details_1', kind: 'DONATION' },
    });
    expect(pe).not.toBeNull();
    expect(pe!.status).toBe('FAILED');
  });

  it('CANCELED guard: failed invoice replay against CANCELED donation → no PE inserted, no exception', async () => {
    const donation = await prisma.donation.create({
      data: donationFactory({
        userId: USER,
        campaignId: CAMPAIGN_ID,
        organizationId: HOUSE_ORG_ID,
        mode: 'RECURRING',
        cadence: 'MONTHLY',
        status: 'CANCELED',
        stripeSubscriptionId: 'sub_fail_canceled_1',
        stripeCustomerId: 'cus_fail_canceled_1',
      }),
    });

    const initialPeCount = await prisma.paymentEvent.count();

    await expect(
      service.handle(
        makeStripeEvent(
          'invoice.payment_failed',
          {
            id: 'in_fail_canceled_1',
            amount_due: 2500,
            currency: 'usd',
            customer: 'cus_fail_canceled_1',
            payment_intent: 'pi_fail_canceled_1',
            subscription: 'sub_fail_canceled_1',
            metadata: {
              source: 'donation',
              donationId: donation.id,
              userId: USER,
            },
          },
          'evt_fail_canceled_1',
        ),
      ),
    ).resolves.not.toThrow();

    expect(await prisma.paymentEvent.count()).toBe(initialPeCount);
  });

  it('membership regression net: invoice.payment_failed with no donation metadata → calls syncStripeData, writes no PE', async () => {
    // Seed a subscription in FakeStripe so syncStripeData can list subs.
    fakeStripe.seedSubscription({
      id: 'sub_fail_membership_1',
      customer: 'cus_fail_membership_1',
      status: 'past_due',
      cancel_at_period_end: false,
      metadata: {},
      items: { data: [] },
    });

    const syncSpy = jest.spyOn(memberships, 'syncStripeData');
    const initialPeCount = await prisma.paymentEvent.count();

    await service.handle(
      makeStripeEvent(
        'invoice.payment_failed',
        {
          id: 'in_fail_membership_1',
          amount_due: 4000,
          currency: 'usd',
          customer: 'cus_fail_membership_1',
          subscription: 'sub_fail_membership_1',
          // No donation metadata — plain membership invoice.
          metadata: {},
        },
        'evt_fail_membership_1',
      ),
    );

    expect(syncSpy).toHaveBeenCalledWith('cus_fail_membership_1');
    expect(await prisma.paymentEvent.count()).toBe(initialPeCount);

    syncSpy.mockRestore();
  });

  // Finding 4: membership failed path must not issue subscriptions.retrieve.
  it('membership invoice.payment_failed → subscriptions.retrieve NOT called; syncStripeData IS called', async () => {
    fakeStripe.seedSubscription({
      id: 'sub_fail_no_retrieve_1',
      customer: 'cus_fail_no_retrieve_1',
      status: 'past_due',
      cancel_at_period_end: false,
      metadata: {},
      items: { data: [] },
    });

    const syncSpy = jest.spyOn(memberships, 'syncStripeData');
    const retrieveCallsBefore = fakeStripe.callsFor(
      'subscriptions.retrieve',
    ).length;

    await service.handle(
      makeStripeEvent(
        'invoice.payment_failed',
        {
          id: 'in_fail_no_retrieve_1',
          amount_due: 4000,
          currency: 'usd',
          customer: 'cus_fail_no_retrieve_1',
          subscription: 'sub_fail_no_retrieve_1',
          metadata: {},
        },
        'evt_fail_no_retrieve_1',
      ),
    );

    expect(fakeStripe.callsFor('subscriptions.retrieve').length).toBe(
      retrieveCallsBefore,
    );
    expect(syncSpy).toHaveBeenCalledWith('cus_fail_no_retrieve_1');

    syncSpy.mockRestore();
  });

  // Finding 6: metadata.donationId pointing to the wrong subscription →
  // falls back to sub-id lookup and does NOT write a PE for the wrong donation.
  it('meta.donationId points to donation with mismatched stripeSubscriptionId → FAILED PE NOT written for that donation', async () => {
    // Donation D1 belongs to sub_A.
    const donationA = await prisma.donation.create({
      data: donationFactory({
        userId: USER,
        campaignId: CAMPAIGN_ID,
        organizationId: HOUSE_ORG_ID,
        mode: 'RECURRING',
        cadence: 'MONTHLY',
        status: 'ACTIVE',
        stripeSubscriptionId: 'sub_A_mismatch',
        stripeCustomerId: 'cus_fail_mismatch_1',
      }),
    });

    // Invoice belongs to sub_B; metadata.donationId wrongly points to donationA.
    await service.handle(
      makeStripeEvent(
        'invoice.payment_failed',
        {
          id: 'in_fail_mismatch_1',
          amount_due: 2500,
          currency: 'usd',
          customer: 'cus_fail_mismatch_1',
          payment_intent: 'pi_fail_mismatch_1',
          subscription: 'sub_B_mismatch',
          metadata: {
            source: 'donation',
            donationId: donationA.id,
            userId: USER,
          },
        },
        'evt_fail_mismatch_1',
      ),
    );

    // donationA must NOT have received a FAILED PE — sub_B has no matching Donation row.
    const peCount = await prisma.paymentEvent.count({
      where: { donationId: donationA.id, status: 'FAILED' },
    });
    expect(peCount).toBe(0);
  });
});

describe('customer.subscription.created/updated — donation sub short-circuit (e2e)', () => {
  let app: INestApplication<App>;
  let fakeStripe: FakeStripeClient;
  let service: StripeWebhookService;
  let memberships: MembershipsService;

  beforeAll(async () => {
    fakeStripe = new FakeStripeClient();
    const fakeVerifier = new FakeStripeWebhookVerifier();
    ({ app } = await bootTestApp(DenyAllGuard, [
      { token: StripeClient, useValue: fakeStripe },
      { token: StripeWebhookVerifier, useValue: fakeVerifier },
    ]));
    service = app.get(StripeWebhookService);
    memberships = app.get(MembershipsService);
  });

  beforeEach(() => {
    fakeStripe.reset();
  });

  afterAll(async () => {
    await app.close();
  });

  // Donation subs are created with price_data (no lookup_key). Routing them
  // through syncStripeData throws inside tierForLookupKey. This short-circuit
  // must fire before the SUBSCRIPTION_EVENTS branch.
  it('customer.subscription.created with source=donation → no exception; syncStripeData NOT called', async () => {
    const syncSpy = jest.spyOn(memberships, 'syncStripeData');

    await expect(
      service.handle(
        makeStripeEvent(
          'customer.subscription.created',
          {
            id: 'sub_don_created_1',
            customer: 'cus_don_created_1',
            status: 'active',
            metadata: { source: 'donation', userId: USER },
          },
          'evt_sub_don_created_1',
        ),
      ),
    ).resolves.not.toThrow();

    expect(syncSpy).not.toHaveBeenCalled();
    syncSpy.mockRestore();
  });

  it('customer.subscription.updated with source=donation and cancel_at_period_end:true → no exception; donation row untouched', async () => {
    const syncSpy = jest.spyOn(memberships, 'syncStripeData');

    await expect(
      service.handle(
        makeStripeEvent(
          'customer.subscription.updated',
          {
            id: 'sub_don_updated_1',
            customer: 'cus_don_updated_1',
            status: 'active',
            cancel_at_period_end: true,
            metadata: { source: 'donation', userId: USER },
          },
          'evt_sub_don_updated_1',
        ),
      ),
    ).resolves.not.toThrow();

    expect(syncSpy).not.toHaveBeenCalled();
    syncSpy.mockRestore();
  });

  // Regression net: non-donation subscription.updated still routes to syncStripeData.
  it('customer.subscription.updated for non-donation sub → syncStripeData IS called', async () => {
    fakeStripe.seedSubscription({
      id: 'sub_membership_upd_1',
      customer: 'cus_membership_upd_1',
      status: 'active',
      cancel_at_period_end: false,
      metadata: {},
      items: { data: [] },
    });

    const syncSpy = jest.spyOn(memberships, 'syncStripeData');

    await service.handle(
      makeStripeEvent(
        'customer.subscription.updated',
        {
          id: 'sub_membership_upd_1',
          customer: 'cus_membership_upd_1',
          status: 'active',
          metadata: {},
        },
        'evt_sub_membership_upd_1',
      ),
    );

    expect(syncSpy).toHaveBeenCalledWith('cus_membership_upd_1');
    syncSpy.mockRestore();
  });
});

describe('charge.refunded — donation arm (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let fakeStripe: FakeStripeClient;
  let service: StripeWebhookService;

  beforeAll(async () => {
    fakeStripe = new FakeStripeClient();
    const fakeVerifier = new FakeStripeWebhookVerifier();
    ({ app, prisma } = await bootTestApp(DenyAllGuard, [
      { token: StripeClient, useValue: fakeStripe },
      { token: StripeWebhookVerifier, useValue: fakeVerifier },
    ]));
    service = app.get(StripeWebhookService);
  });

  beforeEach(async () => {
    fakeStripe.reset();
    await prisma.paymentEvent.deleteMany({});
    await prisma.donation.deleteMany({});
    await prisma.campaign.deleteMany({});
    await prisma.coalition.deleteMany({});

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
      data: coalitionFactory({
        id: COALITION_ID,
        organizationId: HOUSE_ORG_ID,
      }),
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

  // Case 1: donation refund inherits donationId
  it('donation refund inherits donationId from the original DONATION PE', async () => {
    const donation = await prisma.donation.create({
      data: donationFactory({
        userId: USER,
        campaignId: CAMPAIGN_ID,
        organizationId: HOUSE_ORG_ID,
        mode: 'ONE_TIME',
        cadence: 'ONCE',
        status: 'COMPLETED',
        stripeCheckoutSessionId: 'cs_refund_don_1',
      }),
    });

    // Seed the original DONATION PaymentEvent as SUCCEEDED with a PI.
    await prisma.paymentEvent.create({
      data: {
        organizationId: HOUSE_ORG_ID,
        userId: USER,
        kind: 'DONATION',
        status: 'SUCCEEDED',
        amountCents: 5000,
        currency: 'usd',
        stripeCheckoutSessionId: 'cs_refund_don_1',
        stripePaymentIntentId: 'pi_donation_refund_1',
        donationId: donation.id,
        succeededAt: new Date(),
      },
    });

    await service.handle(
      makeStripeEvent(
        'charge.refunded',
        {
          id: 'ch_refund_don_1',
          currency: 'usd',
          customer: 'cus_refund_don_1',
          payment_intent: 'pi_donation_refund_1',
          metadata: { userId: USER },
          refunds: {
            data: [{ id: 're_don_1', amount: 5000 }],
          },
        },
        'evt_refund_don_1',
      ),
    );

    const refundPe = await prisma.paymentEvent.findFirstOrThrow({
      where: { stripeRefundId: 're_don_1', kind: 'REFUND' },
    });
    expect(refundPe.donationId).toBe(donation.id);
    expect(refundPe.amountCents).toBe(-5000);
    expect(refundPe.stripeRefundId).toBe('re_don_1');
  });

  // Case 2: membership refund leaves donationId null
  it('membership refund leaves donationId null', async () => {
    await prisma.paymentEvent.create({
      data: {
        organizationId: HOUSE_ORG_ID,
        userId: USER,
        kind: 'MEMBERSHIP',
        status: 'SUCCEEDED',
        amountCents: 4000,
        currency: 'usd',
        stripePaymentIntentId: 'pi_membership_refund_1',
        stripeCheckoutSessionId: 'cs_membership_refund_1',
        succeededAt: new Date(),
      },
    });

    await service.handle(
      makeStripeEvent(
        'charge.refunded',
        {
          id: 'ch_membership_refund_1',
          currency: 'usd',
          customer: 'cus_membership_refund_1',
          payment_intent: 'pi_membership_refund_1',
          metadata: { userId: USER },
          refunds: {
            data: [{ id: 're_membership_1', amount: 4000 }],
          },
        },
        'evt_refund_membership_1',
      ),
    );

    const refundPe = await prisma.paymentEvent.findFirstOrThrow({
      where: { stripeRefundId: 're_membership_1', kind: 'REFUND' },
    });
    expect(refundPe.donationId).toBeNull();
  });

  // Case 3: ticket refund leaves donationId null
  it('ticket refund leaves donationId null', async () => {
    await prisma.paymentEvent.create({
      data: {
        organizationId: HOUSE_ORG_ID,
        userId: USER,
        kind: 'TICKET',
        status: 'SUCCEEDED',
        amountCents: 2000,
        currency: 'usd',
        stripePaymentIntentId: 'pi_ticket_refund_1',
        stripeCheckoutSessionId: 'cs_ticket_refund_1',
        succeededAt: new Date(),
      },
    });

    await service.handle(
      makeStripeEvent(
        'charge.refunded',
        {
          id: 'ch_ticket_refund_1',
          currency: 'usd',
          customer: 'cus_ticket_refund_1',
          payment_intent: 'pi_ticket_refund_1',
          metadata: { userId: USER },
          refunds: {
            data: [{ id: 're_ticket_1', amount: 2000 }],
          },
        },
        'evt_refund_ticket_1',
      ),
    );

    const refundPe = await prisma.paymentEvent.findFirstOrThrow({
      where: { stripeRefundId: 're_ticket_1', kind: 'REFUND' },
    });
    expect(refundPe.donationId).toBeNull();
  });

  // Case 4: raisedCents nets to zero after donation + refund
  it('Campaign.raisedCents nets to zero after donation refund', async () => {
    const donation = await prisma.donation.create({
      data: donationFactory({
        userId: USER,
        campaignId: CAMPAIGN_ID,
        organizationId: HOUSE_ORG_ID,
        mode: 'ONE_TIME',
        cadence: 'ONCE',
        status: 'COMPLETED',
        stripeCheckoutSessionId: 'cs_nets_1',
      }),
    });

    // Original DONATION PE.
    await prisma.paymentEvent.create({
      data: {
        organizationId: HOUSE_ORG_ID,
        userId: USER,
        kind: 'DONATION',
        status: 'SUCCEEDED',
        amountCents: 3000,
        currency: 'usd',
        stripeCheckoutSessionId: 'cs_nets_1',
        stripePaymentIntentId: 'pi_nets_1',
        donationId: donation.id,
        succeededAt: new Date(),
      },
    });

    // Dispatch refund — webhook stamps donationId on the REFUND PE.
    await service.handle(
      makeStripeEvent(
        'charge.refunded',
        {
          id: 'ch_nets_1',
          currency: 'usd',
          customer: 'cus_nets_1',
          payment_intent: 'pi_nets_1',
          metadata: { userId: USER },
          refunds: {
            data: [{ id: 're_nets_1', amount: 3000 }],
          },
        },
        'evt_nets_1',
      ),
    );

    // The SUM of all PE rows for this donation must be 0.
    const agg = await prisma.paymentEvent.aggregate({
      where: { donationId: donation.id },
      _sum: { amountCents: true },
    });
    expect(agg._sum.amountCents).toBe(0);
  });

  // Case 5: no original PE for the PI — refund still writes, donationId null
  it('no original PE for the PI: refund still writes, donationId null, no exception', async () => {
    const initialCount = await prisma.paymentEvent.count();

    await expect(
      service.handle(
        makeStripeEvent(
          'charge.refunded',
          {
            id: 'ch_nope_1',
            currency: 'usd',
            customer: 'cus_nope_1',
            payment_intent: 'pi_nope_1',
            metadata: { userId: USER },
            refunds: {
              data: [{ id: 're_nope_1', amount: 1000 }],
            },
          },
          'evt_refund_nope_1',
        ),
      ),
    ).resolves.not.toThrow();

    // One REFUND row was written.
    const refundPe = await prisma.paymentEvent.findFirstOrThrow({
      where: { stripeRefundId: 're_nope_1', kind: 'REFUND' },
    });
    expect(refundPe.donationId).toBeNull();
    expect(await prisma.paymentEvent.count()).toBe(initialCount + 1);
  });

  // Case 6: idempotency — same charge.refunded event dispatched twice
  it('idempotency: dispatching the same refund event twice writes exactly one REFUND row', async () => {
    const donation = await prisma.donation.create({
      data: donationFactory({
        userId: USER,
        campaignId: CAMPAIGN_ID,
        organizationId: HOUSE_ORG_ID,
        mode: 'ONE_TIME',
        cadence: 'ONCE',
        status: 'COMPLETED',
        stripeCheckoutSessionId: 'cs_idem_refund_1',
      }),
    });

    await prisma.paymentEvent.create({
      data: {
        organizationId: HOUSE_ORG_ID,
        userId: USER,
        kind: 'DONATION',
        status: 'SUCCEEDED',
        amountCents: 2500,
        currency: 'usd',
        stripeCheckoutSessionId: 'cs_idem_refund_1',
        stripePaymentIntentId: 'pi_idem_refund_1',
        donationId: donation.id,
        succeededAt: new Date(),
      },
    });

    const refundEvent = makeStripeEvent(
      'charge.refunded',
      {
        id: 'ch_idem_refund_1',
        currency: 'usd',
        customer: 'cus_idem_refund_1',
        payment_intent: 'pi_idem_refund_1',
        metadata: { userId: USER },
        refunds: {
          data: [{ id: 're_idem_1', amount: 2500 }],
        },
      },
      'evt_idem_refund_1',
    );

    // First delivery.
    await service.handle(refundEvent);
    // Second delivery — must be a no-op.
    await service.handle(refundEvent);

    const count = await prisma.paymentEvent.count({
      where: { stripeRefundId: 're_idem_1', kind: 'REFUND' },
    });
    expect(count).toBe(1);
  });

  // Case 7: partial refund — multiple refund objects, all inherit the same donationId
  it('partial refund: all refund rows inherit the same donationId', async () => {
    const donation = await prisma.donation.create({
      data: donationFactory({
        userId: USER,
        campaignId: CAMPAIGN_ID,
        organizationId: HOUSE_ORG_ID,
        mode: 'ONE_TIME',
        cadence: 'ONCE',
        status: 'COMPLETED',
        stripeCheckoutSessionId: 'cs_partial_1',
      }),
    });

    await prisma.paymentEvent.create({
      data: {
        organizationId: HOUSE_ORG_ID,
        userId: USER,
        kind: 'DONATION',
        status: 'SUCCEEDED',
        amountCents: 10000,
        currency: 'usd',
        stripeCheckoutSessionId: 'cs_partial_1',
        stripePaymentIntentId: 'pi_partial_1',
        donationId: donation.id,
        succeededAt: new Date(),
      },
    });

    await service.handle(
      makeStripeEvent(
        'charge.refunded',
        {
          id: 'ch_partial_1',
          currency: 'usd',
          customer: 'cus_partial_1',
          payment_intent: 'pi_partial_1',
          metadata: { userId: USER },
          refunds: {
            data: [
              { id: 're_partial_a', amount: 3000 },
              { id: 're_partial_b', amount: 7000 },
            ],
          },
        },
        'evt_partial_1',
      ),
    );

    const refunds = await prisma.paymentEvent.findMany({
      where: { kind: 'REFUND', stripePaymentIntentId: 'pi_partial_1' },
      orderBy: { amountCents: 'asc' },
    });
    expect(refunds).toHaveLength(2);
    for (const r of refunds) {
      expect(r.donationId).toBe(donation.id);
      expect(r.amountCents).toBeLessThan(0);
    }
    expect(refunds.map((r) => r.amountCents).sort((a, b) => a - b)).toEqual([
      -7000, -3000,
    ]);
  });
});

describe('charge.dispute.created — donation arm (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let fakeStripe: FakeStripeClient;
  let service: StripeWebhookService;

  beforeAll(async () => {
    fakeStripe = new FakeStripeClient();
    const fakeVerifier = new FakeStripeWebhookVerifier();
    ({ app, prisma } = await bootTestApp(DenyAllGuard, [
      { token: StripeClient, useValue: fakeStripe },
      { token: StripeWebhookVerifier, useValue: fakeVerifier },
    ]));
    service = app.get(StripeWebhookService);
  });

  beforeEach(async () => {
    fakeStripe.reset();
    await prisma.paymentEvent.deleteMany({});
    await prisma.donation.deleteMany({});
    await prisma.campaign.deleteMany({});
    await prisma.coalition.deleteMany({});

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
      data: coalitionFactory({
        id: COALITION_ID,
        organizationId: HOUSE_ORG_ID,
      }),
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

  // Case 8: donation dispute inherits donationId
  it('donation dispute inherits donationId from the original DONATION PE', async () => {
    const donation = await prisma.donation.create({
      data: donationFactory({
        userId: USER,
        campaignId: CAMPAIGN_ID,
        organizationId: HOUSE_ORG_ID,
        mode: 'ONE_TIME',
        cadence: 'ONCE',
        status: 'COMPLETED',
        stripeCheckoutSessionId: 'cs_dispute_don_1',
      }),
    });

    await prisma.paymentEvent.create({
      data: {
        organizationId: HOUSE_ORG_ID,
        userId: USER,
        kind: 'DONATION',
        status: 'SUCCEEDED',
        amountCents: 5000,
        currency: 'usd',
        stripeCheckoutSessionId: 'cs_dispute_don_1',
        stripePaymentIntentId: 'pi_dispute_don_1',
        donationId: donation.id,
        succeededAt: new Date(),
      },
    });

    await service.handle(
      makeStripeEvent(
        'charge.dispute.created',
        {
          id: 'dp_don_1',
          amount: 5000,
          currency: 'usd',
          charge: 'ch_dispute_don_1',
          payment_intent: 'pi_dispute_don_1',
          metadata: { userId: USER },
        },
        'evt_dispute_don_1',
      ),
    );

    const disputePe = await prisma.paymentEvent.findFirstOrThrow({
      where: { kind: 'DISPUTE', stripePaymentIntentId: 'pi_dispute_don_1' },
    });
    expect(disputePe.donationId).toBe(donation.id);
    expect(disputePe.amountCents).toBe(-5000);
  });

  // Case 9: membership dispute leaves donationId null
  it('membership dispute leaves donationId null', async () => {
    await prisma.paymentEvent.create({
      data: {
        organizationId: HOUSE_ORG_ID,
        userId: USER,
        kind: 'MEMBERSHIP',
        status: 'SUCCEEDED',
        amountCents: 4000,
        currency: 'usd',
        stripePaymentIntentId: 'pi_dispute_membership_1',
        stripeCheckoutSessionId: 'cs_dispute_membership_1',
        succeededAt: new Date(),
      },
    });

    await service.handle(
      makeStripeEvent(
        'charge.dispute.created',
        {
          id: 'dp_membership_1',
          amount: 4000,
          currency: 'usd',
          charge: 'ch_dispute_membership_1',
          payment_intent: 'pi_dispute_membership_1',
          metadata: { userId: USER },
        },
        'evt_dispute_membership_1',
      ),
    );

    const disputePe = await prisma.paymentEvent.findFirstOrThrow({
      where: {
        kind: 'DISPUTE',
        stripePaymentIntentId: 'pi_dispute_membership_1',
      },
    });
    expect(disputePe.donationId).toBeNull();
  });

  // Case 10: metadata.userId fallback via charges.retrieve
  it('userId fallback: dispute.metadata.userId missing → charges.retrieve is called; donationId still inherited', async () => {
    const donation = await prisma.donation.create({
      data: donationFactory({
        userId: USER,
        campaignId: CAMPAIGN_ID,
        organizationId: HOUSE_ORG_ID,
        mode: 'ONE_TIME',
        cadence: 'ONCE',
        status: 'COMPLETED',
        stripeCheckoutSessionId: 'cs_dispute_fallback_1',
      }),
    });

    await prisma.paymentEvent.create({
      data: {
        organizationId: HOUSE_ORG_ID,
        userId: USER,
        kind: 'DONATION',
        status: 'SUCCEEDED',
        amountCents: 7500,
        currency: 'usd',
        stripeCheckoutSessionId: 'cs_dispute_fallback_1',
        stripePaymentIntentId: 'pi_dispute_fallback_1',
        donationId: donation.id,
        succeededAt: new Date(),
      },
    });

    // Seed charge so the retrieve fallback finds userId.
    fakeStripe.seedCharge({
      id: 'ch_dispute_fallback_1',
      metadata: { userId: USER },
    });

    // Omit userId from dispute.metadata to force the retrieve fallback path.
    await service.handle(
      makeStripeEvent(
        'charge.dispute.created',
        {
          id: 'dp_fallback_1',
          amount: 7500,
          currency: 'usd',
          charge: 'ch_dispute_fallback_1',
          payment_intent: 'pi_dispute_fallback_1',
          metadata: {},
        },
        'evt_dispute_fallback_1',
      ),
    );

    // Verify charges.retrieve was called.
    expect(fakeStripe.callsFor('charges.retrieve').length).toBeGreaterThan(0);

    const disputePe = await prisma.paymentEvent.findFirstOrThrow({
      where: {
        kind: 'DISPUTE',
        stripePaymentIntentId: 'pi_dispute_fallback_1',
      },
    });
    expect(disputePe.donationId).toBe(donation.id);
    expect(disputePe.amountCents).toBe(-7500);
  });
});
