"use server";

import { redirect } from "next/navigation";
import { ApiError, apiFetch, UnauthorizedError } from "@organizer-hub/web-shared";

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
        `/campaigns/${encodeURIComponent(slug)}?error=${encodeURIComponent(err.message)}`,
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
