import Link from "next/link";
import { redirect } from "next/navigation";
import { apiFetch, UnauthorizedError, formatDateTime } from "@organizer-hub/web-shared";
import type {
  MembershipView,
  SubscriptionStatus,
} from "@organizer-hub/web-shared";
import { CancelButton } from "./CancelButton";

const STATUS_LABEL: Record<SubscriptionStatus, string> = {
  ACTIVE: "Active",
  TRIALING: "Trial",
  PAST_DUE: "Past due",
  CANCELED: "Canceled",
  UNPAID: "Unpaid",
  INCOMPLETE: "Awaiting payment",
  INCOMPLETE_EXPIRED: "Expired",
  PAUSED: "Paused",
};

const STATUS_BADGE: Record<SubscriptionStatus, string> = {
  ACTIVE:
    "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300",
  TRIALING:
    "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300",
  PAST_DUE: "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300",
  CANCELED: "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300",
  UNPAID: "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300",
  INCOMPLETE:
    "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300",
  INCOMPLETE_EXPIRED:
    "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300",
  PAUSED:
    "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300",
};

const CANCELLABLE: ReadonlySet<SubscriptionStatus> = new Set([
  "ACTIVE",
  "TRIALING",
  "PAST_DUE",
]);

export default async function DashboardMembershipPage() {
  let membership: MembershipView | null;
  try {
    membership = await apiFetch<MembershipView | null>("/memberships/me");
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login");
    throw err;
  }

  if (!membership) {
    return (
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Membership
        </h1>
        <div className="mt-6 rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-700 p-10 text-center">
          <p className="text-sm text-zinc-700 dark:text-zinc-300">
            You don&apos;t have an active membership.
          </p>
          <Link
            href="/membership"
            className="mt-4 inline-block rounded-full bg-blue-600 text-white px-5 py-2 text-sm font-medium hover:bg-blue-500 transition"
          >
            Browse plans
          </Link>
        </div>
      </div>
    );
  }

  const tierLabel =
    membership.tier.charAt(0) + membership.tier.slice(1).toLowerCase();
  const periodEnd = formatDateTime(membership.currentPeriodEnd);
  const cancelling =
    membership.cancelAtPeriodEnd && membership.status === "ACTIVE";

  return (
    <div>
      <div className="flex items-baseline justify-between mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Membership
        </h1>
        <Link
          href="/membership"
          className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
        >
          See all plans →
        </Link>
      </div>

      {membership.status === "PAST_DUE" && (
        <div className="mb-6 rounded-xl border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950/40 p-4 text-sm text-red-700 dark:text-red-300">
          Your last payment failed. Update your payment method to keep
          coverage — Stripe will retry automatically.
        </div>
      )}

      <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-zinc-500">
              Current tier
            </p>
            <h2 className="mt-1 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
              {tierLabel}
            </h2>
          </div>
          <span
            className={`shrink-0 rounded-full px-3 py-1 text-[10px] font-medium uppercase tracking-wide ${STATUS_BADGE[membership.status]}`}
          >
            {STATUS_LABEL[membership.status]}
          </span>
        </div>

        <dl className="mt-6 grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-zinc-500">
              {cancelling ? "Cancels on" : "Renews on"}
            </dt>
            <dd className="mt-1 text-sm text-zinc-900 dark:text-zinc-50">
              {periodEnd}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">Last updated</dt>
            <dd className="mt-1 text-sm text-zinc-900 dark:text-zinc-50">
              {formatDateTime(membership.updatedAt)}
            </dd>
          </div>
        </dl>

        {cancelling && (
          <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">
            You&apos;ve scheduled cancellation. Access continues until{" "}
            {periodEnd}.
          </p>
        )}

        {CANCELLABLE.has(membership.status) && !cancelling && (
          <div className="mt-6 border-t border-zinc-200 dark:border-zinc-800 pt-4">
            <CancelButton />
          </div>
        )}
      </div>
    </div>
  );
}
