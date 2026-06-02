"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  ApiError,
  apiFetch,
  UnauthorizedError,
  getHouseOrgId,
} from "@organizer-hub/web-shared";

// ─── Update Campaign ────────────────────────────────────────────────────────

export interface CampaignUpdateFormState {
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

function parseBodyMessage(body: string, fallback: string): string {
  try {
    const parsed: unknown = JSON.parse(body);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "message" in parsed &&
      typeof (parsed as { message: unknown }).message === "string"
    ) {
      return (parsed as { message: string }).message;
    }
  } catch {
    // fall through
  }
  return fallback;
}

function validateCampaignUpdateFields(
  name: string,
  slug: string,
  targetRaw: string,
  coverImageUrl: string | undefined,
  currency: string | undefined,
): { fieldErrors?: CampaignUpdateFormState["fieldErrors"]; targetAmountCents?: number } {
  const errors: NonNullable<CampaignUpdateFormState["fieldErrors"]> = {};

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
    errors.target = "Goal in USD is required.";
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

export async function updateCampaign(
  id: string,
  _prev: CampaignUpdateFormState,
  formData: FormData,
): Promise<CampaignUpdateFormState> {
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

  const preserved: CampaignUpdateFormState["values"] = {
    name,
    slug,
    description,
    coverImageUrl,
    target: targetRaw,
    currency: currencyRaw,
    deadline: deadlineRaw,
    displayOrder,
  };

  const { fieldErrors: campaignFieldErrors, targetAmountCents } = validateCampaignUpdateFields(
    name,
    slug,
    targetRaw,
    coverImageUrl,
    currencyRaw || undefined,
  );
  const fieldErrors =
    campaignFieldErrors || displayOrderFieldError
      ? {
          ...campaignFieldErrors,
          ...(displayOrderFieldError ? { displayOrder: displayOrderFieldError } : {}),
        }
      : undefined;
  if (fieldErrors) {
    return { fieldErrors, values: preserved };
  }

  try {
    await apiFetch(
      `/orgs/${encodeURIComponent(orgId)}/campaigns/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        body: {
          name,
          slug,
          targetAmountCents: targetAmountCents!,
          ...(description !== undefined ? { description } : {}),
          ...(coverImageUrl !== undefined ? { coverImageUrl } : {}),
          ...(currency !== undefined ? { currency } : {}),
          ...(deadline !== undefined ? { deadline } : {}),
          ...(displayOrder !== undefined ? { displayOrder } : {}),
        },
      },
    );
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login");
    if (err instanceof ApiError) {
      const message =
        err.status === 409
          ? parseBodyMessage(err.body, "A campaign with that slug already exists.")
          : `Could not save changes (${err.status}).`;
      return { error: message, values: preserved };
    }
    throw err;
  }

  revalidatePath(`/campaigns/${id}`);
  revalidatePath("/coalitions");
  return { ok: true };
}

// ─── Transition Campaign ────────────────────────────────────────────────────

export interface CampaignTransitionFormState {
  error?: string;
  ok?: boolean;
}

const VALID_STATUSES = new Set(["DRAFT", "ACTIVE", "COMPLETE", "ARCHIVED"]);

export async function transitionCampaign(
  id: string,
  _prev: CampaignTransitionFormState,
  formData: FormData,
): Promise<CampaignTransitionFormState> {
  const orgId = getHouseOrgId();
  const to = String(formData.get("to") ?? "").trim();

  if (!VALID_STATUSES.has(to)) {
    return { error: "Invalid target status." };
  }

  try {
    await apiFetch(
      `/orgs/${encodeURIComponent(orgId)}/campaigns/${encodeURIComponent(id)}/transition`,
      {
        method: "POST",
        body: { to },
      },
    );
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login");
    if (err instanceof ApiError) {
      if (err.status === 400 || err.status === 409) {
        return {
          error: parseBodyMessage(
            err.body,
            err.status === 409
              ? "Could not transition campaign — please reload and try again."
              : `Transition to ${to} is not permitted from the current status.`,
          ),
        };
      }
      return { error: `Could not transition campaign (${err.status}).` };
    }
    throw err;
  }

  revalidatePath(`/campaigns/${id}`);
  revalidatePath("/coalitions");
  return { ok: true };
}
