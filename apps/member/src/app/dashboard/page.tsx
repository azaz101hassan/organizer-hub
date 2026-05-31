import Link from "next/link";
import { redirect } from "next/navigation";
import {
  apiFetch,
  formatDateTime,
  UnauthorizedError,
} from "@organizer-hub/web-shared";
import type {
  MembershipView,
  RequesterTicketRequestView,
  TicketRequestStatus,
} from "@organizer-hub/web-shared";

export const dynamic = "force-dynamic";

interface RequestCounts {
  pending: number;
  approved: number;
  rejected: number;
}

function countByStatus(requests: RequesterTicketRequestView[]): RequestCounts {
  const counts: RequestCounts = { pending: 0, approved: 0, rejected: 0 };
  for (const r of requests) {
    if (r.status === "PENDING") counts.pending += 1;
    else if (r.status === "APPROVED") counts.approved += 1;
    else if (r.status === "REJECTED") counts.rejected += 1;
  }
  return counts;
}

const STATUS_LABEL: Record<TicketRequestStatus, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  CANCELLED_BY_USER: "Cancelled",
  EXPIRED: "Expired",
};

export default async function DashboardPage() {
  let membership: MembershipView | null = null;
  let requests: RequesterTicketRequestView[] = [];
  try {
    [membership, requests] = await Promise.all([
      apiFetch<MembershipView | null>("/memberships/me").catch((err: unknown) => {
        if (err instanceof UnauthorizedError) throw err;
        return null;
      }),
      apiFetch<RequesterTicketRequestView[]>("/requests").catch((err: unknown) => {
        if (err instanceof UnauthorizedError) throw err;
        return [];
      }),
    ]);
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login");
    throw err;
  }

  const counts = countByStatus(requests);
  const tierLabel = membership
    ? membership.tier.charAt(0) + membership.tier.slice(1).toLowerCase()
    : null;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Welcome back
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Your membership, ticket requests, and the latest events at a glance.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card title="Membership">
          {membership ? (
            <>
              <p className="text-sm text-zinc-900 dark:text-zinc-50">
                {tierLabel}{" "}
                <span className="text-zinc-500">— {membership.status.toLowerCase().replace(/_/g, " ")}</span>
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                {membership.cancelAtPeriodEnd ? "Cancels" : "Renews"}{" "}
                {formatDateTime(membership.currentPeriodEnd)}
              </p>
            </>
          ) : (
            <p className="text-sm text-zinc-700 dark:text-zinc-300">
              No active membership.
            </p>
          )}
          <Link
            href={membership ? "/dashboard/membership" : "/membership"}
            className="mt-3 inline-block text-xs text-blue-600 hover:underline"
          >
            {membership ? "Manage →" : "Browse plans →"}
          </Link>
        </Card>

        <Card title="My requests">
          {requests.length === 0 ? (
            <p className="text-sm text-zinc-700 dark:text-zinc-300">
              No ticket requests yet.
            </p>
          ) : (
            <ul className="text-sm text-zinc-700 dark:text-zinc-300 space-y-0.5">
              <li>Pending: {counts.pending}</li>
              <li>Approved: {counts.approved}</li>
              <li>Rejected: {counts.rejected}</li>
            </ul>
          )}
          <Link
            href="/dashboard/requests"
            className="mt-3 inline-block text-xs text-blue-600 hover:underline"
          >
            View all →
          </Link>
        </Card>

        <Card title="Browse">
          <p className="text-sm text-zinc-700 dark:text-zinc-300">
            Discover upcoming events.
          </p>
          <Link
            href="/events"
            className="mt-3 inline-block text-xs text-blue-600 hover:underline"
          >
            All events →
          </Link>
        </Card>

        <Card title="Payments">
          <p className="text-sm text-zinc-700 dark:text-zinc-300">
            Every charge, refund, and renewal.
          </p>
          <Link
            href="/dashboard/payments"
            className="mt-3 inline-block text-xs text-blue-600 hover:underline"
          >
            View all →
          </Link>
        </Card>
      </div>
    </div>
  );
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
      <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}
