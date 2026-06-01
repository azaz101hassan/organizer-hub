import { Injectable, Logger } from '@nestjs/common';
import {
  Prisma,
  PaymentEventKind,
  PaymentEventStatus,
} from '@organizer-hub/db/api';
import { PrismaService } from '../prisma/prisma.service';
import { HOUSE_ORG_ID } from '../common/house-org';

export interface PendingChargeInput {
  userId: string;
  kind: PaymentEventKind;
  amountCents: number;
  currency: string;
  stripeCustomerId?: string | null;
  stripePaymentIntentId?: string | null;
  stripeCheckoutSessionId: string;
  description?: string;
  ticketRequestId?: string | null;
  donationId?: string | null;
}

export interface TerminalChargeUpdate {
  status: PaymentEventStatus;
  succeededAt?: Date;
  canceledAt?: Date;
  failureReason?: string;
  ticketId?: string | null;
  membershipId?: string | null;
}

export interface RenewalRowInput {
  userId: string;
  amountCents: number;
  currency: string;
  stripeCustomerId: string;
  stripePaymentIntentId: string;
  stripeInvoiceId: string;
  membershipId?: string | null;
}

export interface RefundRowInput {
  userId: string;
  amountCents: number; // pass positive; service negates
  currency: string;
  stripeCustomerId?: string | null;
  stripePaymentIntentId: string;
  stripeRefundId: string;
  stripeChargeId?: string | null;
  description?: string;
  donationId?: string | null;
}

export interface DisputeRowInput {
  userId: string;
  amountCents: number; // pass positive; service negates
  currency: string;
  stripeCustomerId?: string | null;
  stripeChargeId: string;
  stripePaymentIntentId?: string | null;
  description?: string;
  donationId?: string | null;
}

// All writes happen inside the same transaction as the webhook handler's
// other side-effects so a ledger-write failure aborts the webhook ack
// and Stripe retries.
@Injectable()
export class PaymentEventsService {
  private readonly logger = new Logger(PaymentEventsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async upsertPendingCharge(
    tx: Prisma.TransactionClient | PrismaService,
    input: PendingChargeInput,
  ): Promise<void> {
    if (!input.stripePaymentIntentId) {
      this.logger.debug(
        `upsertPendingCharge: session ${input.stripeCheckoutSessionId} has no PI yet; storing checkout-session-only row`,
      );
    }
    try {
      await tx.paymentEvent.create({
        data: {
          organizationId: HOUSE_ORG_ID,
          userId: input.userId,
          kind: input.kind,
          status: PaymentEventStatus.PENDING,
          amountCents: input.amountCents,
          currency: input.currency,
          description: input.description,
          stripeCustomerId: input.stripeCustomerId ?? null,
          stripePaymentIntentId: input.stripePaymentIntentId ?? null,
          stripeCheckoutSessionId: input.stripeCheckoutSessionId,
          ticketRequestId: input.ticketRequestId ?? null,
          donationId: input.donationId ?? null,
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return; // replay; row already exists
      }
      throw err;
    }
  }

  async finalizeCharge(
    tx: Prisma.TransactionClient | PrismaService,
    stripePaymentIntentId: string,
    update: TerminalChargeUpdate,
  ): Promise<void> {
    const row = await tx.paymentEvent.findFirst({
      where: {
        stripePaymentIntentId,
        kind: {
          in: [
            PaymentEventKind.TICKET,
            PaymentEventKind.MEMBERSHIP,
            PaymentEventKind.DONATION,
          ],
        },
      },
      select: { id: true },
    });
    if (!row) {
      this.logger.warn(
        `finalizeCharge: no charge row for PI ${stripePaymentIntentId}; out-of-order webhook?`,
      );
      return;
    }
    await tx.paymentEvent.update({
      where: { id: row.id },
      data: {
        status: update.status,
        succeededAt: update.succeededAt,
        canceledAt: update.canceledAt,
        failureReason: update.failureReason,
        ticketId: update.ticketId ?? undefined,
        membershipId: update.membershipId ?? undefined,
      },
    });
  }

  async insertRenewal(
    tx: Prisma.TransactionClient | PrismaService,
    input: RenewalRowInput,
  ): Promise<void> {
    try {
      await tx.paymentEvent.create({
        data: {
          organizationId: HOUSE_ORG_ID,
          userId: input.userId,
          kind: PaymentEventKind.MEMBERSHIP,
          status: PaymentEventStatus.SUCCEEDED,
          amountCents: input.amountCents,
          currency: input.currency,
          stripeCustomerId: input.stripeCustomerId,
          stripePaymentIntentId: input.stripePaymentIntentId,
          stripeInvoiceId: input.stripeInvoiceId,
          membershipId: input.membershipId ?? null,
          succeededAt: new Date(),
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return;
      }
      throw err;
    }
  }

  async insertRefund(
    tx: Prisma.TransactionClient | PrismaService,
    input: RefundRowInput,
  ): Promise<void> {
    try {
      await tx.paymentEvent.create({
        data: {
          organizationId: HOUSE_ORG_ID,
          userId: input.userId,
          kind: PaymentEventKind.REFUND,
          status: PaymentEventStatus.SUCCEEDED,
          amountCents: -Math.abs(input.amountCents),
          currency: input.currency,
          description: input.description,
          stripeCustomerId: input.stripeCustomerId ?? null,
          stripePaymentIntentId: input.stripePaymentIntentId,
          stripeRefundId: input.stripeRefundId,
          stripeChargeId: input.stripeChargeId ?? null,
          refundsPaymentIntentId: input.stripePaymentIntentId,
          donationId: input.donationId ?? null,
          succeededAt: new Date(),
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return;
      }
      throw err;
    }
  }

  async insertDispute(
    tx: Prisma.TransactionClient | PrismaService,
    input: DisputeRowInput,
  ): Promise<void> {
    try {
      await tx.paymentEvent.create({
        data: {
          organizationId: HOUSE_ORG_ID,
          userId: input.userId,
          kind: PaymentEventKind.DISPUTE,
          status: PaymentEventStatus.SUCCEEDED,
          amountCents: -Math.abs(input.amountCents),
          currency: input.currency,
          description: input.description,
          stripeCustomerId: input.stripeCustomerId ?? null,
          stripeChargeId: input.stripeChargeId,
          stripePaymentIntentId: input.stripePaymentIntentId ?? null,
          donationId: input.donationId ?? null,
          succeededAt: new Date(),
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return;
      }
      throw err;
    }
  }
}
