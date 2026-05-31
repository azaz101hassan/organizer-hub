import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ApiError, apiFetch, UnauthorizedError } from "@organizer-hub/web-shared";
import type {
  EventView,
  OrganizationView,
  TicketTypeView,
} from "@organizer-hub/web-shared";
import { TicketTypeAddForm, TicketTypeRow } from "./TicketTypeEditor";

export default async function TicketTypesPage({
  params,
}: {
  params: Promise<{ orgId: string; eventId: string }>;
}) {
  const { orgId, eventId } = await params;

  let org: OrganizationView;
  let event: EventView;
  let ticketTypes: TicketTypeView[];
  try {
    [org, event, ticketTypes] = await Promise.all([
      apiFetch<OrganizationView>(`/organizations/${orgId}`),
      apiFetch<EventView>(`/organizations/${orgId}/events/${eventId}`),
      apiFetch<TicketTypeView[]>(
        `/organizations/${orgId}/events/${eventId}/ticket-types`,
      ),
    ]);
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login");
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }

  const canMutate = org.role === "OWNER" || org.role === "ADMIN";

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <Link
          href={`/dashboard/organizations/${orgId}/events/${eventId}`}
          className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
        >
          ← Back to {event.title}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Ticket types
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          {event.membersExcluded
            ? "Members are excluded from this event — every tier sells as paid only."
            : "Members at or above the configured tier can claim a free ticket; everyone else pays."}
        </p>
      </div>

      {ticketTypes.length === 0 ? (
        <div className="mb-6 rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-700 p-8 text-center text-sm text-zinc-500">
          No ticket tiers yet.
          {canMutate ? " Add one below to start selling." : ""}
        </div>
      ) : (
        <ul className="mb-6 divide-y divide-zinc-200 dark:divide-zinc-800 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          {ticketTypes.map((tt) => (
            <TicketTypeRow
              key={tt.id}
              orgId={orgId}
              eventId={eventId}
              ticketType={tt}
              disabled={!canMutate}
            />
          ))}
        </ul>
      )}

      {canMutate && (
        <TicketTypeAddForm orgId={orgId} eventId={eventId} disabled={false} />
      )}
    </div>
  );
}
