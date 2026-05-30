import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ApiError, apiFetch, UnauthorizedError } from "@organizer-hub/web-shared";
import type {
  PaymentLinkView,
  RequesterTicketRequestView,
} from "@organizer-hub/web-shared";
import { formatDateTime, formatTimeUntil } from "@/lib/format";
import { CancelRequestButton } from "../CancelRequestButton";
import { RequestStatusBadge } from "../RequestStatusBadge";

export const dynamic = "force-dynamic";

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

  // Only this one state has a live Checkout link — fetch it server-side (the
  // web holds no Stripe secret). Best-effort: if the lookup fails the page
  // still renders, just without the button.
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
        className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
      >
        ← All requests
      </Link>

      <div className="mt-3 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {req.event.title}
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            {req.ticketTypeName}
            {" · "}
            {req.intent === "PAID" ? "Paid" : "Free claim"}
            {" · "}
            event {formatDateTime(req.event.startsAt)}
          </p>
        </div>
        <RequestStatusBadge status={req.status} />
      </div>

      <div className="mt-6 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
        <StateBody
          req={req}
          awaitingPayment={awaitingPayment}
          paymentLink={paymentLink}
        />
      </div>
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
      <div className="flex flex-col gap-4">
        <p className="text-sm text-zinc-700 dark:text-zinc-300">
          Your request is in the organizer&apos;s queue. We&apos;ll email you
          when they respond.
        </p>
        <CancelRequestButton requestId={req.id} />
      </div>
    );
  }

  if (req.status === "APPROVED" && req.hasTicket) {
    return (
      <p className="text-sm text-emerald-700 dark:text-emerald-300">
        Approved — your ticket has been issued. See it in your tickets.
      </p>
    );
  }

  if (awaitingPayment) {
    // Approved, awaiting payment. A live link → primary CTA + expiry; a missing
    // / expired link → the window has closed.
    if (paymentLink?.url) {
      return (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-zinc-700 dark:text-zinc-300">
            You&apos;re approved! Complete payment to lock in your ticket.
          </p>
          <a
            href={paymentLink.url}
            className="inline-flex w-fit items-center rounded-full bg-blue-600 text-white px-5 py-2 text-sm font-medium hover:bg-blue-500 transition"
          >
            Complete payment
          </a>
          {paymentLink.expiresAt && (
            <p className="text-xs text-zinc-500">
              Payment link expires in {formatTimeUntil(paymentLink.expiresAt)}.
            </p>
          )}
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-zinc-700 dark:text-zinc-300">
          Your payment window has closed.
        </p>
        <Link
          href={`/events/${req.eventId}`}
          className="inline-flex w-fit items-center rounded-full bg-blue-600 text-white px-5 py-2 text-sm font-medium hover:bg-blue-500 transition"
        >
          Request a new spot
        </Link>
      </div>
    );
  }

  if (req.status === "REJECTED") {
    return (
      <p className="text-sm text-zinc-700 dark:text-zinc-300">
        This request was declined by the organizer.
      </p>
    );
  }

  if (req.status === "CANCELLED_BY_USER") {
    return (
      <p className="text-sm text-zinc-700 dark:text-zinc-300">
        You cancelled this request.
      </p>
    );
  }

  // EXPIRED
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-zinc-700 dark:text-zinc-300">
        Your payment window closed before this request was paid.
      </p>
      <Link
        href={`/events/${req.eventId}`}
        className="inline-flex w-fit items-center rounded-full bg-blue-600 text-white px-5 py-2 text-sm font-medium hover:bg-blue-500 transition"
      >
        Request a new spot
      </Link>
    </div>
  );
}
