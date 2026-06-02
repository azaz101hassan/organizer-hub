"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  ApiError,
  apiFetch,
  UnauthorizedError,
  getHouseOrgId,
} from "@organizer-hub/web-shared";

export interface CoalitionFormState {
  error?: string;
  fieldErrors?: {
    name?: string;
    slug?: string;
    description?: string;
    coverImageUrl?: string;
    displayOrder?: string;
  };
  values?: {
    name?: string;
    slug?: string;
    description?: string;
    coverImageUrl?: string;
    displayOrder?: number;
  };
  ok?: boolean;
}

function validate(
  name: string,
  slug: string,
): CoalitionFormState["fieldErrors"] {
  const errors: NonNullable<CoalitionFormState["fieldErrors"]> = {};
  if (name.length < 1) errors.name = "Name is required.";
  if (name.length > 120) errors.name = "Name must be 120 characters or fewer.";
  if (slug.length < 1) errors.slug = "Slug is required.";
  if (slug.length > 80) errors.slug = "Slug must be 80 characters or fewer.";
  if (slug.length >= 1 && !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug)) {
    errors.slug =
      "Slug must be lowercase letters, digits, or hyphens with no leading or trailing hyphen.";
  }
  return Object.keys(errors).length > 0 ? errors : undefined;
}

export async function createCoalition(
  _prev: CoalitionFormState,
  formData: FormData,
): Promise<CoalitionFormState> {
  const orgId = getHouseOrgId();
  const name = String(formData.get("name") ?? "").trim();
  const slug = String(formData.get("slug") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || undefined;
  const coverImageUrl = String(formData.get("coverImageUrl") ?? "").trim() || undefined;
  const displayOrderRaw = String(formData.get("displayOrder") ?? "");
  const displayOrder = displayOrderRaw ? Number(displayOrderRaw) : undefined;

  const fieldErrors = validate(name, slug);
  if (fieldErrors) {
    return { fieldErrors, values: { name, slug, description, coverImageUrl, displayOrder } };
  }

  try {
    await apiFetch(`/orgs/${encodeURIComponent(orgId)}/coalitions`, {
      method: "POST",
      body: {
        name,
        slug,
        ...(description !== undefined ? { description } : {}),
        ...(coverImageUrl !== undefined ? { coverImageUrl } : {}),
        ...(displayOrder !== undefined ? { displayOrder } : {}),
      },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login");
    if (err instanceof ApiError) {
      const message =
        err.status === 409
          ? "A coalition with that slug already exists."
          : `Could not create coalition (${err.status}).`;
      return { error: message, values: { name, slug, description, coverImageUrl, displayOrder } };
    }
    throw err;
  }

  revalidatePath("/coalitions");
  return { ok: true };
}
