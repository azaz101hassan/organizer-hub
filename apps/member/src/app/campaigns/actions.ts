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

export async function donateNow(
  slug: string,
  formData: FormData,
): Promise<void> {
  const campaignId = String(formData.get("campaignId") ?? "");
  const cadence = String(formData.get("cadence") ?? "ONCE");
  const amountCents = Number(formData.get("amountCents") ?? 0);

  if (
    !campaignId ||
    !Number.isFinite(amountCents) ||
    amountCents < 100 ||
    amountCents > 1_000_000
  ) {
    redirect(
      `/campaigns/${encodeURIComponent(slug)}?error=${encodeURIComponent("Invalid amount")}`,
    );
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
        `/campaigns/${slug}?cadence=${cadence}&amount=${amountCents}`,
      );
      redirect(`/auth/login?next=${next}`);
    }
    if (err instanceof ApiError) {
      redirect(
        `/campaigns/${encodeURIComponent(slug)}?error=${encodeURIComponent(donorSafeErrorMessage(err.status))}`,
      );
    }
    throw err;
  }
  redirect(url);
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
    if (err instanceof ApiError) return { error: err.message };
    throw err;
  }
}
