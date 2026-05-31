"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ApiError, apiFetch, UnauthorizedError } from "@organizer-hub/web-shared";
import type { EventView } from "@organizer-hub/web-shared";

export interface UpdateEventFormState {
  error?: string;
  fieldErrors?: { title?: string; startsAt?: string; endsAt?: string };
  values?: {
    title?: string;
    description?: string;
    startsAt?: string;
    endsAt?: string;
    venue?: string;
    membersExcluded?: boolean;
  };
  ok?: boolean;
}

function parseLocalDateTime(input: string): Date | null {
  if (!input) return null;
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function updateEvent(
  orgId: string,
  eventId: string,
  _prev: UpdateEventFormState,
  formData: FormData,
): Promise<UpdateEventFormState> {
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const startsAtRaw = String(formData.get("startsAt") ?? "");
  const endsAtRaw = String(formData.get("endsAt") ?? "");
  const venue = String(formData.get("venue") ?? "").trim();
  const membersExcluded = formData.get("membersExcluded") === "on";

  const fieldErrors: NonNullable<UpdateEventFormState["fieldErrors"]> = {};
  if (title.length < 2) fieldErrors.title = "Title must be at least 2 characters.";
  if (title.length > 120) fieldErrors.title = "Title must be 120 characters or fewer.";

  const startsAt = parseLocalDateTime(startsAtRaw);
  if (!startsAt) fieldErrors.startsAt = "Start date is required.";
  const endsAt = endsAtRaw ? parseLocalDateTime(endsAtRaw) : null;
  if (endsAtRaw && !endsAt) {
    fieldErrors.endsAt = "End date is invalid.";
  } else if (startsAt && endsAt && endsAt <= startsAt) {
    fieldErrors.endsAt = "End must be after the start.";
  }

  const values = {
    title,
    description,
    startsAt: startsAtRaw,
    endsAt: endsAtRaw,
    venue,
    membersExcluded,
  };

  if (Object.keys(fieldErrors).length > 0 || !startsAt) {
    return { fieldErrors, values };
  }

  try {
    await apiFetch<EventView>(
      `/organizations/${orgId}/events/${eventId}`,
      {
        method: "PATCH",
        body: {
          title,
          description: description || null,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt ? endsAt.toISOString() : null,
          venue: venue || null,
          membersExcluded,
        },
      },
    );
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login");
    if (err instanceof ApiError) {
      return {
        error: `Could not save changes (${err.status}).`,
        values,
      };
    }
    throw err;
  }

  revalidatePath(`/dashboard/organizations/${orgId}/events/${eventId}`);
  revalidatePath(`/dashboard/organizations/${orgId}`);
  return { ok: true, values };
}

async function transitionStatus(
  orgId: string,
  eventId: string,
  status: "PUBLISHED" | "CANCELLED",
): Promise<void> {
  try {
    await apiFetch<EventView>(
      `/organizations/${orgId}/events/${eventId}`,
      { method: "PATCH", body: { status } },
    );
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login");
    throw err;
  }
  revalidatePath(`/dashboard/organizations/${orgId}/events/${eventId}`);
  revalidatePath(`/dashboard/organizations/${orgId}`);
}

export async function publishEvent(
  orgId: string,
  eventId: string,
): Promise<void> {
  await transitionStatus(orgId, eventId, "PUBLISHED");
}

export async function cancelEvent(
  orgId: string,
  eventId: string,
): Promise<void> {
  await transitionStatus(orgId, eventId, "CANCELLED");
}
