"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ApiError, apiFetch, UnauthorizedError } from "@/lib/api/client";

export interface CancelRequestState {
  error?: string;
}

// Self-cancel a PENDING request. On success the cancelled request has no
// interactive value, so we redirect back to the list (Design State
// Conventions). On 409 (already decided) we stay on the detail page and
// revalidate it so the now-current status renders.
export async function cancelRequest(
  _prev: CancelRequestState,
  formData: FormData,
): Promise<CancelRequestState> {
  const requestId = String(formData.get("requestId") ?? "");

  try {
    await apiFetch(`/requests/${requestId}/cancel`, { method: "POST" });
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login");
    if (err instanceof ApiError) {
      if (err.status === 409) {
        revalidatePath(`/dashboard/requests/${requestId}`);
        return { error: "This request can no longer be cancelled." };
      }
      return { error: `Couldn't cancel (${err.status}). Please try again.` };
    }
    throw err;
  }

  redirect("/dashboard/requests");
}
