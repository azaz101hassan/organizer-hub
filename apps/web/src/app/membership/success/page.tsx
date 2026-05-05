import Link from "next/link";
import { redirect } from "next/navigation";
import { apiFetch, UnauthorizedError } from "@/lib/api/client";
import type { MembershipView } from "@/lib/api/types";

// /membership/success — Stripe's success_url landing. We hit /memberships/me
// which opportunistically syncs from Stripe if the local row hasn't landed
// yet (webhook latency). If the user still sees "processing" they can
// reload; the dashboard does the same call.
export default async function MembershipSuccessPage() {
  let membership: MembershipView | null;
  try {
    membership = await apiFetch<MembershipView | null>("/memberships/me");
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login");
    throw err;
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-black px-6">
      <div className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-2xl shadow-xl p-10 text-center">
        {membership ? (
          <>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              Welcome to {membership.tier.charAt(0)}
              {membership.tier.slice(1).toLowerCase()}
            </h1>
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
              Your membership is active. You can manage it from your dashboard
              any time.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              Your payment is processing
            </h1>
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
              Stripe is still confirming your subscription. Refresh in a few
              seconds, or head to your dashboard — we&apos;ll update it as
              soon as the webhook lands.
            </p>
          </>
        )}

        <div className="mt-6 flex items-center justify-center gap-3">
          <Link
            href="/dashboard/membership"
            className="inline-block rounded-full bg-zinc-900 dark:bg-zinc-100 text-zinc-50 dark:text-zinc-900 px-5 py-2 text-sm font-medium hover:bg-zinc-700 dark:hover:bg-zinc-300 transition"
          >
            View membership
          </Link>
          <Link
            href="/events"
            className="inline-block rounded-full border border-zinc-300 dark:border-zinc-700 px-5 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
          >
            Browse events
          </Link>
        </div>
      </div>
    </main>
  );
}
