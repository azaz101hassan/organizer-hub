import { redirect } from "next/navigation";
import { notFound } from "next/navigation";
import {
  ApiError,
  apiFetch,
  getHouseOrgId,
  UnauthorizedError,
} from "@organizer-hub/web-shared";
import type { EventView, OrganizationView } from "@organizer-hub/web-shared";
import {
  DataTable,
  type Column,
  Icon,
  StatusBadge,
} from "@organizer-hub/web-shared/ui";
import Link from "next/link";
import { PageHead } from "../../components/PageHead";
import { Thumb } from "../../components/Thumb";

export const dynamic = "force-dynamic";

export default async function AdminEventsPage() {
  const orgId = getHouseOrgId();
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

  const columns: Column<EventView>[] = [
    {
      key: "title",
      header: "Event",
      cell: (e) => (
        <Link
          href={`/events/${e.id}`}
          className="cellface"
          style={{ color: "inherit" }}
        >
          <Thumb event={e} />
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{e.title}</div>
            {e.venue && (
              <div className="faint" style={{ fontSize: 12, marginTop: 2 }}>
                {e.venue}
              </div>
            )}
          </div>
        </Link>
      ),
    },
    {
      key: "date",
      header: "Date",
      width: 160,
      cell: (e) => (
        <span className="muted" style={{ fontSize: 13 }}>
          {new Date(e.startsAt).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      width: 120,
      cell: (e) => <StatusBadge status={e.status} />,
    },
  ];

  return (
    <>
      <PageHead
        crumb={
          <>
            <Icon name="home" size={13} />
            {org.name}
            <Icon name="chevR" size={12} />
            Events
          </>
        }
        title="Events"
        sub={`${events.length} ${events.length === 1 ? "event" : "events"}`}
        actions={
          canMutate ? (
            <Link
              href="/events/new"
              className="btn btn--primary btn--sm"
            >
              <Icon name="plus" size={15} /> New event
            </Link>
          ) : undefined
        }
      />
      <DataTable
        columns={columns}
        rows={events}
        empty="No events yet. Create the first one."
      />
    </>
  );
}
