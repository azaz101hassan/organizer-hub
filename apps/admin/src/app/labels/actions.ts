"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  ApiError,
  apiFetch,
  UnauthorizedError,
  getHouseOrgId,
} from "@organizer-hub/web-shared";
import type { EventLabelView } from "@organizer-hub/web-shared";

export interface LabelFormState {
  error?: string;
  fieldErrors?: { name?: string; slug?: string };
  values?: { name?: string; slug?: string; sortOrder?: number };
  ok?: boolean;
}

function validate(name: string, slug: string): LabelFormState["fieldErrors"] {
  const errors: NonNullable<LabelFormState["fieldErrors"]> = {};
  if (name.length < 1) errors.name = "Name is required.";
  if (name.length > 60) errors.name = "Name must be 60 characters or fewer.";
  if (slug.length < 1) errors.slug = "Slug is required.";
  if (slug.length > 60) errors.slug = "Slug must be 60 characters or fewer.";
  if (slug.length >= 1 && !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug)) {
    errors.slug =
      "Slug must be lowercase letters, digits, or hyphens, no leading or trailing hyphen.";
  }
  return Object.keys(errors).length > 0 ? errors : undefined;
}

async function refreshLabelsPath(): Promise<void> {
  revalidatePath("/labels");
}

export async function createLabel(
  _prev: LabelFormState,
  formData: FormData,
): Promise<LabelFormState> {
  const orgId = getHouseOrgId();
  const name = String(formData.get("name") ?? "").trim();
  const slug = String(formData.get("slug") ?? "").trim();
  const sortOrderRaw = String(formData.get("sortOrder") ?? "");
  const sortOrder = sortOrderRaw ? Number(sortOrderRaw) : undefined;

  const fieldErrors = validate(name, slug);
  if (fieldErrors) {
    return { fieldErrors, values: { name, slug, sortOrder } };
  }

  try {
    await apiFetch<EventLabelView>(`/event-labels`, {
      method: "POST",
      body: {
        organizationId: orgId,
        name,
        slug,
        ...(sortOrder !== undefined ? { sortOrder } : {}),
      },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login");
    if (err instanceof ApiError) {
      const message =
        err.status === 409
          ? "A label with that slug already exists."
          : `Could not create label (${err.status}).`;
      return { error: message, values: { name, slug, sortOrder } };
    }
    throw err;
  }

  await refreshLabelsPath();
  return { ok: true };
}

export async function renameLabel(
  id: string,
  formData: FormData,
): Promise<LabelFormState> {
  const name = String(formData.get("name") ?? "").trim();
  const slug = String(formData.get("slug") ?? "").trim();
  const sortOrderRaw = String(formData.get("sortOrder") ?? "");
  const sortOrder = sortOrderRaw ? Number(sortOrderRaw) : undefined;

  const fieldErrors = validate(name, slug);
  if (fieldErrors) {
    return { fieldErrors, values: { name, slug, sortOrder } };
  }

  try {
    await apiFetch<EventLabelView>(`/event-labels/${id}`, {
      method: "PATCH",
      body: {
        name,
        slug,
        ...(sortOrder !== undefined ? { sortOrder } : {}),
      },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login");
    if (err instanceof ApiError) {
      const message =
        err.status === 409
          ? "A label with that slug already exists."
          : `Could not save changes (${err.status}).`;
      return { error: message, values: { name, slug, sortOrder } };
    }
    throw err;
  }

  await refreshLabelsPath();
  return { ok: true };
}

export interface DeleteLabelResult {
  ok?: boolean;
  error?: string;
}

export async function deleteLabel(id: string): Promise<DeleteLabelResult> {
  getHouseOrgId(); // throw early if the env binding is missing
  try {
    await apiFetch<void>(`/event-labels/${id}`, {
      method: "DELETE",
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login");
    if (err instanceof ApiError) {
      if (err.status === 409) {
        const eventCount =
          (err.body as { eventCount?: number } | undefined)?.eventCount ?? 0;
        return {
          error: `Cannot delete — ${eventCount} event${eventCount === 1 ? "" : "s"} still reference this label.`,
        };
      }
      return { error: `Could not delete label (${err.status}).` };
    }
    throw err;
  }
  await refreshLabelsPath();
  return { ok: true };
}
