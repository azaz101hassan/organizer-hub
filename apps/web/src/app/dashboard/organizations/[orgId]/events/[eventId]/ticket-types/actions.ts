"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ApiError, apiFetch, UnauthorizedError } from "@/lib/api/client";
import type { TicketTypeView } from "@/lib/api/types";

export interface TicketTypeFormState {
  error?: string;
  fieldErrors?: { name?: string; price?: string; minTierLevel?: string };
  values?: { name?: string; price?: string; minTierLevel?: string };
  ok?: boolean;
}

const MIN_TIER_VALUES = new Set(["0", "1", "2", "3"]);
const PRICE_PATTERN = /^\d{1,5}(\.\d{1,2})?$/;
const MAX_PRICE_CENTS = 100_000_00;

function parsePriceToCents(input: string): number | null {
  if (!PRICE_PATTERN.test(input)) return null;
  const [whole, fraction = ""] = input.split(".");
  const cents = Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
  if (!Number.isFinite(cents) || cents < 0 || cents > MAX_PRICE_CENTS) return null;
  return cents;
}

export async function createTicketType(
  orgId: string,
  eventId: string,
  _prev: TicketTypeFormState,
  formData: FormData,
): Promise<TicketTypeFormState> {
  const name = String(formData.get("name") ?? "").trim();
  const price = String(formData.get("price") ?? "").trim();
  const minTierLevel = String(formData.get("minTierLevel") ?? "0");

  const fieldErrors: NonNullable<TicketTypeFormState["fieldErrors"]> = {};
  if (name.length < 1 || name.length > 80) {
    fieldErrors.name = "Name must be 1–80 characters.";
  }
  const priceCents = parsePriceToCents(price);
  if (priceCents === null) {
    fieldErrors.price = "Enter a price between $0.00 and $100,000.00.";
  }
  if (!MIN_TIER_VALUES.has(minTierLevel)) {
    fieldErrors.minTierLevel = "Pick a valid tier.";
  }
  const minTierLevelInt = Number(minTierLevel);
  if (priceCents === 0 && minTierLevelInt > 0) {
    fieldErrors.price = "Free tickets cannot also gate by membership tier.";
  }

  const values = { name, price, minTierLevel };

  if (Object.keys(fieldErrors).length > 0 || priceCents === null) {
    return { fieldErrors, values };
  }

  try {
    await apiFetch<TicketTypeView>(
      `/organizations/${orgId}/events/${eventId}/ticket-types`,
      {
        method: "POST",
        body: { name, priceCents, minTierLevel: minTierLevelInt },
      },
    );
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login");
    if (err instanceof ApiError) {
      return { error: `Couldn't add the ticket type (${err.status}).`, values };
    }
    throw err;
  }

  revalidatePath(
    `/dashboard/organizations/${orgId}/events/${eventId}/ticket-types`,
  );
  // Empty values → form resets after a successful add.
  return { ok: true, values: { name: "", price: "", minTierLevel: "0" } };
}

export async function updateTicketType(
  orgId: string,
  eventId: string,
  ticketTypeId: string,
  _prev: TicketTypeFormState,
  formData: FormData,
): Promise<TicketTypeFormState> {
  const name = String(formData.get("name") ?? "").trim();
  const price = String(formData.get("price") ?? "").trim();
  const minTierLevel = String(formData.get("minTierLevel") ?? "0");

  const fieldErrors: NonNullable<TicketTypeFormState["fieldErrors"]> = {};
  if (name.length < 1 || name.length > 80) {
    fieldErrors.name = "Name must be 1–80 characters.";
  }
  const priceCents = parsePriceToCents(price);
  if (priceCents === null) {
    fieldErrors.price = "Enter a price between $0.00 and $100,000.00.";
  }
  if (!MIN_TIER_VALUES.has(minTierLevel)) {
    fieldErrors.minTierLevel = "Pick a valid tier.";
  }
  const minTierLevelInt = Number(minTierLevel);
  if (priceCents === 0 && minTierLevelInt > 0) {
    fieldErrors.price = "Free tickets cannot also gate by membership tier.";
  }

  const values = { name, price, minTierLevel };

  if (Object.keys(fieldErrors).length > 0 || priceCents === null) {
    return { fieldErrors, values };
  }

  try {
    await apiFetch<TicketTypeView>(
      `/organizations/${orgId}/events/${eventId}/ticket-types/${ticketTypeId}`,
      {
        method: "PATCH",
        body: { name, priceCents, minTierLevel: minTierLevelInt },
      },
    );
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login");
    if (err instanceof ApiError) {
      return { error: `Couldn't save changes (${err.status}).`, values };
    }
    throw err;
  }

  revalidatePath(
    `/dashboard/organizations/${orgId}/events/${eventId}/ticket-types`,
  );
  return { ok: true, values };
}

export async function deleteTicketType(
  orgId: string,
  eventId: string,
  ticketTypeId: string,
): Promise<{ error?: string }> {
  try {
    await apiFetch(
      `/organizations/${orgId}/events/${eventId}/ticket-types/${ticketTypeId}`,
      { method: "DELETE" },
    );
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login");
    if (err instanceof ApiError) {
      if (err.status === 409) {
        return {
          error: "This tier has issued tickets and can't be deleted.",
        };
      }
      return { error: `Couldn't delete (${err.status}).` };
    }
    throw err;
  }
  revalidatePath(
    `/dashboard/organizations/${orgId}/events/${eventId}/ticket-types`,
  );
  return {};
}
