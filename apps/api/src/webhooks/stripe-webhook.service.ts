import { Injectable, Logger } from '@nestjs/common';
import {
  DonationStatus,
  PaymentEventKind,
  PaymentEventStatus,
  Prisma,
  TicketRequestStatus,
  TicketSource,
} from '@organizer-hub/db/api';
import { MembershipsService } from '../memberships/memberships.service';
import { PrismaService } from '../prisma/prisma.service';
import { StripeClient } from '../billing/stripe.client';
import { recordProcessedWebhookEvent } from '../billing/webhook-event.helper';
import { PaymentEventsService } from '../payment-events/payment-events.service';
import { WaitlistStream } from '../realtime/waitlist-stream';
import { HOUSE_ORG_ID } from '../common/house-org';
import type { Stripe } from '../billing/stripe-types';

// Subscription-relevant events that route directly to syncStripeData.
// customer.subscription.deleted and invoice.payment_failed are intercepted
// earlier in handle() for donation-aware routing and never reach this branch.
const SUBSCRIPTION_EVENTS = new Set([
  'customer.subscription.created',
  'customer.subscription.updated',
  'invoice.paid',
]);

const COMPLETED = 'checkout.session.completed';

interface CheckoutSessionLike {
  id: string;
  mode?: 'subscription' | 'payment' | 'setup' | null;
  customer?: string | { id: string } | null;
  client_reference_id?: string | null;
  payment_intent?: string | { id: string } | null;
  metadata?: Record<string, string | undefined> | null;
}

// `recorded: true` means the service already wrote the WebhookEvent dedupe row
// (the payment issuance tx, or the dead-request refund branch). The controller
// then skips recording so the row is never written twice.
export interface WebhookHandleResult {
  recorded: boolean;
}

// Row shape from the FOR UPDATE re-read of a waitlist request + its event/tier.
interface LockedWaitlistRow {
  id: string;
  status: string;
  user_id: string;
  ticket_type_id: string;
  event_id: string;
  organization_id: string;
  starts_at: Date;
  price_cents: number;
}

type ReconcileOutcome =
  | { kind: 'issued'; ctx: LockedWaitlistRow }
  | { kind: 'already_issued'; ctx: LockedWaitlistRow }
  | { kind: 'dead'; reason: string; ctx: LockedWaitlistRow | null };

@Injectable()
export class StripeWebhookService {
  private readonly logger = new Logger(StripeWebhookService.name);

  constructor(
    private readonly memberships: MembershipsService,
    private readonly prisma: PrismaService,
    private readonly stripeClient: StripeClient,
    private readonly stream: WaitlistStream,
    private readonly paymentEvents: PaymentEventsService,
  ) {}

  async handle(event: Stripe.Event): Promise<WebhookHandleResult> {
    if (event.type === COMPLETED) {
      return this.handleCheckoutCompleted(event);
    }
    if (event.type === 'checkout.session.expired') {
      return this.handleCheckoutExpired(event);
    }

    // 'checkout.session.created' is a real Stripe event but is absent from the
    // SDK v22 Event['type'] union for this apiVersion; comparison needs the
    // cast to widen `event.type` to a plain string.
    if ((event.type as string) === 'checkout.session.created') {
      return this.handleCheckoutCreated(event);
    }

    if (
      event.type === 'payment_intent.succeeded' ||
      event.type === 'payment_intent.payment_failed' ||
      event.type === 'payment_intent.canceled'
    ) {
      return this.handlePaymentIntentTerminal(event);
    }

    if (event.type === 'charge.refunded') {
      return this.handleChargeRefunded(event);
    }
    if (event.type === 'charge.dispute.created') {
      return this.handleChargeDisputed(event);
    }
    if (event.type === 'invoice.payment_succeeded') {
      return this.handleInvoicePaid(event);
    }

    if (event.type === 'customer.subscription.deleted') {
      return this.handleSubscriptionDeleted(event);
    }
    if (event.type === 'invoice.payment_failed') {
      return this.handleInvoicePaymentFailed(event);
    }

    // Donation subscriptions are created with price_data and carry no
    // lookup_key; routing them through syncStripeData would throw inside
    // tierForLookupKey. The donation lifecycle is driven entirely by
    // checkout.session.* and invoice.* events; subscription state changes
    // are informational here and intentionally a no-op.
    if (
      (event.type as string) === 'customer.subscription.created' ||
      (event.type as string) === 'customer.subscription.updated'
    ) {
      const sub = event.data.object as {
        id: string;
        metadata?: Record<string, string | undefined> | null;
      };
      const subMeta =
        (sub.metadata as Record<string, string | undefined>) ?? {};
      if (subMeta.source === 'donation') {
        this.logger.debug(
          `${event.type} ${event.id} sub=${sub.id} source=donation; skipping membership sync`,
        );
        return { recorded: false };
      }
    }

    if (SUBSCRIPTION_EVENTS.has(event.type)) {
      const customerId = this.extractCustomerId(event);
      if (!customerId) {
        this.logger.warn(
          `${event.type} ${event.id} has no resolvable customer id; skipping sync`,
        );
        return { recorded: false };
      }
      await this.memberships.syncStripeData(customerId);
      return { recorded: false };
    }

    this.logger.debug(`Ignoring event type ${event.type}`);
    return { recorded: false };
  }

  private async handleCheckoutCompleted(
    event: Stripe.Event,
  ): Promise<WebhookHandleResult> {
    const session = event.data.object as CheckoutSessionLike;
    const customerId = this.unwrapId(session.customer);

    // Donation sessions must be intercepted BEFORE the mode-based branches.
    // A one-time donation also has mode='payment', so without this guard it
    // would fall through to issueTicketFromSession and mint a free Ticket.
    if (session.metadata?.source === 'donation') {
      return this.handleDonationCheckoutCompleted(session, event.id);
    }

    if (session.mode === 'payment') {
      return this.issueTicketFromSession(event.id, session);
    }

    // 'subscription' mode (and the legacy/unset case) flow through the
    // same membership sync as the subscription.* events.
    if (!customerId) {
      this.logger.warn(
        `checkout.session.completed ${event.id} has no customer id; skipping sync`,
      );
      return { recorded: false };
    }
    await this.memberships.syncStripeData(customerId);
    return { recorded: false };
  }

  // Resolves the Donation row for a completed donation Checkout Session and
  // updates it to reflect the new state:
  //   - mode=payment  (one-time):   PENDING -> COMPLETED, stamp stripeCustomerId
  //   - mode=subscription (recurring): stamp stripeCustomerId + stripeSubscriptionId,
  //     leave status at PENDING (U11 will promote to ACTIVE on invoice.paid)
  //
  // Also stamps donationId on the existing PENDING DONATION PaymentEvent that
  // handleCheckoutCreated wrote with stripeCheckoutSessionId — without this
  // stamp the Phase D aggregates (raisedCents/donorCount) never resolve for
  // one-time donations because they JOIN payment_events via donation_id.
  private async handleDonationCheckoutCompleted(
    session: CheckoutSessionLike,
    webhookEventId: string,
  ): Promise<WebhookHandleResult> {
    const donationId = session.metadata?.donationId;
    let donation: { id: string; status: DonationStatus } | null = null;

    if (donationId) {
      donation = await this.prisma.donation.findUnique({
        where: { id: donationId },
        select: { id: true, status: true },
      });
    }
    if (!donation) {
      // Fallback: match by session id (handles re-deliveries before metadata
      // was stamped, or edge cases where donationId wasn't set in metadata).
      donation = await this.prisma.donation.findFirst({
        where: { stripeCheckoutSessionId: session.id },
        select: { id: true, status: true },
      });
    }
    if (!donation) {
      this.logger.warn(
        `checkout.session.completed ${webhookEventId} source=donation but no Donation row found (sessionId=${session.id} donationId=${donationId ?? 'none'}); ignoring`,
      );
      return { recorded: false };
    }

    const stripeCustomerId = this.unwrapId(session.customer);
    const sessionWithSub = session as CheckoutSessionLike & {
      subscription?: string | { id: string } | null;
    };

    if (
      session.mode === 'payment' &&
      donation.status === DonationStatus.PENDING
    ) {
      await this.prisma.donation.update({
        where: { id: donation.id },
        data: {
          status: DonationStatus.COMPLETED,
          stripeCustomerId,
        },
      });
    } else if (
      session.mode === 'subscription' &&
      donation.status === DonationStatus.PENDING
    ) {
      const stripeSubscriptionId = this.unwrapId(sessionWithSub.subscription);
      await this.prisma.donation.update({
        where: { id: donation.id },
        data: {
          stripeCustomerId,
          stripeSubscriptionId,
          // status stays PENDING; U11 promotes to ACTIVE on invoice.paid
        },
      });
    }

    // Stamp donationId on the PENDING DONATION PaymentEvent created by
    // handleCheckoutCreated. Without this stamp, one-time donations never
    // appear in raisedCents/donorCount aggregates because those JOIN
    // payment_events via donation_id (recurring donations get their own
    // fresh row in U11, but one-time ones only ever have this row).
    // Use findFirst because stripeCheckoutSessionId is not yet unique on
    // PaymentEvent.
    const existingPe = await this.prisma.paymentEvent.findFirst({
      where: { stripeCheckoutSessionId: session.id, kind: 'DONATION' },
    });
    if (existingPe && existingPe.donationId !== donation.id) {
      await this.prisma.paymentEvent.update({
        where: { id: existingPe.id },
        data: { donationId: donation.id },
      });
    }

    return { recorded: false };
  }

  // A waitlist session is identified by the server-written stripeCheckoutSessionId
  // back-link on a TicketRequest (authoritative — never the metadata flag alone,
  // so a metadata-stripped waitlist session can't fall through to the
  // unconditional path). With a back-link it goes through the row-locked
  // reconciliation; without one it is an under-cap direct purchase (unchanged
  // Phase 3 path).
  private async issueTicketFromSession(
    webhookEventId: string,
    session: CheckoutSessionLike,
  ): Promise<WebhookHandleResult> {
    const waitlist = await this.prisma.ticketRequest.findUnique({
      where: { stripeCheckoutSessionId: session.id },
      select: { id: true },
    });
    if (waitlist) {
      return this.reconcileWaitlistPayment(webhookEventId, session);
    }
    await this.issueDirectTicket(webhookEventId, session);
    return { recorded: false };
  }

  // Waitlist reconciliation (R24, R25, AE11, AE16): inside one tx, SELECT … FOR
  // UPDATE the request row and issue a Ticket ONLY IF it is still APPROVED and
  // the event has not started; otherwise issue nothing. The dedupe row is
  // recorded inside the same tx on the issue branch. On the dead-request
  // branch the refund runs FIRST (commit-then-refund, idempotency-keyed), then
  // the durable RefundLog, then the dedupe row last — so a crash anywhere
  // before the dedupe row leaves Stripe to redeliver and safely retry.
  private async reconcileWaitlistPayment(
    webhookEventId: string,
    session: CheckoutSessionLike,
  ): Promise<WebhookHandleResult> {
    const metaUserId = session.metadata?.userId;
    const metaTicketRequestId = session.metadata?.ticketRequestId;
    const clientRef = session.client_reference_id;
    const paymentIntentId = this.unwrapId(session.payment_intent);

    // client_reference_id is server-set and must match metadata.userId; a
    // mismatch is tampering — refund without ever touching the request.
    if (clientRef != null && metaUserId && clientRef !== metaUserId) {
      this.logger.error(
        `${COMPLETED} ${webhookEventId} session ${session.id} client_reference_id mismatch (ref=${clientRef} meta=${metaUserId}); refunding`,
      );
      await this.refundDeadRequest(
        paymentIntentId,
        session.id,
        null,
        0,
        'client_ref_mismatch',
      );
      await recordProcessedWebhookEvent(this.prisma, webhookEventId, COMPLETED);
      return { recorded: true };
    }

    const now = new Date();
    const outcome = await this.prisma.$transaction(
      async (tx): Promise<ReconcileOutcome> => {
        const rows = await tx.$queryRaw<LockedWaitlistRow[]>`
          SELECT tr.id, tr.status::text AS status, tr.user_id,
                 tr.ticket_type_id, tr.event_id,
                 e.starts_at, e.organization_id, tt.price_cents
          FROM ticket_requests tr
          JOIN events e ON e.id = tr.event_id
          JOIN ticket_types tt ON tt.id = tr.ticket_type_id
          WHERE tr.stripe_checkout_session_id = ${session.id}
          FOR UPDATE OF tr
        `;
        const locked = rows[0];
        if (!locked) {
          return { kind: 'dead', reason: 'request_not_found', ctx: null };
        }
        if (metaUserId && locked.user_id !== metaUserId) {
          return { kind: 'dead', reason: 'user_mismatch', ctx: locked };
        }
        if (metaTicketRequestId && metaTicketRequestId !== locked.id) {
          return { kind: 'dead', reason: 'request_id_mismatch', ctx: locked };
        }
        const payable = locked.status === 'APPROVED' && locked.starts_at > now;
        if (!payable) {
          return {
            kind: 'dead',
            reason:
              locked.status !== 'APPROVED'
                ? `not_payable_${locked.status.toLowerCase()}`
                : 'event_started',
            ctx: locked,
          };
        }
        try {
          await tx.ticket.create({
            data: {
              userId: locked.user_id,
              eventId: locked.event_id,
              ticketTypeId: locked.ticket_type_id,
              source: TicketSource.PAID,
              ticketRequestId: locked.id,
              stripeCheckoutSessionId: session.id,
              stripePaymentIntentId: paymentIntentId,
            },
          });
          await recordProcessedWebhookEvent(tx, webhookEventId, COMPLETED);
          return { kind: 'issued', ctx: locked };
        } catch (err) {
          if (
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === 'P2002'
          ) {
            // Redelivery after the Ticket already exists — not a refund case.
            return { kind: 'already_issued', ctx: locked };
          }
          throw err;
        }
      },
    );

    if (outcome.kind === 'dead') {
      this.logger.error(
        `${COMPLETED} ${webhookEventId} session ${session.id} completed against a non-payable request (${outcome.reason}); refunding`,
      );
      await this.refundDeadRequest(
        paymentIntentId,
        session.id,
        outcome.ctx?.id ?? null,
        outcome.ctx?.price_cents ?? 0,
        outcome.reason,
      );
      await recordProcessedWebhookEvent(this.prisma, webhookEventId, COMPLETED);
    }
    return { recorded: true };
  }

  // commit-then-refund: refund first (idempotency key → at most one real refund
  // across redeliveries), then the durable RefundLog (UPSERT on the unique
  // session id → one record), then the caller records the dedupe row.
  private async refundDeadRequest(
    paymentIntentId: string | null,
    sessionId: string,
    ticketRequestId: string | null,
    amountCents: number,
    reason: string,
  ): Promise<void> {
    if (paymentIntentId) {
      try {
        await this.stripeClient.stripe.refunds.create(
          { payment_intent: paymentIntentId },
          { idempotencyKey: `waitlist-refund-${sessionId}` },
        );
      } catch (err) {
        this.logger.error(
          `Auto-refund failed for session ${sessionId} (pi ${paymentIntentId}): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    try {
      await this.prisma.refundLog.upsert({
        where: { stripeCheckoutSessionId: sessionId },
        create: {
          stripeCheckoutSessionId: sessionId,
          stripePaymentIntentId: paymentIntentId,
          ticketRequestId,
          reason,
          amountCents,
        },
        update: {},
      });
    } catch (err) {
      this.logger.error(
        `Failed to record RefundLog for session ${sessionId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    this.logger.warn(
      `Auto-refunded dead-request payment for session ${sessionId} (reason=${reason})`,
    );
  }

  // checkout.session.expired (R18): the PAID Checkout link lapsed unpaid. CAS
  // APPROVED -> EXPIRED and emit; no email. The scheduler (U9) is a backstop if
  // this event is missed. A non-waitlist (membership) expiry is a no-op here.
  private async handleCheckoutExpired(
    event: Stripe.Event,
  ): Promise<WebhookHandleResult> {
    const session = event.data.object as CheckoutSessionLike;
    const req = await this.prisma.ticketRequest.findUnique({
      where: { stripeCheckoutSessionId: session.id },
      include: { event: { select: { organizationId: true } } },
    });
    if (!req) return { recorded: false };

    const { count } = await this.prisma.ticketRequest.updateMany({
      where: { id: req.id, status: TicketRequestStatus.APPROVED },
      data: { status: TicketRequestStatus.EXPIRED },
    });
    if (count === 1) {
      this.stream.emit(req.event.organizationId, {
        type: 'request.updated',
        id: req.id,
        data: { id: req.id, status: TicketRequestStatus.EXPIRED },
      });
    }
    return { recorded: false };
  }

  // Insert a PENDING PaymentEvent row reflecting the session the user just
  // started. The kind is derived from metadata.source set on the Checkout
  // Session at creation time. PI may not yet be set by Stripe at this
  // point — that's fine, we resolve it on succeeded.
  private async handleCheckoutCreated(
    event: Stripe.Event,
  ): Promise<WebhookHandleResult> {
    const session = event.data.object as CheckoutSessionLike & {
      amount_total?: number | null;
      currency?: string | null;
    };
    const source = session.metadata?.source;
    const userId = session.metadata?.userId ?? session.client_reference_id;
    if (!source || !userId) {
      this.logger.debug(
        `checkout.session.created ${event.id} missing source/userId metadata; ignoring`,
      );
      return { recorded: false };
    }
    const kindMap: Record<string, PaymentEventKind> = {
      ticket: PaymentEventKind.TICKET,
      membership: PaymentEventKind.MEMBERSHIP,
      donation: PaymentEventKind.DONATION,
    };
    const kind = kindMap[source];
    if (!kind) {
      this.logger.warn(
        `checkout.session.created ${event.id} unknown source=${source}`,
      );
      return { recorded: false };
    }
    await this.paymentEvents.upsertPendingCharge(this.prisma, {
      userId,
      kind,
      amountCents: session.amount_total ?? 0,
      currency: session.currency ?? 'usd',
      stripeCustomerId: this.unwrapId(session.customer),
      stripePaymentIntentId: this.unwrapId(session.payment_intent),
      stripeCheckoutSessionId: session.id,
      ticketRequestId: session.metadata?.ticketRequestId ?? null,
      donationId:
        kind === PaymentEventKind.DONATION
          ? (session.metadata?.donationId ?? null)
          : null,
    });
    return { recorded: false };
  }

  // Resolve the PENDING ledger row by PI and write its terminal status.
  // Ordering with checkout.session.completed: this is fine to fire either
  // before or after — the ticket/membership creation in completed sets
  // its own state; here we only touch the PaymentEvent row.
  private async handlePaymentIntentTerminal(
    event: Stripe.Event,
  ): Promise<WebhookHandleResult> {
    const pi = event.data.object as {
      id: string;
      last_payment_error?: { message?: string } | null;
    };
    this.logger.debug(`${event.type} ${event.id} pi=${pi.id}`);
    if (event.type === 'payment_intent.succeeded') {
      await this.paymentEvents.finalizeCharge(this.prisma, pi.id, {
        status: PaymentEventStatus.SUCCEEDED,
        succeededAt: new Date(),
      });
    } else if (event.type === 'payment_intent.payment_failed') {
      await this.paymentEvents.finalizeCharge(this.prisma, pi.id, {
        status: PaymentEventStatus.FAILED,
        failureReason: pi.last_payment_error?.message,
      });
    } else {
      await this.paymentEvents.finalizeCharge(this.prisma, pi.id, {
        status: PaymentEventStatus.CANCELED,
        canceledAt: new Date(),
      });
    }
    return { recorded: false };
  }

  // For every Refund object on the Charge, insert one PaymentEvent row.
  // Idempotent on stripeRefundId — Stripe sends charge.refunded for every
  // refund created, including replays. Partial refunds are supported by
  // the partial unique index on payment_events (WHERE kind NOT IN
  // ('REFUND','DISPUTE')).
  private async handleChargeRefunded(
    event: Stripe.Event,
  ): Promise<WebhookHandleResult> {
    const charge = event.data.object as {
      id: string;
      currency: string;
      customer?: string | null;
      payment_intent?: string | null;
      metadata?: Record<string, string | undefined> | null;
      refunds?: { data: Array<{ id: string; amount: number }> } | null;
    };
    this.logger.debug(`charge.refunded ${event.id} charge=${charge.id}`);
    const userId = charge.metadata?.userId;
    const piId = charge.payment_intent;
    if (!userId || !piId) {
      this.logger.warn(
        `charge.refunded ${event.id} missing userId/PI; skipping`,
      );
      return { recorded: false };
    }
    // Inherit donationId from the original charge PE if it was a DONATION.
    // Look up once outside the refund loop — all partial refunds share the same PI.
    const originalPe = await this.prisma.paymentEvent.findFirst({
      where: {
        stripePaymentIntentId: piId,
        kind: {
          in: [
            PaymentEventKind.TICKET,
            PaymentEventKind.MEMBERSHIP,
            PaymentEventKind.DONATION,
          ],
        },
        status: PaymentEventStatus.SUCCEEDED,
      },
      select: { kind: true, donationId: true },
    });
    let donationId =
      originalPe?.kind === PaymentEventKind.DONATION
        ? originalPe.donationId
        : null;

    // Guard: if a DISPUTE row for the same PI has already inherited the
    // donationId, suppress it here to prevent double-deduction. Both a
    // dispute and a refund on the same PI should only deduct once.
    if (donationId) {
      const existingDisputePe = await this.prisma.paymentEvent.findFirst({
        where: {
          stripePaymentIntentId: piId,
          kind: PaymentEventKind.DISPUTE,
          donationId: { not: null },
        },
        select: { id: true },
      });
      if (existingDisputePe) {
        this.logger.warn(
          `charge.refunded ${event.id} PI=${piId}: dispute already deducted campaign amount; setting REFUND donationId=null to avoid double-deduction`,
        );
        donationId = null;
      }
    }

    const refunds = charge.refunds?.data ?? [];
    for (const r of refunds) {
      await this.paymentEvents.insertRefund(this.prisma, {
        userId,
        amountCents: r.amount,
        currency: charge.currency,
        stripeCustomerId: charge.customer ?? null,
        stripePaymentIntentId: piId,
        stripeRefundId: r.id,
        stripeChargeId: charge.id,
        donationId,
      });
    }
    return { recorded: false };
  }

  private async handleChargeDisputed(
    event: Stripe.Event,
  ): Promise<WebhookHandleResult> {
    const dispute = event.data.object as {
      id: string;
      amount: number;
      currency: string;
      charge: string | { id: string };
      payment_intent?: string | { id: string } | null;
      metadata?: Record<string, string | undefined> | null;
    };
    this.logger.debug(
      `charge.dispute.created ${event.id} dispute=${dispute.id}`,
    );
    const chargeId = this.unwrapId(dispute.charge) ?? '';
    // Stripe sometimes doesn't propagate metadata onto the dispute — fall
    // back to looking up the charge.
    let userId = dispute.metadata?.userId;
    if (!userId) {
      try {
        const charge =
          await this.stripeClient.stripe.charges.retrieve(chargeId);
        userId = (charge.metadata as Record<string, string>)?.userId;
      } catch {
        // fall through to skip
      }
    }
    if (!userId) {
      this.logger.warn(
        `charge.dispute.created ${event.id} could not resolve userId; skipping`,
      );
      return { recorded: false };
    }

    // Inherit donationId from the original charge PE if it was a DONATION.
    const piId = this.unwrapId(dispute.payment_intent);
    let donationId: string | null = null;
    if (piId) {
      const originalPe = await this.prisma.paymentEvent.findFirst({
        where: {
          stripePaymentIntentId: piId,
          kind: {
            in: [
              PaymentEventKind.TICKET,
              PaymentEventKind.MEMBERSHIP,
              PaymentEventKind.DONATION,
            ],
          },
          status: PaymentEventStatus.SUCCEEDED,
        },
        select: { kind: true, donationId: true },
      });
      if (originalPe?.kind === PaymentEventKind.DONATION) {
        donationId = originalPe.donationId;
      }

      // Guard: if a REFUND row for the same PI has already inherited the
      // donationId, suppress it here to prevent double-deduction.
      if (donationId) {
        const existingRefundPe = await this.prisma.paymentEvent.findFirst({
          where: {
            stripePaymentIntentId: piId,
            kind: PaymentEventKind.REFUND,
            donationId: { not: null },
          },
          select: { id: true },
        });
        if (existingRefundPe) {
          this.logger.warn(
            `charge.dispute.created ${event.id} PI=${piId}: refund already deducted campaign amount; setting DISPUTE donationId=null to avoid double-deduction`,
          );
          donationId = null;
        }
      }
    }

    await this.paymentEvents.insertDispute(this.prisma, {
      userId,
      amountCents: dispute.amount,
      currency: dispute.currency,
      stripeChargeId: chargeId,
      stripePaymentIntentId: piId,
      stripeDisputeId: dispute.id,
      description: `Dispute ${dispute.id}`,
      donationId,
    });
    return { recorded: false };
  }

  // Subscription renewals. The first invoice for a new subscription rides
  // through checkout.session.created/completed → a PaymentEvent row was
  // ALREADY created there. For renewal invoices (subscription already
  // existed), we insert a new MEMBERSHIP row keyed on the renewal PI.
  //
  // Donation subscriptions are intercepted first (before the
  // subscription_create early-return) because the donation arm must promote
  // PENDING → ACTIVE on the first invoice even though no new PaymentEvent is
  // written for that first charge.
  private async handleInvoicePaid(
    event: Stripe.Event,
  ): Promise<WebhookHandleResult> {
    const inv = event.data.object as {
      id: string;
      amount_paid: number;
      currency: string;
      customer: string;
      payment_intent?: string | null;
      subscription?: string | null;
      billing_reason?: string;
      metadata?: Record<string, string | undefined> | null;
      // Stripe puts subscription metadata here in production when the invoice
      // does not carry its own metadata field (the common case for renewals).
      subscription_details?: {
        metadata?: Record<string, string | undefined> | null;
      } | null;
      charge?: string | null;
    };
    this.logger.debug(
      `invoice.payment_succeeded ${event.id} invoice=${inv.id} reason=${inv.billing_reason}`,
    );

    const resolvedSubMetadata = await this.resolveInvoiceSubMetadata(
      inv,
      event.id,
    );

    if (resolvedSubMetadata?.source === 'donation') {
      return this.handleDonationInvoicePaid(inv, resolvedSubMetadata, event.id);
    }

    // ---- Membership renewal path ----
    if (inv.billing_reason === 'subscription_create') {
      return { recorded: false }; // first invoice; already counted
    }
    if (!inv.payment_intent) {
      this.logger.warn(
        `invoice.payment_succeeded ${event.id} has no PI; skipping`,
      );
      return { recorded: false };
    }
    // resolvedSubMetadata already holds the single retrieve result (if one was
    // needed). No second retrieve.
    const userId: string | undefined =
      inv.metadata?.userId ?? resolvedSubMetadata?.userId;
    if (!userId) {
      this.logger.warn(
        `invoice.payment_succeeded ${event.id} could not resolve userId; skipping`,
      );
      return { recorded: false };
    }
    await this.paymentEvents.insertRenewal(this.prisma, {
      userId,
      amountCents: inv.amount_paid,
      currency: inv.currency,
      stripeCustomerId: inv.customer,
      stripePaymentIntentId: inv.payment_intent,
      stripeInvoiceId: inv.id,
    });
    return { recorded: false };
  }

  // Handles invoice.payment_succeeded for donation subscriptions.
  //
  // Always promotes Donation PENDING → ACTIVE (covers both the first-invoice
  // path and the edge case where a renewal arrives before payment_intent.succeeded
  // flipped the status).
  //
  // Does NOT write a new PaymentEvent for billing_reason='subscription_create'
  // because the checkout-session PaymentEvent (written by handleCheckoutCreated
  // and stamped with donationId by handleDonationCheckoutCompleted) already
  // covers that first charge — writing another row here would double-count it.
  //
  // For all subsequent invoices (billing_reason !== 'subscription_create') a
  // fresh kind=DONATION, status=SUCCEEDED PaymentEvent is inserted, idempotent
  // on stripeInvoiceId.
  private async handleDonationInvoicePaid(
    inv: {
      id: string;
      amount_paid: number;
      currency: string;
      customer: string;
      payment_intent?: string | null;
      subscription?: string | null;
      billing_reason?: string;
      charge?: string | null;
    },
    meta: Record<string, string | undefined>,
    webhookEventId: string,
  ): Promise<WebhookHandleResult> {
    // Resolve the Donation row: prefer explicit donationId in metadata, fall
    // back to subscription id lookup (covers edge cases where metadata is thin).
    let donation: {
      id: string;
      status: DonationStatus;
      userId: string;
      amountCents: number;
      currency: string;
    } | null = null;

    if (meta.donationId) {
      donation = await this.prisma.donation.findFirst({
        where: { id: meta.donationId },
        select: {
          id: true,
          status: true,
          userId: true,
          amountCents: true,
          currency: true,
        },
      });
    }
    if (!donation && inv.subscription) {
      donation = await this.prisma.donation.findFirst({
        where: { stripeSubscriptionId: inv.subscription },
        select: {
          id: true,
          status: true,
          userId: true,
          amountCents: true,
          currency: true,
        },
      });
    }
    if (!donation) {
      this.logger.warn(
        `invoice.payment_succeeded ${webhookEventId} source=donation but no Donation row found (donationId=${meta.donationId ?? 'none'} sub=${inv.subscription ?? 'none'}); ignoring`,
      );
      return { recorded: false };
    }

    // Guard: skip replayed invoices against a since-canceled donation so a
    // historical webhook replay does not pump fresh PaymentEvents into the ledger.
    if (donation.status === DonationStatus.CANCELED) {
      this.logger.warn(
        `invoice.payment_succeeded for canceled donation ${donation.id} (invoice ${inv.id}); skipping`,
      );
      return { recorded: false };
    }

    // Promote PENDING → ACTIVE regardless of billing_reason.
    if (donation.status === DonationStatus.PENDING) {
      await this.prisma.donation.update({
        where: { id: donation.id },
        data: { status: DonationStatus.ACTIVE },
      });
    }

    // First invoice: the original checkout-session PaymentEvent covers this
    // charge; writing another row here would double-count it.
    if (inv.billing_reason === 'subscription_create') {
      return { recorded: false };
    }

    // Renewal invoice: idempotent on stripeInvoiceId.
    // If a FAILED row already exists for this invoice (e.g. prior dunning
    // attempt), upgrade it in place to SUCCEEDED so raisedCents reflects the
    // actual successful charge. If it's already SUCCEEDED → no-op. If it's
    // PENDING → unexpected for an invoice-backed row; warn and skip.
    const existing = await this.prisma.paymentEvent.findFirst({
      where: { stripeInvoiceId: inv.id, kind: PaymentEventKind.DONATION },
    });
    if (existing) {
      if (existing.status === PaymentEventStatus.SUCCEEDED) {
        return { recorded: false };
      }
      if (existing.status === PaymentEventStatus.FAILED) {
        await this.prisma.paymentEvent.update({
          where: { id: existing.id },
          data: {
            status: PaymentEventStatus.SUCCEEDED,
            succeededAt: new Date(),
            amountCents: inv.amount_paid,
            stripePaymentIntentId: inv.payment_intent ?? null,
            stripeChargeId: inv.charge ?? null,
            failureReason: null,
          },
        });
        return { recorded: false };
      }
      // PENDING is unexpected for an invoice-backed row.
      this.logger.warn(
        `invoice.payment_succeeded ${webhookEventId} found existing ${existing.status} PE id=${existing.id} for invoice ${inv.id}; treating as already handled`,
      );
      return { recorded: false };
    }

    // No existing row — create a new SUCCEEDED PaymentEvent.
    // Wrap in try/catch to handle concurrent redelivery races: two deliveries
    // both pass the findFirst check (TOCTOU), then both attempt create; the
    // second hits either the (stripePaymentIntentId, kind) partial unique or
    // the new (stripeInvoiceId, kind)=DONATION partial unique and throws P2002.
    try {
      await this.prisma.paymentEvent.create({
        data: {
          organizationId: HOUSE_ORG_ID,
          userId: donation.userId,
          kind: PaymentEventKind.DONATION,
          status: PaymentEventStatus.SUCCEEDED,
          amountCents: inv.amount_paid,
          currency: inv.currency,
          donationId: donation.id,
          stripeInvoiceId: inv.id,
          stripePaymentIntentId: inv.payment_intent ?? null,
          stripeChargeId: inv.charge ?? null,
          stripeCustomerId: inv.customer,
          succeededAt: new Date(),
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return { recorded: false };
      }
      throw err;
    }
    return { recorded: false };
  }

  // Under-cap direct purchase → Ticket row (unchanged Phase 3 path). Cross-
  // validates metadata.userId vs client_reference_id (tamper check), re-fetches
  // the TicketType to confirm existence + eventId match, then issues. Any
  // integrity mismatch logs + auto-refunds.
  private async issueDirectTicket(
    eventId: string,
    session: CheckoutSessionLike,
  ): Promise<void> {
    const metaUserId = session.metadata?.userId;
    const metaEventId = session.metadata?.eventId;
    const metaTicketTypeId = session.metadata?.ticketTypeId;
    const clientRef = session.client_reference_id;
    const paymentIntentId = this.unwrapId(session.payment_intent);

    if (!metaUserId || !metaEventId || !metaTicketTypeId) {
      this.logger.warn(
        `checkout.session.completed ${eventId} payment-mode session ${session.id} missing required metadata; not issuing`,
      );
      return;
    }
    if (
      clientRef !== undefined &&
      clientRef !== null &&
      clientRef !== metaUserId
    ) {
      this.logger.error(
        `checkout.session.completed ${eventId} session ${session.id} client_reference_id mismatch (ref=${clientRef} meta=${metaUserId}); refunding`,
      );
      await this.tryRefund(paymentIntentId);
      return;
    }

    const ticketType = await this.prisma.ticketType.findUnique({
      where: { id: metaTicketTypeId },
      select: { id: true, eventId: true },
    });
    if (!ticketType) {
      this.logger.warn(
        `checkout.session.completed ${eventId} references deleted TicketType ${metaTicketTypeId}; not issuing`,
      );
      return;
    }
    if (ticketType.eventId !== metaEventId) {
      this.logger.error(
        `checkout.session.completed ${eventId} eventId mismatch (ticketType.eventId=${ticketType.eventId} meta=${metaEventId}); refunding`,
      );
      await this.tryRefund(paymentIntentId);
      return;
    }

    try {
      await this.prisma.ticket.create({
        data: {
          userId: metaUserId,
          eventId: metaEventId,
          ticketTypeId: metaTicketTypeId,
          source: TicketSource.PAID,
          stripeCheckoutSessionId: session.id,
          stripePaymentIntentId: paymentIntentId,
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        // Either the same checkout.session.completed got redelivered, or
        // a separate session somehow reused the same payment_intent. Both
        // collapse to "the ticket already exists" — ack 200 quietly.
        this.logger.log(
          `Ticket for session ${session.id} already issued; treating as duplicate`,
        );
        return;
      }
      throw err;
    }
  }

  private async tryRefund(paymentIntentId: string | null): Promise<void> {
    if (!paymentIntentId) return;
    try {
      await this.stripeClient.stripe.refunds.create({
        payment_intent: paymentIntentId,
      });
    } catch (err) {
      this.logger.error(
        `Auto-refund failed for payment_intent ${paymentIntentId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  // Resolves subscription metadata from an invoice object using a three-tier
  // priority: (1) inv.metadata, (2) inv.subscription_details.metadata, (3) a
  // single subscriptions.retrieve as last resort. Callers that share this
  // result never need a second retrieve for the same invoice.
  private async resolveInvoiceSubMetadata(
    inv: {
      id: string;
      subscription?: string | null;
      metadata?: Record<string, string | undefined> | null;
      subscription_details?: {
        metadata?: Record<string, string | undefined> | null;
      } | null;
    },
    webhookEventId: string,
  ): Promise<Record<string, string | undefined> | null> {
    const invMeta = inv.metadata ?? null;
    const detailsMeta = inv.subscription_details?.metadata ?? null;

    if (invMeta?.source || invMeta?.userId) {
      return invMeta;
    }
    if (detailsMeta?.source || detailsMeta?.userId) {
      return detailsMeta;
    }
    if (inv.subscription) {
      try {
        const sub = await this.stripeClient.stripe.subscriptions.retrieve(
          inv.subscription,
        );
        return sub.metadata ?? null;
      } catch (err) {
        this.logger.warn(
          `${webhookEventId} could not retrieve subscription ${inv.subscription}: ${err instanceof Error ? err.message : String(err)}; continuing without sub metadata`,
        );
      }
    }
    return null;
  }

  // customer.subscription.deleted: donation subscriptions flip to CANCELED;
  // non-donation subscriptions route to syncStripeData (membership path).
  private async handleSubscriptionDeleted(
    event: Stripe.Event,
  ): Promise<WebhookHandleResult> {
    const sub = event.data.object as {
      id: string;
      customer?: string | { id: string } | null;
      metadata?: Record<string, string | undefined> | null;
    };
    const meta = (sub.metadata as Record<string, string | undefined>) ?? {};

    if (meta.source === 'donation') {
      await this.handleDonationSubscriptionDeleted(sub, meta);
      return { recorded: false };
    }

    // Non-donation subscription: membership sync path.
    const customerId = this.unwrapId(sub.customer);
    if (!customerId) {
      this.logger.warn(
        `customer.subscription.deleted ${event.id} sub=${sub.id} has no resolvable customer id; skipping sync`,
      );
      return { recorded: false };
    }
    await this.memberships.syncStripeData(customerId);
    return { recorded: false };
  }

  private async handleDonationSubscriptionDeleted(
    sub: { id: string },
    meta: Record<string, string | undefined>,
  ): Promise<void> {
    let donation: {
      id: string;
      status: DonationStatus;
      canceledAt: Date | null;
      stripeSubscriptionId: string | null;
    } | null = null;

    if (meta.donationId) {
      const candidate = await this.prisma.donation.findUnique({
        where: { id: meta.donationId },
        select: {
          id: true,
          status: true,
          canceledAt: true,
          stripeSubscriptionId: true,
        },
      });
      if (
        candidate &&
        candidate.stripeSubscriptionId &&
        candidate.stripeSubscriptionId !== sub.id
      ) {
        // Stripe metadata is editable in Dashboard — fall back to the
        // server-stored linkage (stripeSubscriptionId) as the trusted source.
        this.logger.warn(
          `customer.subscription.deleted source=donation: meta.donationId=${meta.donationId} points to donation with stripeSubscriptionId=${candidate.stripeSubscriptionId}, but webhook sub=${sub.id}; falling back to sub-id lookup`,
        );
      } else {
        donation = candidate;
      }
    }
    if (!donation) {
      donation = await this.prisma.donation.findFirst({
        where: { stripeSubscriptionId: sub.id },
        select: {
          id: true,
          status: true,
          canceledAt: true,
          stripeSubscriptionId: true,
        },
      });
    }
    if (!donation) {
      this.logger.warn(
        `customer.subscription.deleted source=donation but no Donation row found (donationId=${meta.donationId ?? 'none'} sub=${sub.id}); ignoring`,
      );
      return;
    }

    // Idempotency: already-CANCELED rows are a no-op. canceledAt is NOT
    // re-stamped — the synchronous cancel in the billing controller already
    // set it; the webhook lands after and must leave it untouched.
    if (donation.status === DonationStatus.CANCELED) {
      return;
    }

    await this.prisma.donation.update({
      where: { id: donation.id },
      data: { status: DonationStatus.CANCELED, canceledAt: new Date() },
    });
  }

  // invoice.payment_failed: donation invoices write a FAILED PaymentEvent;
  // non-donation invoices route to syncStripeData (membership path).
  // Donation.status is intentionally left unchanged — Stripe retries; only
  // customer.subscription.deleted flips a donation to CANCELED.
  private async handleInvoicePaymentFailed(
    event: Stripe.Event,
  ): Promise<WebhookHandleResult> {
    const inv = event.data.object as {
      id: string;
      amount_due: number;
      currency: string;
      customer: string | { id: string } | null;
      payment_intent?: string | null;
      subscription?: string | null;
      metadata?: Record<string, string | undefined> | null;
      subscription_details?: {
        metadata?: Record<string, string | undefined> | null;
      } | null;
      last_finalization_error?: { message?: string } | null;
    };

    // Inspect inline metadata directly — no retrieve needed here. Membership
    // failed invoices carry no source; routing them through
    // resolveInvoiceSubMetadata would fire a subscriptions.retrieve on every
    // dunning retry even though the membership path only needs inv.customer.
    // The donation FAILED path only reaches handleDonationInvoiceFailed when
    // inline metadata (inv.metadata or subscription_details.metadata) already
    // identifies the invoice as a donation.
    const invMeta = inv.metadata ?? null;
    const detailsMeta = inv.subscription_details?.metadata ?? null;
    const sourceMeta =
      invMeta?.source === 'donation'
        ? invMeta
        : detailsMeta?.source === 'donation'
          ? detailsMeta
          : null;

    if (sourceMeta) {
      const invForFailed = inv as {
        id: string;
        amount_due: number;
        currency: string;
        customer: string;
        payment_intent?: string | null;
        subscription?: string | null;
        last_finalization_error?: { message?: string } | null;
      };
      await this.handleDonationInvoiceFailed(
        invForFailed,
        sourceMeta,
        event.id,
      );
      return { recorded: false };
    }

    // Non-donation invoice: membership sync path. unwrapId guards against an
    // expanded customer object if expand: ['customer'] is ever added.
    const customerId = this.unwrapId(inv.customer);
    if (!customerId) {
      this.logger.warn(
        `invoice.payment_failed ${event.id} inv=${inv.id} has no resolvable customer id; skipping sync`,
      );
      return { recorded: false };
    }
    await this.memberships.syncStripeData(customerId);
    return { recorded: false };
  }

  private async handleDonationInvoiceFailed(
    inv: {
      id: string;
      amount_due: number;
      currency: string;
      customer: string;
      payment_intent?: string | null;
      subscription?: string | null;
      last_finalization_error?: { message?: string } | null;
    },
    meta: Record<string, string | undefined>,
    webhookEventId: string,
  ): Promise<void> {
    let donation: {
      id: string;
      status: DonationStatus;
      userId: string;
      stripeSubscriptionId: string | null;
    } | null = null;

    if (meta.donationId) {
      const candidate = await this.prisma.donation.findFirst({
        where: { id: meta.donationId },
        select: {
          id: true,
          status: true,
          userId: true,
          stripeSubscriptionId: true,
        },
      });
      if (
        candidate &&
        candidate.stripeSubscriptionId &&
        inv.subscription &&
        candidate.stripeSubscriptionId !== inv.subscription
      ) {
        // Stripe metadata is editable in Dashboard — fall back to the
        // server-stored linkage (stripeSubscriptionId) as the trusted source.
        this.logger.warn(
          `invoice.payment_failed ${webhookEventId} inv=${inv.id}: meta.donationId=${meta.donationId} points to donation with stripeSubscriptionId=${candidate.stripeSubscriptionId}, but webhook inv.subscription=${inv.subscription}; falling back to sub-id lookup`,
        );
      } else {
        donation = candidate;
      }
    }
    if (!donation && inv.subscription) {
      donation = await this.prisma.donation.findFirst({
        where: { stripeSubscriptionId: inv.subscription },
        select: {
          id: true,
          status: true,
          userId: true,
          stripeSubscriptionId: true,
        },
      });
    }
    if (!donation) {
      this.logger.warn(
        `invoice.payment_failed ${webhookEventId} inv=${inv.id} source=donation but no Donation row found (donationId=${meta.donationId ?? 'none'} sub=${inv.subscription ?? 'none'}); ignoring`,
      );
      return;
    }

    // Guard: CANCELED donations do not receive new FAILED events — stray
    // replays of historical invoices must not pump entries into the ledger.
    if (donation.status === DonationStatus.CANCELED) {
      this.logger.warn(
        `invoice.payment_failed for canceled donation ${donation.id} (invoice ${inv.id}); skipping`,
      );
      return;
    }

    // Dedupe: if any DONATION PE already exists for this invoice, return.
    // The new partial unique index (stripe_invoice_id, kind) WHERE kind='DONATION'
    // catches concurrent re-deliveries at the DB level; this findFirst is the
    // fast-path that avoids an unnecessary insert attempt.
    const existing = await this.prisma.paymentEvent.findFirst({
      where: { stripeInvoiceId: inv.id, kind: PaymentEventKind.DONATION },
    });
    if (existing) {
      return;
    }

    // Donation.status is intentionally NOT updated — Stripe retries failed
    // invoices; only customer.subscription.deleted should flip to CANCELED.
    // Stripe always carries amount_due and currency on failed invoices, so
    // the inline cast above types them as non-null and no fallback is needed.
    try {
      await this.prisma.paymentEvent.create({
        data: {
          organizationId: HOUSE_ORG_ID,
          userId: donation.userId,
          kind: PaymentEventKind.DONATION,
          status: PaymentEventStatus.FAILED,
          amountCents: inv.amount_due,
          currency: inv.currency,
          donationId: donation.id,
          stripeInvoiceId: inv.id,
          stripePaymentIntentId: this.unwrapId(inv.payment_intent),
          stripeCustomerId: inv.customer,
          failureReason: inv.last_finalization_error?.message ?? null,
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        // Either the PI-based or the new invoice-based partial unique fired
        // on a concurrent redelivery race — both mean "already written".
        return;
      }
      throw err;
    }
  }

  // Pull the Stripe customer id out of an event's data.object regardless of
  // its concrete type. Subscriptions, Customers, Checkout Sessions, and
  // Invoices all carry `customer` as either a string id or an expanded
  // object. We normalize to string-or-null.
  private extractCustomerId(event: Stripe.Event): string | null {
    const obj = event.data.object as {
      customer?: string | { id: string } | null;
    };
    return this.unwrapId(obj.customer);
  }

  private unwrapId(
    field: string | { id: string } | null | undefined,
  ): string | null {
    if (!field) return null;
    if (typeof field === 'string') return field;
    return field.id ?? null;
  }
}
