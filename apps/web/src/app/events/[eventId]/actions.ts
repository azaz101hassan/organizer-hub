"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ApiError, apiFetch, UnauthorizedError } from "@/lib/api/client";
import type { TicketView } from "@/lib/api/types";

// Both server actions defend-in-depth: the api re-runs the coverage rule on
// claim and refuses tampered ticketTypeIds on purchase, so the UI's verdict is
// just a hint about which CTA to show. The button itself is never trusted.

export async function buyTicket(formData: FormData): Promise<void> {
  const ticketTypeId = String(formData.get("ticketTypeId") ?? "");
  const eventId = String(formData.get("eventId") ?? "");

  let checkoutUrl: string;
  try {
    const res = await apiFetch<{ url: string }>("/billing/checkout/ticket", {
      method: "POST",
      body: { ticketTypeId },
    });
    checkoutUrl = res.url;
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

  redirect(checkoutUrl);
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
    await apiFetch<TicketView>("/tickets/claim", {
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
