import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ApiError, apiFetch, UnauthorizedError } from "@organizer-hub/web-shared";
import type { EventStatus, EventView, OrganizationView } from "@organizer-hub/web-shared";
import { formatDateTime } from "@/lib/format";

const STATUS_BADGE: Record<EventStatus, string> = {
  DRAFT: "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300",
  PUBLISHED:
    "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300",
  CANCELLED: "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300",
};

export default async function OrganizationPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;

  let org: OrganizationView;
  let events: EventView[];
  try {
    [org, events] = await Promise.all([
      apiFetch<OrganizationView>(`/organizations/${orgId}`),
      apiFetch<EventView[]>(`/organizations/${orgId}/events`),
    ]);
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login");
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }

  const canMutate = org.role === "OWNER" || org.role === "ADMIN";

  return (
    <div>
      <div className="mb-8">
        <Link
          href="/dashboard"
          className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
        >
          ← All organizations
        </Link>
        <div className="mt-2 flex items-baseline justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              {org.name}
            </h1>
            {org.description && (
              <p className="mt-1 text-sm text-zinc-500">{org.description}</p>
            )}
          </div>
          <span className="shrink-0 rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
            {org.role}
          </span>
        </div>
        {canMutate && (
          <div className="mt-3">
            <Link
              href={`/dashboard/organizations/${org.id}/requests`}
              className="text-xs text-blue-600 hover:underline"
            >
              Ticket requests →
            </Link>
          </div>
        )}
      </div>

      <section>
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Events
          </h2>
          {canMutate && (
            <Link
              href={`/dashboard/organizations/${org.id}/events/new`}
              className="rounded-full bg-zinc-900 dark:bg-zinc-100 text-zinc-50 dark:text-zinc-900 px-4 py-1.5 text-xs font-medium hover:bg-zinc-700 dark:hover:bg-zinc-300 transition"
            >
              New event
            </Link>
          )}
        </div>

        {events.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-700 p-8 text-center text-sm text-zinc-500">
            No events yet.
            {canMutate && (
              <>
                {" "}
                <Link
                  href={`/dashboard/organizations/${org.id}/events/new`}
                  className="text-blue-600 hover:underline"
                >
                  Create the first one
                </Link>
                .
              </>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
            {events.map((event) => (
              <li key={event.id}>
                <Link
                  href={`/dashboard/organizations/${org.id}/events/${event.id}`}
                  className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
                      {event.title}
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {formatDateTime(event.startsAt)}
                      {event.venue && ` · ${event.venue}`}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${STATUS_BADGE[event.status]}`}
                  >
                    {event.status}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
