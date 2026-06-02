"use server";

import { revalidatePath } from "next/cache";
import { cancelDonation } from "../../campaigns/actions";

export type CancelDonationState = { error?: string };

export async function cancelRecurringAction(
  _prev: CancelDonationState,
  formData: FormData,
): Promise<CancelDonationState> {
  const id = String(formData.get("donationId") ?? "");
  if (!id) return { error: "Something went wrong. Please try again." };
  const result = await cancelDonation(id);
  if ("error" in result) return { error: result.error };
  revalidatePath("/dashboard/donations");
  return {};
}
