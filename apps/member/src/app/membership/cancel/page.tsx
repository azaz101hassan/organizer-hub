import Link from "next/link";

// /membership/cancel — Stripe's cancel_url landing. No state change here:
// Stripe Checkout aborts cleanly when the user backs out and never sends a
// success-side webhook, so the local mirror stays as-is.
export default function MembershipCancelPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-black px-6">
      <div className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-2xl shadow-xl p-10 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          No charge — you backed out of checkout
        </h1>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          Nothing was charged. You can return to the pricing page any time.
        </p>
        <Link
          href="/membership"
          className="mt-6 inline-block rounded-full bg-zinc-900 dark:bg-zinc-100 text-zinc-50 dark:text-zinc-900 px-5 py-2 text-sm font-medium hover:bg-zinc-700 dark:hover:bg-zinc-300 transition"
        >
          Back to membership
        </Link>
      </div>
    </main>
  );
}
