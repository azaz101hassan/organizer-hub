"use server";

import { redirect } from "next/navigation";
import { ApiError, apiFetch, UnauthorizedError } from "@organizer-hub/web-shared";

function donorSafeErrorMessage(status: number): string {
  if (status === 400) return "Please check your amount and try again.";
  if (status === 401) return "Please sign in to donate.";
  if (status === 403) return "You're not authorized to donate to this campaign.";
  if (status === 404) return "This campaign isn't available anymore.";
  if (status === 409) return "This campaign is not accepting donations right now.";
  if (status === 429) return "Too many attempts. Please wait a moment and try again.";
  if (status >= 500) return "Something went wrong on our end. Please try again.";
  return "We couldn't start your donation. Please try again.";
}

function isSafeRelativePath(value: string | undefined): value is string {
  if (!value) return false;
  if (!value.startsWith("/")) return false;
  if (value.startsWith("//")) return false;
  return true;
}

export async function donateNow(
  slug: string,
  errorPath: string | undefined,
  formData: FormData,
): Promise<void> {
  const campaignId = String(formData.get("campaignId") ?? "");
  const cadence = String(formData.get("cadence") ?? "ONCE");
  const amountCents = Number(formData.get("amountCents") ?? 0);

  const failurePath = isSafeRelativePath(errorPath)
    ? errorPath
    : `/campaigns/${encodeURIComponent(slug)}`;

  if (
    !campaignId ||
    !Number.isFinite(amountCents) ||
    amountCents < 100 ||
    amountCents > 1_000_000
  ) {
    redirect(`${failurePath}?error=${encodeURIComponent("Invalid amount")}`);
  }

  let url: string;
  try {
    const res = await apiFetch<{ url: string; donationId: string }>(
      "/billing/checkout/donation",
      { method: "POST", body: { campaignId, cadence, amountCents } },
    );
    url = res.url;
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      const next = encodeURIComponent(
        `${failurePath}?cadence=${cadence}&amount=${amountCents}`,
      );
      redirect(`/auth/login?next=${next}`);
    }
    if (err instanceof ApiError) {
      redirect(
        `${failurePath}?error=${encodeURIComponent(donorSafeErrorMessage(err.status))}`,
      );
    }
    throw err;
  }
  redirect(url);
}

function cancelDonationErrorMessage(status: number): string {
  // 404 covers two cases: the donation truly doesn't exist, OR donations were
  // turned off org-wide (the feature-flag guard short-circuits the route). The
  // message acknowledges both since we can't distinguish them client-side.
  if (status === 404)
    return "This donation can't be cancelled right now. It may have already been cancelled, or donations may be paused for your organization — please contact support.";
  if (status === 409) return "This donation is no longer active.";
  if (status === 429) return "Too many attempts. Please wait a moment and try again.";
  if (status >= 500) return "Something went wrong on our end. Please try again.";
  return "We couldn't cancel that donation. Please try again.";
}

export async function cancelDonation(
  donationId: string,
): Promise<{ ok: true } | { error: string }> {
  try {
    await apiFetch(
      `/billing/donation/${encodeURIComponent(donationId)}/cancel`,
      { method: "POST" },
    );
    return { ok: true };
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login");
    if (err instanceof ApiError) {
      return { error: cancelDonationErrorMessage(err.status) };
    }
    throw err;
  }
}
