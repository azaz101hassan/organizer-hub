"use server";

import { redirect } from "next/navigation";
import { ApiError, apiFetch, UnauthorizedError } from "@organizer-hub/web-shared";
import type { EventView } from "@organizer-hub/web-shared";

export interface CreateEventFormState {
  error?: string;
  fieldErrors?: {
    title?: string;
    startsAt?: string;
    endsAt?: string;
  };
  values?: {
    title?: string;
    description?: string;
    startsAt?: string;
    endsAt?: string;
    venue?: string;
    labelId?: string;
  };
}

function parseLocalDateTime(input: string): Date | null {
  if (!input) return null;
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function createEvent(
  orgId: string,
  _prev: CreateEventFormState,
  formData: FormData,
): Promise<CreateEventFormState> {
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const startsAtRaw = String(formData.get("startsAt") ?? "");
  const endsAtRaw = String(formData.get("endsAt") ?? "");
  const venue = String(formData.get("venue") ?? "").trim();
  const labelId = String(formData.get("labelId") ?? "").trim();

  const fieldErrors: NonNullable<CreateEventFormState["fieldErrors"]> = {};
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
    labelId,
  };

  if (Object.keys(fieldErrors).length > 0 || !startsAt) {
    return { fieldErrors, values };
  }

  let event: EventView;
  try {
    event = await apiFetch<EventView>(
      `/organizations/${orgId}/events`,
      {
        method: "POST",
        body: {
          title,
          ...(description ? { description } : {}),
          startsAt: startsAt.toISOString(),
          ...(endsAt ? { endsAt: endsAt.toISOString() } : {}),
          ...(venue ? { venue } : {}),
          ...(labelId ? { labelId } : {}),
        },
      },
    );
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login");
    if (err instanceof ApiError) {
      return {
        error: `Could not create event (${err.status}).`,
        values,
      };
    }
    throw err;
  }

  redirect(`/events/${event.id}`);
}
