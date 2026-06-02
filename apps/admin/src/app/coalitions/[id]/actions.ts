"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  ApiError,
  apiFetch,
  UnauthorizedError,
  getHouseOrgId,
} from "@organizer-hub/web-shared";

// ─── Update Coalition ───────────────────────────────────────────────────────

export interface CoalitionUpdateFormState {
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

function validateCoalitionFields(
  name: string,
  slug: string,
): CoalitionUpdateFormState["fieldErrors"] {
  const errors: NonNullable<CoalitionUpdateFormState["fieldErrors"]> = {};
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

export async function updateCoalition(
  id: string,
  _prev: CoalitionUpdateFormState,
  formData: FormData,
): Promise<CoalitionUpdateFormState> {
  const orgId = getHouseOrgId();
  const name = String(formData.get("name") ?? "").trim();
  const slug = String(formData.get("slug") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || undefined;
  const coverImageUrl = String(formData.get("coverImageUrl") ?? "").trim() || undefined;
  const displayOrderRaw = String(formData.get("displayOrder") ?? "");
  const displayOrder = displayOrderRaw ? Number(displayOrderRaw) : undefined;

  const fieldErrors = validateCoalitionFields(name, slug);
  if (fieldErrors) {
    return { fieldErrors, values: { name, slug, description, coverImageUrl, displayOrder } };
  }

  try {
    await apiFetch(`/orgs/${encodeURIComponent(orgId)}/coalitions/${encodeURIComponent(id)}`, {
      method: "PATCH",
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
          : `Could not save changes (${err.status}).`;
      return { error: message, values: { name, slug, description, coverImageUrl, displayOrder } };
    }
    throw err;
  }

  revalidatePath("/coalitions/[id]");
  return { ok: true };
}

// ─── Create Campaign ────────────────────────────────────────────────────────

export interface CampaignCreateFormState {
  error?: string;
  fieldErrors?: {
    name?: string;
    slug?: string;
    description?: string;
    coverImageUrl?: string;
    target?: string;
    currency?: string;
    deadline?: string;
    displayOrder?: string;
  };
  values?: {
    name?: string;
    slug?: string;
    description?: string;
    coverImageUrl?: string;
    target?: string;
    currency?: string;
    deadline?: string;
    displayOrder?: number;
  };
  ok?: boolean;
}

function validateCampaignFields(
  name: string,
  slug: string,
  targetRaw: string,
  coverImageUrl: string | undefined,
): { fieldErrors?: CampaignCreateFormState["fieldErrors"]; targetAmountCents?: number } {
  const errors: NonNullable<CampaignCreateFormState["fieldErrors"]> = {};

  if (name.length < 1) errors.name = "Name is required.";
  if (name.length > 120) errors.name = "Name must be 120 characters or fewer.";

  if (slug.length < 1) errors.slug = "Slug is required.";
  if (slug.length > 80) errors.slug = "Slug must be 80 characters or fewer.";
  if (slug.length >= 1 && !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug)) {
    errors.slug =
      "Slug must be lowercase letters, digits, or hyphens with no leading or trailing hyphen.";
  }

  let targetAmountCents: number | undefined;
  const targetFloat = parseFloat(targetRaw);
  if (!targetRaw || !Number.isFinite(targetFloat) || targetFloat <= 0) {
    errors.target = "Goal is required and must be a positive number.";
  } else {
    targetAmountCents = Math.round(targetFloat * 100);
    if (targetAmountCents < 100) {
      errors.target = "Goal must be at least $1.00.";
    }
  }

  if (
    coverImageUrl !== undefined &&
    coverImageUrl.length > 0 &&
    !/^(https?:\/\/|\/)/.test(coverImageUrl)
  ) {
    errors.coverImageUrl = "Cover image URL must start with https://, http://, or /.";
  }

  if (Object.keys(errors).length > 0) {
    return { fieldErrors: errors };
  }
  return { targetAmountCents };
}

export async function createCampaign(
  coalitionId: string,
  _prev: CampaignCreateFormState,
  formData: FormData,
): Promise<CampaignCreateFormState> {
  const orgId = getHouseOrgId();
  const name = String(formData.get("name") ?? "").trim();
  const slug = String(formData.get("slug") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || undefined;
  const coverImageUrl = String(formData.get("coverImageUrl") ?? "").trim() || undefined;
  const targetRaw = String(formData.get("target") ?? "").trim();
  const currencyRaw = String(formData.get("currency") ?? "").trim();
  const currency = currencyRaw || undefined;
  const deadlineRaw = String(formData.get("deadline") ?? "").trim();
  const deadline = deadlineRaw || undefined;
  const displayOrderRaw = String(formData.get("displayOrder") ?? "");
  const displayOrder = displayOrderRaw ? Number(displayOrderRaw) : undefined;

  const preserved: CampaignCreateFormState["values"] = {
    name,
    slug,
    description,
    coverImageUrl,
    target: targetRaw,
    currency: currencyRaw,
    deadline: deadlineRaw,
    displayOrder,
  };

  const { fieldErrors, targetAmountCents } = validateCampaignFields(
    name,
    slug,
    targetRaw,
    coverImageUrl,
  );
  if (fieldErrors) {
    return { fieldErrors, values: preserved };
  }

  try {
    await apiFetch(`/orgs/${encodeURIComponent(orgId)}/campaigns`, {
      method: "POST",
      body: {
        coalitionId,
        name,
        slug,
        targetAmountCents: targetAmountCents!,
        ...(description !== undefined ? { description } : {}),
        ...(coverImageUrl !== undefined ? { coverImageUrl } : {}),
        ...(currency !== undefined ? { currency } : {}),
        ...(deadline !== undefined ? { deadline } : {}),
        ...(displayOrder !== undefined ? { displayOrder } : {}),
      },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login");
    if (err instanceof ApiError) {
      const message =
        err.status === 409
          ? "A campaign with that slug already exists."
          : `Could not save changes (${err.status}).`;
      return { error: message, values: preserved };
    }
    throw err;
  }

  revalidatePath("/coalitions/[id]");
  return { ok: true };
}
