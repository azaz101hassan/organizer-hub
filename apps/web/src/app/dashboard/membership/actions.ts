"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ApiError, apiFetch, UnauthorizedError } from "@/lib/api/client";

export interface CancelState {
  error?: string;
}

export async function cancelMembership(
  _prev: CancelState,
  _formData: FormData,
): Promise<CancelState> {
  try {
    await apiFetch("/billing/membership/cancel", { method: "POST" });
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login");
    if (err instanceof ApiError) {
      return { error: `Couldn't cancel (${err.status}). Please try again.` };
    }
    throw err;
  }
  // Refresh the dashboard page's cached fetch so the new cancelAtPeriodEnd
  // banner appears on next render.
  revalidatePath("/dashboard/membership");
  return {};
}
