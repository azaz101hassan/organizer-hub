"use server";

import { redirect } from "next/navigation";
import { ApiError, apiFetch, UnauthorizedError } from "@organizer-hub/web-shared";

// subscribeToTier — called from the pricing page's per-card form. On
// unauthenticated callers we hop through /auth/login with a `next` so the
// user returns to /membership and can re-click; on success Stripe Checkout
// returns a URL we redirect the browser to.
//
// redirect() throws NEXT_REDIRECT and must run OUTSIDE the try block so the
// catch doesn't swallow it as an ApiError fallback.
export async function subscribeToTier(formData: FormData): Promise<void> {
  const lookupKey = String(formData.get("lookupKey") ?? "");

  let checkoutUrl: string;
  try {
    const res = await apiFetch<{ url: string }>("/billing/checkout/membership", {
      method: "POST",
      body: { lookupKey },
    });
    checkoutUrl = res.url;
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect(`/auth/login?next=${encodeURIComponent("/membership")}`);
    }
    if (err instanceof ApiError) {
      // Bounce back to /membership with an error flag. Phase 3 keeps the
      // error UX minimal — a banner could land in a follow-up.
      redirect(`/membership?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }

  redirect(checkoutUrl);
}
