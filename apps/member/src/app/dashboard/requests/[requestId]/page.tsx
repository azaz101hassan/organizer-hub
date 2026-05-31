import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  ApiError,
  apiFetch,
  UnauthorizedError,
  formatDateTime,
  formatTimeUntil,
} from "@organizer-hub/web-shared";
import type {
  PaymentLinkView,
  RequesterTicketRequestView,
  TicketRequestStatus,
} from "@organizer-hub/web-shared";
import { Badge, Card, Display, Eyebrow } from "@organizer-hub/web-shared/ui";
import type { BadgeTone } from "@organizer-hub/web-shared/ui";
import { CancelRequestButton } from "../CancelRequestButton";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<TicketRequestStatus, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  CANCELLED_BY_USER: "Cancelled",
  EXPIRED: "Expired",
};

const STATUS_TONE: Record<TicketRequestStatus, BadgeTone> = {
  PENDING: "featured",
  APPROVED: "published",
  REJECTED: "cancelled",
  CANCELLED_BY_USER: "draft",
  EXPIRED: "draft",
};

export default async function RequestDetailPage({
  params,
}: {
  params: Promise<{ requestId: string }>;
}) {
  const { requestId } = await params;

  let req: RequesterTicketRequestView;
  try {
    req = await apiFetch<RequesterTicketRequestView>(`/requests/${requestId}`);
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login");
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }

  const awaitingPayment =
    req.intent === "PAID" && req.status === "APPROVED" && !req.hasTicket;

  let paymentLink: PaymentLinkView | null = null;
  if (awaitingPayment) {
    try {
      paymentLink = await apiFetch<PaymentLinkView>(
        `/requests/${requestId}/payment-link`,
      );
    } catch {
      paymentLink = null;
    }
  }

  return (
    <div>
      <Link
        href="/dashboard/requests"
        className="faint"
        style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 4, marginBottom: 20 }}
      >
        ← All requests
      </Link>

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 8 }}>
        <div>
          <Eyebrow muted style={{ marginBottom: 8 }}>Request</Eyebrow>
          <Display as="h1" size="md">{req.event.title}</Display>
        </div>
        <Badge tone={STATUS_TONE[req.status]}>
          {STATUS_LABEL[req.status]}
        </Badge>
      </div>

      <p className="muted" style={{ fontSize: 13, marginBottom: 24 }}>
        {req.ticketTypeName}
        {" · "}
        {req.intent === "PAID" ? "Paid" : "Free claim"}
        {" · "}
        event {formatDateTime(req.event.startsAt)}
      </p>

      <Card padded>
        <StateBody
          req={req}
          awaitingPayment={awaitingPayment}
          paymentLink={paymentLink}
        />
      </Card>
    </div>
  );
}

function StateBody({
  req,
  awaitingPayment,
  paymentLink,
}: {
  req: RequesterTicketRequestView;
  awaitingPayment: boolean;
  paymentLink: PaymentLinkView | null;
}) {
  if (req.status === "PENDING") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <p style={{ fontSize: 14, margin: 0 }}>
          Your request is in the organizer&apos;s queue. We&apos;ll email you
          when they respond.
        </p>
        <CancelRequestButton requestId={req.id} />
      </div>
    );
  }

  if (req.status === "APPROVED" && req.hasTicket) {
    return (
      <p style={{ fontSize: 14, color: "var(--good)", margin: 0 }}>
        Approved — your ticket has been issued. See it in your tickets.
      </p>
    );
  }

  if (awaitingPayment) {
    if (paymentLink?.url) {
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p style={{ fontSize: 14, margin: 0 }}>
            You&apos;re approved! Complete payment to lock in your ticket.
          </p>
          <a href={paymentLink.url} className="btn btn--primary btn--sm" style={{ width: "fit-content" }}>
            Complete payment
          </a>
          {paymentLink.expiresAt && (
            <p className="faint" style={{ fontSize: 12, margin: 0 }}>
              Payment link expires in {formatTimeUntil(paymentLink.expiresAt)}.
            </p>
          )}
        </div>
      );
    }
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <p style={{ fontSize: 14, margin: 0 }}>
          Your payment window has closed.
        </p>
        <Link
          href={`/events/${req.eventId}`}
          className="btn btn--primary btn--sm"
          style={{ width: "fit-content" }}
        >
          Request a new spot
        </Link>
      </div>
    );
  }

  if (req.status === "REJECTED") {
    return (
      <p className="muted" style={{ fontSize: 14, margin: 0 }}>
        This request was declined by the organizer.
      </p>
    );
  }

  if (req.status === "CANCELLED_BY_USER") {
    return (
      <p className="muted" style={{ fontSize: 14, margin: 0 }}>
        You cancelled this request.
      </p>
    );
  }

  // EXPIRED
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <p className="muted" style={{ fontSize: 14, margin: 0 }}>
        Your payment window closed before this request was paid.
      </p>
      <Link
        href={`/events/${req.eventId}`}
        className="btn btn--primary btn--sm"
        style={{ width: "fit-content" }}
      >
        Request a new spot
      </Link>
    </div>
  );
}
