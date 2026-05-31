import type {
  PaymentEvent,
  PaymentEventKind,
  PaymentEventStatus,
} from '@organizer-hub/db/api';

export interface PaymentEventView {
  id: string;
  organizationId: string;
  userId: string;
  kind: PaymentEventKind;
  status: PaymentEventStatus;
  amountCents: number;
  currency: string;
  description: string | null;
  stripePaymentIntentId: string | null;
  stripeCheckoutSessionId: string | null;
  stripeInvoiceId: string | null;
  stripeRefundId: string | null;
  stripeChargeId: string | null;
  ticketId: string | null;
  ticketRequestId: string | null;
  membershipId: string | null;
  refundsPaymentIntentId: string | null;
  failureReason: string | null;
  succeededAt: string | null;
  canceledAt: string | null;
  createdAt: string;
}

export function toPaymentEventView(row: PaymentEvent): PaymentEventView {
  return {
    id: row.id,
    organizationId: row.organizationId,
    userId: row.userId,
    kind: row.kind,
    status: row.status,
    amountCents: row.amountCents,
    currency: row.currency,
    description: row.description,
    stripePaymentIntentId: row.stripePaymentIntentId,
    stripeCheckoutSessionId: row.stripeCheckoutSessionId,
    stripeInvoiceId: row.stripeInvoiceId,
    stripeRefundId: row.stripeRefundId,
    stripeChargeId: row.stripeChargeId,
    ticketId: row.ticketId,
    ticketRequestId: row.ticketRequestId,
    membershipId: row.membershipId,
    refundsPaymentIntentId: row.refundsPaymentIntentId,
    failureReason: row.failureReason,
    succeededAt: row.succeededAt?.toISOString() ?? null,
    canceledAt: row.canceledAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
