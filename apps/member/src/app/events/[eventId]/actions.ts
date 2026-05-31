"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ApiError, apiFetch, UnauthorizedError } from "@organizer-hub/web-shared";
import type { ClaimResult, TicketCheckoutResult } from "@organizer-hub/web-shared";

// Every server action defends-in-depth: the api re-runs the coverage rule on
// claim, re-checks atCap on intake, and refuses tampered ticketTypeIds on
// purchase, so the UI's verdict is just a hint about which CTA to show. The
// button itself is never trusted.

export async function buyTicket(formData: FormData): Promise<void> {
  const ticketTypeId = String(formData.get("ticketTypeId") ?? "");
  const eventId = String(formData.get("eventId") ?? "");

  let result: TicketCheckoutResult;
  try {
    result = await apiFetch<TicketCheckoutResult>("/billing/checkout/ticket", {
      method: "POST",
      body: { ticketTypeId },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect(`/auth/login?next=${encodeURIComponent(`/events/${eventId}`)}`);
    }
    if (err instanceof ApiError) {
      redirect(
        `/events/${eventId}?error=${encodeURIComponent(
          err.status === 409
            ? "You already have a ticket for this tier."
            : `Checkout failed (${err.status}).`,
        )}`,
      );
    }
    throw err;
  }

  if (result.kind === "checkout") redirect(result.url);
  // The tier filled between page load and click → the buyer is now queued.
  redirect("/dashboard/requests");
}

export interface ClaimState {
  error?: string;
  ok?: boolean;
}

export async function claimFreeTicket(
  _prev: ClaimState,
  formData: FormData,
): Promise<ClaimState> {
  const ticketTypeId = String(formData.get("ticketTypeId") ?? "");
  const eventId = String(formData.get("eventId") ?? "");

  try {
    await apiFetch<ClaimResult>("/tickets/claim", {
      method: "POST",
      body: { ticketTypeId },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect(`/auth/login?next=${encodeURIComponent(`/events/${eventId}`)}`);
    }
    if (err instanceof ApiError) {
      if (err.status === 409) {
        return {
          error: "Coverage changed — refresh to see updated options.",
        };
      }
      return { error: `Couldn't claim (${err.status}).` };
    }
    throw err;
  }

  revalidatePath(`/events/${eventId}`);
  return { ok: true };
}

export interface RequestSpotState {
  error?: string;
  ok?: boolean;
  // The created (or already-existing) request id, so the confirmation can
  // deep-link the requester to /dashboard/requests/<id>.
  requestId?: string;
}

// At-cap intake (R3, R20). Posts to the same endpoint the under-cap CTA would
// have used — claim for a covered member (free MEMBERSHIP_CLAIM request), the
// billing endpoint otherwise (PAID request) — driven by the server-supplied
// `requestIntent`. Both endpoints return a discriminated result; at cap it is
// `kind:'request'`. Idempotent server-side: a repeat returns the existing
// request rather than erroring, so resubmitting just re-confirms.
export async function requestSpot(
  _prev: RequestSpotState,
  formData: FormData,
): Promise<RequestSpotState> {
  const ticketTypeId = String(formData.get("ticketTypeId") ?? "");
  const eventId = String(formData.get("eventId") ?? "");
  const requestIntent = String(formData.get("requestIntent") ?? "PAID");

  let checkoutUrl: string | null = null;
  try {
    if (requestIntent === "MEMBERSHIP_CLAIM") {
      const res = await apiFetch<ClaimResult>("/tickets/claim", {
        method: "POST",
        body: { ticketTypeId },
      });
      // The cap may have dropped between render and submit → an actual ticket
      // was issued instead of a request. Revalidate so the row flips to OWNED.
      if (res.kind === "ticket") {
        revalidatePath(`/events/${eventId}`);
        return { ok: true };
      }
      return { ok: true, requestId: res.requestId };
    }

    const res = await apiFetch<TicketCheckoutResult>(
      "/billing/checkout/ticket",
      { method: "POST", body: { ticketTypeId } },
    );
    if (res.kind === "checkout") {
      // Cap dropped → a live Stripe session; send them to pay now.
      checkoutUrl = res.url;
    } else {
      return { ok: true, requestId: res.requestId };
    }
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect(`/auth/login?next=${encodeURIComponent(`/events/${eventId}`)}`);
    }
    if (err instanceof ApiError) {
      if (err.status === 409) {
        return { error: "You already have an open request for this tier." };
      }
      return { error: "Something went wrong — please try again." };
    }
    throw err;
  }

  if (checkoutUrl) redirect(checkoutUrl);
  return { ok: true };
}
