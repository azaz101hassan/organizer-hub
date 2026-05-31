import Link from "next/link";
import {
  ApiError,
  publicApiFetch,
  formatDateTime,
  getHouseOrgId,
} from "@organizer-hub/web-shared";
import type { PublicEventsPage } from "@organizer-hub/web-shared";

export const dynamic = "force-dynamic";

interface PublicLabelChip {
  id: string;
  name: string;
  slug: string;
}

async function fetchLabels(): Promise<PublicLabelChip[]> {
  let houseOrgId: string;
  try {
    houseOrgId = getHouseOrgId();
  } catch {
    // Member is still allowed to render /events without HOUSE_ORG_ID set;
    // it just renders without the filter strip in that case.
    return [];
  }
  try {
    return await publicApiFetch<PublicLabelChip[]>(
      `/public/event-labels?organizationId=${encodeURIComponent(houseOrgId)}`,
    );
  } catch {
    return [];
  }
}

export default async function PublicEventsListPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string; labelId?: string }>;
}) {
  const { cursor, labelId } = await searchParams;

  let page: PublicEventsPage;
  const labels = await fetchLabels();
  try {
    const qs = new URLSearchParams({ limit: "20" });
    if (cursor) qs.set("cursor", cursor);
    if (labelId) qs.set("labelId", labelId);
    page = await publicApiFetch<PublicEventsPage>(
      `/public/events?${qs.toString()}`,
    );
  } catch (err) {
    if (err instanceof ApiError && err.status === 400) {
      // Stale or malformed cursor — start over.
      const qsClean = new URLSearchParams({ limit: "20" });
      if (labelId) qsClean.set("labelId", labelId);
      page = await publicApiFetch<PublicEventsPage>(
        `/public/events?${qsClean.toString()}`,
      );
    } else {
      throw err;
    }
  }

  return (
    <main className="min-h-screen bg-zinc-50 dark:bg-black">
      <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
        <div className="max-w-3xl mx-auto px-6 py-3 flex items-center justify-between">
          <Link
            href="/"
            className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"
          >
            OrganizerHub
          </Link>
          <Link
            href="/auth/login"
            className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          >
            Sign in
          </Link>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Upcoming events
        </h1>

        {labels.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            <FilterChip
              href="/events"
              active={!labelId}
              label="All"
            />
            {labels.map((l) => (
              <FilterChip
                key={l.id}
                href={`/events?labelId=${encodeURIComponent(l.id)}`}
                active={labelId === l.id}
                label={l.name}
              />
            ))}
          </div>
        )}

        {page.items.length === 0 ? (
          <p className="mt-6 text-sm text-zinc-500">
            No upcoming events yet — check back soon.
          </p>
        ) : (
          <ul className="mt-6 divide-y divide-zinc-200 dark:divide-zinc-800 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
            {page.items.map((event) => (
              <li key={event.id}>
                <Link
                  href={`/events/${event.id}`}
                  className="block px-5 py-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-base font-medium text-zinc-900 dark:text-zinc-50">
                      {event.title}
                    </p>
                    {event.label && (
                      <span className="shrink-0 rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
                        {event.label.name}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">
                    {formatDateTime(event.startsAt)} · {event.organization.name}
                    {event.venue && ` · ${event.venue}`}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {page.nextCursor && (
          <div className="mt-6 text-right">
            <Link
              href={`/events?${new URLSearchParams({
                cursor: page.nextCursor,
                ...(labelId ? { labelId } : {}),
              }).toString()}`}
              className="text-sm text-blue-600 hover:underline"
            >
              Next page →
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}

function FilterChip({
  href,
  active,
  label,
}: {
  href: string;
  active: boolean;
  label: string;
}) {
  const base =
    "rounded-full px-3 py-1 text-xs font-medium transition border";
  const cls = active
    ? `${base} bg-zinc-900 dark:bg-zinc-100 text-zinc-50 dark:text-zinc-900 border-transparent`
    : `${base} bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800`;
  return (
    <Link href={href} className={cls}>
      {label}
    </Link>
  );
}
