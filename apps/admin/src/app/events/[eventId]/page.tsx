import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ApiError, apiFetch, UnauthorizedError, getHouseOrgId } from "@organizer-hub/web-shared";
import type {
  EventLabelView,
  EventStatus,
  EventView,
  OrganizationView,
} from "@organizer-hub/web-shared";
import EventEditor from "./EventEditor";

const WEB_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:3000";

const STATUS_BADGE: Record<EventStatus, string> = {
  DRAFT: "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300",
  PUBLISHED:
    "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300",
  CANCELLED: "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300",
};

export default async function EventEditPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const orgId = getHouseOrgId();

  let event: EventView;
  let org: OrganizationView;
  let labels: EventLabelView[];
  try {
    [event, org, labels] = await Promise.all([
      apiFetch<EventView>(`/organizations/${orgId}/events/${eventId}`),
      apiFetch<OrganizationView>(`/organizations/${orgId}`),
      apiFetch<EventLabelView[]>(
        `/event-labels?organizationId=${encodeURIComponent(orgId)}`,
      ),
    ]);
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login");
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }

  const canMutate = org.role === "OWNER" || org.role === "ADMIN";
  const publicUrl =
    event.status === "PUBLISHED" ? `${WEB_ORIGIN}/events/${event.id}` : null;

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <Link
          href="/events"
          className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
        >
          ← Back to events
        </Link>
        <div className="mt-2 flex items-baseline justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {event.title}
          </h1>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${STATUS_BADGE[event.status]}`}
          >
            {event.status}
          </span>
        </div>
        {publicUrl && (
          <p className="mt-2 text-xs text-zinc-500">
            Public URL:{" "}
            <a
              href={publicUrl}
              className="text-blue-600 hover:underline break-all"
            >
              {publicUrl}
            </a>
          </p>
        )}
      </div>

      <EventEditor
        orgId={orgId}
        eventId={eventId}
        event={event}
        labels={labels}
        canMutate={canMutate}
      />
    </div>
  );
}
