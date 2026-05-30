import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import request from 'supertest';
import { firstValueFrom } from 'rxjs';
import { filter, take } from 'rxjs/operators';
import {
  EventStatus,
  MembershipTier,
  OrganizationRole,
  SubscriptionStatus,
  TicketRequestIntent,
  TicketRequestStatus,
  TicketSource,
} from '@organizer-hub/db/api';
import { StripeClient } from './../src/billing/stripe.client';
import { StripeWebhookVerifier } from './../src/billing/stripe-webhook.verifier';
import { PrismaService } from './../src/prisma/prisma.service';
import { WaitlistStream } from './../src/realtime/waitlist-stream';
import { bootTestApp, DenyAllGuard } from './helpers/boot-test-app';
import {
  FakeStripeClient,
  FakeStripeWebhookVerifier,
  type FakeStripeSubscription,
} from './helpers/fake-stripe';
import type { Stripe } from './../src/billing/stripe-types';

const USER = 'user-wh-1';
const CUSTOMER = 'cus_wh_1';
const SUB_ID = 'sub_wh_1';

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

function seedActiveGoldSub(
  fakeStripe: FakeStripeClient,
  cancelAtPeriodEnd = false,
  periodEndIso = '2027-08-01T00:00:00Z',
  subId = SUB_ID,
): FakeStripeSubscription {
  const sub: FakeStripeSubscription = {
    id: subId,
    customer: CUSTOMER,
    status: 'active',
    cancel_at_period_end: cancelAtPeriodEnd,
    items: {
      data: [
        {
          id: 'si_wh',
          price: {
            id: 'price_gold_m',
            lookup_key: 'membership_gold_monthly',
            product: 'prod_g',
            unit_amount: 4000,
            currency: 'usd',
            active: true,
          },
          current_period_end: Math.floor(
            new Date(periodEndIso).getTime() / 1000,
          ),
        },
      ],
    },
  };
  fakeStripe.seedSubscription(sub);
  return sub;
}

describe('Stripe webhooks (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let fakeStripe: FakeStripeClient;
  let fakeVerifier: FakeStripeWebhookVerifier;

  beforeAll(async () => {
    fakeStripe = new FakeStripeClient();
    fakeVerifier = new FakeStripeWebhookVerifier();
    // The webhook endpoint is unauth, but other controllers in AppModule
    // still mount JwtAuthGuard — DenyAllGuard fails closed for them so a
    // misrouted request can't slip through.
    ({ app, prisma } = await bootTestApp(DenyAllGuard, [
      { token: StripeClient, useValue: fakeStripe },
      { token: StripeWebhookVerifier, useValue: fakeVerifier },
    ]));
  });

  beforeEach(async () => {
    await prisma.refundLog.deleteMany({});
    await prisma.ticketRequestAudit.deleteMany({});
    await prisma.webhookEvent.deleteMany({});
    await prisma.ticket.deleteMany({});
    await prisma.ticketRequest.deleteMany({});
    await prisma.ticketType.deleteMany({});
    await prisma.organization.deleteMany({});
    await prisma.membership.deleteMany({});
    await prisma.billingCustomer.deleteMany({});
    fakeStripe.reset();
    fakeVerifier.reset();
    await prisma.billingCustomer.create({
      data: { userId: USER, stripeCustomerId: CUSTOMER },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('processes a checkout.session.completed event into a Membership row (AE1)', async () => {
    seedActiveGoldSub(fakeStripe);
    fakeVerifier.queueEvent(
      makeStripeEvent(
        'checkout.session.completed',
        { id: 'cs_test_1', customer: CUSTOMER, mode: 'subscription' },
        'evt_checkout_1',
      ),
    );

    const res = await request(app.getHttpServer())
      .post('/webhooks/stripe')
      .set('stripe-signature', 't=1,v1=ok')
      .set('content-type', 'application/json')
      .send(Buffer.from('{}'))
      .expect(200);

    expect(res.body).toEqual({ received: true });

    const row = await prisma.membership.findUnique({
      where: { userId: USER },
    });
    expect(row?.tier).toBe(MembershipTier.GOLD);
    expect(row?.status).toBe(SubscriptionStatus.ACTIVE);

    const dedupe = await prisma.webhookEvent.findUnique({
      where: { stripeEventId: 'evt_checkout_1' },
    });
    expect(dedupe?.type).toBe('checkout.session.completed');
  });

  it('acks duplicate redeliveries without re-processing (AE7)', async () => {
    seedActiveGoldSub(fakeStripe);
    fakeVerifier.queueEvent(
      makeStripeEvent(
        'customer.subscription.created',
        { id: SUB_ID, customer: CUSTOMER },
        'evt_dup',
      ),
    );
    fakeVerifier.queueEvent(
      makeStripeEvent(
        'customer.subscription.created',
        { id: SUB_ID, customer: CUSTOMER },
        'evt_dup',
      ),
    );

    await request(app.getHttpServer())
      .post('/webhooks/stripe')
      .set('stripe-signature', 't=1,v1=ok')
      .set('content-type', 'application/json')
      .send(Buffer.from('{}'))
      .expect(200);

    await request(app.getHttpServer())
      .post('/webhooks/stripe')
      .set('stripe-signature', 't=1,v1=ok')
      .set('content-type', 'application/json')
      .send(Buffer.from('{}'))
      .expect(200);

    const dedupeCount = await prisma.webhookEvent.count({
      where: { stripeEventId: 'evt_dup' },
    });
    expect(dedupeCount).toBe(1);

    const membershipCount = await prisma.membership.count({
      where: { userId: USER },
    });
    expect(membershipCount).toBe(1);
  });

  it('rejects bad signatures with 400 and records no WebhookEvent (AE8)', async () => {
    fakeVerifier.throwOnNextVerify();
    const before = await prisma.webhookEvent.count();

    await request(app.getHttpServer())
      .post('/webhooks/stripe')
      .set('stripe-signature', 't=1,v1=garbage')
      .set('content-type', 'application/json')
      .send(Buffer.from('{}'))
      .expect(400);

    const after = await prisma.webhookEvent.count();
    expect(after).toBe(before);
  });

  it('returns 400 when Stripe-Signature header is missing', async () => {
    await request(app.getHttpServer())
      .post('/webhooks/stripe')
      .set('content-type', 'application/json')
      .send(Buffer.from('{}'))
      .expect(400);
  });

  it('transitions ACTIVE → ACTIVE+cancelAtPeriodEnd → CANCELED via three webhook events (AE6)', async () => {
    // 1. subscription.created — active
    seedActiveGoldSub(fakeStripe, false);
    fakeVerifier.queueEvent(
      makeStripeEvent(
        'customer.subscription.created',
        { id: SUB_ID, customer: CUSTOMER },
        'evt_seq_1',
      ),
    );
    await request(app.getHttpServer())
      .post('/webhooks/stripe')
      .set('stripe-signature', 't=1,v1=ok')
      .set('content-type', 'application/json')
      .send(Buffer.from('{}'))
      .expect(200);

    let row = await prisma.membership.findUnique({ where: { userId: USER } });
    expect(row?.status).toBe(SubscriptionStatus.ACTIVE);
    expect(row?.cancelAtPeriodEnd).toBe(false);

    // 2. subscription.updated — cancel scheduled
    fakeStripe.subscriptions.clear();
    seedActiveGoldSub(fakeStripe, true);
    fakeVerifier.queueEvent(
      makeStripeEvent(
        'customer.subscription.updated',
        { id: SUB_ID, customer: CUSTOMER },
        'evt_seq_2',
      ),
    );
    await request(app.getHttpServer())
      .post('/webhooks/stripe')
      .set('stripe-signature', 't=1,v1=ok')
      .set('content-type', 'application/json')
      .send(Buffer.from('{}'))
      .expect(200);

    row = await prisma.membership.findUnique({ where: { userId: USER } });
    expect(row?.status).toBe(SubscriptionStatus.ACTIVE);
    expect(row?.cancelAtPeriodEnd).toBe(true);

    // 3. subscription.deleted — Stripe removes it from list; mirror flips to CANCELED.
    fakeStripe.subscriptions.clear();
    fakeVerifier.queueEvent(
      makeStripeEvent(
        'customer.subscription.deleted',
        { id: SUB_ID, customer: CUSTOMER },
        'evt_seq_3',
      ),
    );
    await request(app.getHttpServer())
      .post('/webhooks/stripe')
      .set('stripe-signature', 't=1,v1=ok')
      .set('content-type', 'application/json')
      .send(Buffer.from('{}'))
      .expect(200);

    row = await prisma.membership.findUnique({ where: { userId: USER } });
    expect(row?.status).toBe(SubscriptionStatus.CANCELED);
  });

  it('reflects PAST_DUE when invoice.payment_failed accompanies a past_due subscription', async () => {
    const sub = seedActiveGoldSub(fakeStripe, false);
    sub.status = 'past_due';

    fakeVerifier.queueEvent(
      makeStripeEvent(
        'invoice.payment_failed',
        {
          id: 'in_test',
          customer: CUSTOMER,
          subscription: SUB_ID,
          attempt_count: 1,
        },
        'evt_inv_fail',
      ),
    );
    await request(app.getHttpServer())
      .post('/webhooks/stripe')
      .set('stripe-signature', 't=1,v1=ok')
      .set('content-type', 'application/json')
      .send(Buffer.from('{}'))
      .expect(200);

    const row = await prisma.membership.findUnique({
      where: { userId: USER },
    });
    expect(row?.status).toBe(SubscriptionStatus.PAST_DUE);
  });

  it('acknowledges unknown event types with 200 and records the dedupe row', async () => {
    fakeVerifier.queueEvent(
      makeStripeEvent(
        'payment_intent.requires_action',
        { id: 'pi_test', customer: CUSTOMER },
        'evt_unknown',
      ),
    );
    await request(app.getHttpServer())
      .post('/webhooks/stripe')
      .set('stripe-signature', 't=1,v1=ok')
      .set('content-type', 'application/json')
      .send(Buffer.from('{}'))
      .expect(200);

    const row = await prisma.webhookEvent.findUnique({
      where: { stripeEventId: 'evt_unknown' },
    });
    expect(row?.type).toBe('payment_intent.requires_action');
  });

  describe('payment-mode checkout → Ticket issuance', () => {
    let orgDbId: string;
    let eventDbId: string;
    let ticketTypeDbId: string;

    beforeEach(async () => {
      // Seed an Org/Event/TicketType per test — the outer beforeEach
      // truncates them so the membership tests stay isolated.
      const org = await prisma.organization.create({
        data: {
          name: 'WH Org',
          slug: 'wh-org',
          createdBy: USER,
          members: { create: { userId: USER, role: OrganizationRole.OWNER } },
        },
      });
      orgDbId = org.id;
      const ev = await prisma.event.create({
        data: {
          organizationId: org.id,
          title: 'Webhook Event',
          slug: 'webhook-event',
          startsAt: new Date('2026-06-01T18:00:00Z'),
          status: EventStatus.PUBLISHED,
          publishedAt: new Date(),
          createdBy: USER,
        },
      });
      eventDbId = ev.id;
      const tt = await prisma.ticketType.create({
        data: {
          eventId: ev.id,
          name: 'GA',
          priceCents: 5000,
          stripeProductId: `prod_wh_${ev.id}`,
          stripePriceId: `price_wh_${ev.id}`,
        },
      });
      ticketTypeDbId = tt.id;
    });

    function makePaymentSessionEvent(
      overrides: {
        sessionId?: string;
        eventId?: string;
        userIdMeta?: string;
        clientRef?: string | null;
        ticketTypeId?: string;
        paymentIntent?: string | null;
      } = {},
    ): Stripe.Event {
      const sessionId = overrides.sessionId ?? 'cs_pay_1';
      return makeStripeEvent(
        'checkout.session.completed',
        {
          id: sessionId,
          mode: 'payment',
          customer: CUSTOMER,
          client_reference_id:
            overrides.clientRef === null ? null : (overrides.clientRef ?? USER),
          payment_intent: overrides.paymentIntent ?? `pi_${sessionId}`,
          metadata: {
            userId: overrides.userIdMeta ?? USER,
            eventId: overrides.eventId ?? eventDbId,
            ticketTypeId: overrides.ticketTypeId ?? ticketTypeDbId,
          },
        },
        `evt_${sessionId}`,
      );
    }

    it('issues a PAID Ticket on a payment-mode checkout.session.completed (AE3 buy half)', async () => {
      fakeVerifier.queueEvent(makePaymentSessionEvent());

      await request(app.getHttpServer())
        .post('/webhooks/stripe')
        .set('stripe-signature', 't=1,v1=ok')
        .set('content-type', 'application/json')
        .send(Buffer.from('{}'))
        .expect(200);

      const tickets = await prisma.ticket.findMany({
        where: { userId: USER, eventId: eventDbId },
      });
      expect(tickets).toHaveLength(1);
      expect(tickets[0]).toMatchObject({
        source: TicketSource.PAID,
        stripeCheckoutSessionId: 'cs_pay_1',
        stripePaymentIntentId: 'pi_cs_pay_1',
      });
    });

    it('dedupes a redelivered payment-mode webhook (one Ticket only)', async () => {
      fakeVerifier.queueEvent(makePaymentSessionEvent({ sessionId: 'cs_dup' }));
      fakeVerifier.queueEvent(makePaymentSessionEvent({ sessionId: 'cs_dup' }));

      await request(app.getHttpServer())
        .post('/webhooks/stripe')
        .set('stripe-signature', 't=1,v1=ok')
        .set('content-type', 'application/json')
        .send(Buffer.from('{}'))
        .expect(200);
      await request(app.getHttpServer())
        .post('/webhooks/stripe')
        .set('stripe-signature', 't=1,v1=ok')
        .set('content-type', 'application/json')
        .send(Buffer.from('{}'))
        .expect(200);

      const count = await prisma.ticket.count({
        where: { stripeCheckoutSessionId: 'cs_dup' },
      });
      expect(count).toBe(1);
    });

    it('skips issuance silently when the referenced TicketType was deleted', async () => {
      await prisma.ticketType.delete({ where: { id: ticketTypeDbId } });
      fakeVerifier.queueEvent(
        makePaymentSessionEvent({ sessionId: 'cs_deleted_tt' }),
      );

      await request(app.getHttpServer())
        .post('/webhooks/stripe')
        .set('stripe-signature', 't=1,v1=ok')
        .set('content-type', 'application/json')
        .send(Buffer.from('{}'))
        .expect(200);

      const tickets = await prisma.ticket.findMany();
      expect(tickets).toHaveLength(0);
    });

    it('refunds and skips when client_reference_id and metadata.userId disagree', async () => {
      fakeVerifier.queueEvent(
        makePaymentSessionEvent({
          sessionId: 'cs_tampered',
          clientRef: 'someone-else',
        }),
      );

      await request(app.getHttpServer())
        .post('/webhooks/stripe')
        .set('stripe-signature', 't=1,v1=ok')
        .set('content-type', 'application/json')
        .send(Buffer.from('{}'))
        .expect(200);

      const tickets = await prisma.ticket.findMany();
      expect(tickets).toHaveLength(0);

      const refundCalls = fakeStripe.callsFor('refunds.create');
      expect(refundCalls).toHaveLength(1);
      expect(refundCalls[0].args[0]).toMatchObject({
        payment_intent: 'pi_cs_tampered',
      });
    });

    it('refunds and skips when metadata.eventId does not match the TicketType.eventId', async () => {
      // Seed a second event so metadata can reference an event that exists
      // but doesn't own the ticket type — distinct from the deleted-TT path.
      const otherEv = await prisma.event.create({
        data: {
          organizationId: (
            await prisma.organization.findFirstOrThrow({
              where: { slug: 'wh-org' },
            })
          ).id,
          title: 'Other',
          slug: 'wh-other',
          startsAt: new Date('2026-06-02T18:00:00Z'),
          status: EventStatus.PUBLISHED,
          publishedAt: new Date(),
          createdBy: USER,
        },
      });

      fakeVerifier.queueEvent(
        makePaymentSessionEvent({
          sessionId: 'cs_event_mismatch',
          eventId: otherEv.id,
        }),
      );

      await request(app.getHttpServer())
        .post('/webhooks/stripe')
        .set('stripe-signature', 't=1,v1=ok')
        .set('content-type', 'application/json')
        .send(Buffer.from('{}'))
        .expect(200);

      const tickets = await prisma.ticket.findMany();
      expect(tickets).toHaveLength(0);

      const refundCalls = fakeStripe.callsFor('refunds.create');
      expect(refundCalls).toHaveLength(1);
    });

    describe('waitlist PAID reconciliation (U7)', () => {
      function postWebhook() {
        return request(app.getHttpServer())
          .post('/webhooks/stripe')
          .set('stripe-signature', 't=1,v1=ok')
          .set('content-type', 'application/json')
          .send(Buffer.from('{}'));
      }

      // Seed an approved (by default) PAID request linked to a session id — the
      // back-link that routes the webhook into the reconciliation path.
      async function seedWaitlistRequest(opts: {
        sessionId: string;
        status?: TicketRequestStatus;
        userId?: string;
        startsAt?: Date;
      }): Promise<string> {
        if (opts.startsAt) {
          await prisma.event.update({
            where: { id: eventDbId },
            data: { startsAt: opts.startsAt },
          });
        }
        const req = await prisma.ticketRequest.create({
          data: {
            userId: opts.userId ?? USER,
            ticketTypeId: ticketTypeDbId,
            eventId: eventDbId,
            intent: TicketRequestIntent.PAID,
            status: opts.status ?? TicketRequestStatus.APPROVED,
            stripeCheckoutSessionId: opts.sessionId,
          },
        });
        return req.id;
      }

      function makeWaitlistCompletedEvent(opts: {
        sessionId: string;
        requestId: string;
        userId?: string;
      }): Stripe.Event {
        return makeStripeEvent(
          'checkout.session.completed',
          {
            id: opts.sessionId,
            mode: 'payment',
            customer: CUSTOMER,
            client_reference_id: opts.userId ?? USER,
            payment_intent: `pi_${opts.sessionId}`,
            metadata: {
              userId: opts.userId ?? USER,
              eventId: eventDbId,
              ticketTypeId: ticketTypeDbId,
              ticketRequestId: opts.requestId,
            },
          },
          `evt_${opts.sessionId}`,
        );
      }

      it('issues a linked PAID Ticket for an APPROVED waitlist session', async () => {
        const reqId = await seedWaitlistRequest({ sessionId: 'cs_wl_ok' });
        fakeVerifier.queueEvent(
          makeWaitlistCompletedEvent({
            sessionId: 'cs_wl_ok',
            requestId: reqId,
          }),
        );

        await postWebhook().expect(200);

        const ticket = await prisma.ticket.findUnique({
          where: { ticketRequestId: reqId },
        });
        expect(ticket).toMatchObject({
          source: TicketSource.PAID,
          stripeCheckoutSessionId: 'cs_wl_ok',
        });
        const reqRow = await prisma.ticketRequest.findUnique({
          where: { id: reqId },
        });
        expect(reqRow?.status).toBe(TicketRequestStatus.APPROVED);
        expect(fakeStripe.refunds).toHaveLength(0);
      });

      it('expires an APPROVED unpaid request on checkout.session.expired + emits (AE11)', async () => {
        const reqId = await seedWaitlistRequest({ sessionId: 'cs_wl_exp' });
        const hub = app.get(WaitlistStream);
        const received = firstValueFrom(
          hub.stream(orgDbId).pipe(
            filter((e) => e.type === 'request.updated'),
            take(1),
          ),
        );
        fakeVerifier.queueEvent(
          makeStripeEvent(
            'checkout.session.expired',
            { id: 'cs_wl_exp' },
            'evt_cs_wl_exp',
          ),
        );

        await postWebhook().expect(200);

        const reqRow = await prisma.ticketRequest.findUnique({
          where: { id: reqId },
        });
        expect(reqRow?.status).toBe(TicketRequestStatus.EXPIRED);
        expect(
          await prisma.ticket.findUnique({ where: { ticketRequestId: reqId } }),
        ).toBeNull();
        expect((await received).type).toBe('request.updated');
      });

      it('refunds + logs and issues nothing when the request was cancelled (AE11)', async () => {
        const reqId = await seedWaitlistRequest({
          sessionId: 'cs_wl_cancel',
          status: TicketRequestStatus.CANCELLED_BY_USER,
        });
        fakeVerifier.queueEvent(
          makeWaitlistCompletedEvent({
            sessionId: 'cs_wl_cancel',
            requestId: reqId,
          }),
        );

        await postWebhook().expect(200);

        expect(
          await prisma.ticket.findUnique({ where: { ticketRequestId: reqId } }),
        ).toBeNull();
        expect(fakeStripe.refunds).toHaveLength(1);
        expect(fakeStripe.refunds[0]).toMatchObject({
          payment_intent: 'pi_cs_wl_cancel',
          idempotencyKey: 'waitlist-refund-cs_wl_cancel',
        });
        const log = await prisma.refundLog.findUnique({
          where: { stripeCheckoutSessionId: 'cs_wl_cancel' },
        });
        expect(log).toMatchObject({
          stripePaymentIntentId: 'pi_cs_wl_cancel',
          ticketRequestId: reqId,
        });
      });

      it('refunds when the event already started (R24)', async () => {
        const reqId = await seedWaitlistRequest({
          sessionId: 'cs_wl_started',
          startsAt: new Date('2020-01-01T00:00:00Z'),
        });
        fakeVerifier.queueEvent(
          makeWaitlistCompletedEvent({
            sessionId: 'cs_wl_started',
            requestId: reqId,
          }),
        );

        await postWebhook().expect(200);

        expect(
          await prisma.ticket.findUnique({ where: { ticketRequestId: reqId } }),
        ).toBeNull();
        expect(fakeStripe.refunds).toHaveLength(1);
      });

      it('refunds when the locked request userId differs from metadata.userId (sec-M1)', async () => {
        const reqId = await seedWaitlistRequest({
          sessionId: 'cs_wl_owner',
          userId: 'other-user',
        });
        // metadata + client_reference_id both claim USER (so the pre-tx tamper
        // check passes), but the locked request is owned by other-user.
        fakeVerifier.queueEvent(
          makeWaitlistCompletedEvent({
            sessionId: 'cs_wl_owner',
            requestId: reqId,
            userId: USER,
          }),
        );

        await postWebhook().expect(200);

        expect(
          await prisma.ticket.findUnique({ where: { ticketRequestId: reqId } }),
        ).toBeNull();
        expect(fakeStripe.refunds).toHaveLength(1);
      });

      it('dedupes a redelivered completion after the Ticket exists (AE16)', async () => {
        const reqId = await seedWaitlistRequest({ sessionId: 'cs_wl_dup' });
        fakeVerifier.queueEvent(
          makeWaitlistCompletedEvent({
            sessionId: 'cs_wl_dup',
            requestId: reqId,
          }),
        );
        fakeVerifier.queueEvent(
          makeWaitlistCompletedEvent({
            sessionId: 'cs_wl_dup',
            requestId: reqId,
          }),
        );

        await postWebhook().expect(200);
        await postWebhook().expect(200);

        const tickets = await prisma.ticket.findMany({
          where: { ticketRequestId: reqId },
        });
        expect(tickets).toHaveLength(1);
        expect(fakeStripe.refunds).toHaveLength(0);
      });

      it('refunds a dead-request completion at most once across redeliveries', async () => {
        const reqId = await seedWaitlistRequest({
          sessionId: 'cs_wl_dead_dup',
          status: TicketRequestStatus.REJECTED,
        });
        fakeVerifier.queueEvent(
          makeWaitlistCompletedEvent({
            sessionId: 'cs_wl_dead_dup',
            requestId: reqId,
          }),
        );
        fakeVerifier.queueEvent(
          makeWaitlistCompletedEvent({
            sessionId: 'cs_wl_dead_dup',
            requestId: reqId,
          }),
        );

        await postWebhook().expect(200);
        await postWebhook().expect(200);

        expect(fakeStripe.refunds).toHaveLength(1);
        const logs = await prisma.refundLog.findMany({
          where: { stripeCheckoutSessionId: 'cs_wl_dead_dup' },
        });
        expect(logs).toHaveLength(1);
      });
    });
  });
});
