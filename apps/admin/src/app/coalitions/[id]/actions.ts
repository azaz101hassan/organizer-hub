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

function parseBodyMessage(body: string, fallback: string): string {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === "object" && parsed !== null && "message" in parsed) {
      const msg = (parsed as { message: unknown }).message;
      if (typeof msg === "string") return msg;
      if (Array.isArray(msg) && msg.length > 0) return msg.join("; ");
    }
  } catch {
    // fall through
  }
  return fallback;
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
  let displayOrder: number | undefined;
  let displayOrderFieldError: string | undefined;
  if (displayOrderRaw) {
    const parsed = Number(displayOrderRaw);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0 || parsed > 9999) {
      displayOrderFieldError = "Display order must be a whole number between 0 and 9999.";
    } else {
      displayOrder = parsed;
    }
  }

  const coalitionFieldErrors = validateCoalitionFields(name, slug);
  const fieldErrors =
    coalitionFieldErrors || displayOrderFieldError
      ? { ...coalitionFieldErrors, ...(displayOrderFieldError ? { displayOrder: displayOrderFieldError } : {}) }
      : undefined;
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
          ? parseBodyMessage(err.body, "A coalition with that slug already exists.")
          : err.status === 400
            ? parseBodyMessage(err.body, "Could not save changes — please check the form and try again.")
            : `Could not save changes (${err.status}).`;
      return { error: message, values: { name, slug, description, coverImageUrl, displayOrder } };
    }
    throw err;
  }

  revalidatePath(`/coalitions/${id}`);
  revalidatePath("/coalitions");
  return { ok: true };
}

// ─── Transition Coalition ───────────────────────────────────────────────────

export interface CoalitionTransitionFormState {
  error?: string;
  ok?: boolean;
}

const VALID_OPS = new Set(["archive", "restore"]);

export async function transitionCoalition(
  id: string,
  _prev: CoalitionTransitionFormState,
  formData: FormData,
): Promise<CoalitionTransitionFormState> {
  const orgId = getHouseOrgId();
  const op = String(formData.get("op") ?? "").trim();

  if (!VALID_OPS.has(op)) {
    return { error: "Invalid operation." };
  }

  try {
    await apiFetch(
      `/orgs/${encodeURIComponent(orgId)}/coalitions/${encodeURIComponent(id)}/${op}`,
      { method: "POST" },
    );
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login");
    if (err instanceof ApiError) {
      if (err.status === 409) {
        return {
          error: parseBodyMessage(
            err.body,
            "This coalition was already updated by someone else. Please refresh the page and try again.",
          ),
        };
      }
      return { error: `Could not update the coalition (${err.status}).` };
    }
    throw err;
  }

  revalidatePath(`/coalitions/${id}`);
  revalidatePath("/coalitions");
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

const GOAL_PATTERN = /^\d+(?:\.\d{1,2})?$/;

function validateCampaignFields(
  name: string,
  slug: string,
  targetRaw: string,
  coverImageUrl: string | undefined,
  currency: string | undefined,
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
  if (!targetRaw) {
    errors.target = "Goal amount is required.";
  } else if (!GOAL_PATTERN.test(targetRaw)) {
    errors.target =
      "Goal must be a number with up to 2 decimal places (e.g. 100 or 100.50).";
  } else {
    const [whole, fraction = ""] = targetRaw.split(".");
    const cents = Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
    if (cents < 100) {
      errors.target = "Goal must be at least $1.";
    } else if (cents > 2_147_483_647) {
      errors.target = "Goal may not exceed $21,474,836.47.";
    } else {
      targetAmountCents = cents;
    }
  }

  if (
    coverImageUrl !== undefined &&
    coverImageUrl.length > 0 &&
    !/^(https?:\/\/|\/)/.test(coverImageUrl)
  ) {
    errors.coverImageUrl = "Cover image URL must start with https://, http://, or /.";
  }

  if (currency && !/^[a-z]{3}$/.test(currency)) {
    errors.currency = "Currency must be 3 lowercase letters (e.g. usd).";
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
  let displayOrder: number | undefined;
  let displayOrderFieldError: string | undefined;
  if (displayOrderRaw) {
    const parsed = Number(displayOrderRaw);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0 || parsed > 9999) {
      displayOrderFieldError = "Display order must be a whole number between 0 and 9999.";
    } else {
      displayOrder = parsed;
    }
  }

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

  const { fieldErrors: campaignFieldErrors, targetAmountCents } = validateCampaignFields(
    name,
    slug,
    targetRaw,
    coverImageUrl,
    currencyRaw || undefined,
  );
  const fieldErrors =
    campaignFieldErrors || displayOrderFieldError
      ? { ...campaignFieldErrors, ...(displayOrderFieldError ? { displayOrder: displayOrderFieldError } : {}) }
      : undefined;
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
      if (err.status === 409) {
        // The API returns two distinct 409s: slug collision and archived parent.
        // Surface the API's message so the admin sees the real cause rather than
        // a misleading "slug already exists" message in the archived-parent case.
        return {
          error: parseBodyMessage(err.body, "Could not create the campaign — please reload and try again."),
          values: preserved,
        };
      }
      if (err.status === 400) {
        return {
          error: parseBodyMessage(err.body, "Could not save changes — please check the form and try again."),
          values: preserved,
        };
      }
      return { error: `Could not save changes (${err.status}).`, values: preserved };
    }
    throw err;
  }

  revalidatePath(`/coalitions/${coalitionId}`);
  return { ok: true };
}
