import Link from "next/link";
import { ApiError, publicApiFetch } from "@organizer-hub/web-shared";
import type { PublicEventsPage } from "@organizer-hub/web-shared";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function PublicEventsListPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  const { cursor } = await searchParams;

  let page: PublicEventsPage;
  try {
    const qs = new URLSearchParams({ limit: "20" });
    if (cursor) qs.set("cursor", cursor);
    page = await publicApiFetch<PublicEventsPage>(
      `/public/events?${qs.toString()}`,
    );
  } catch (err) {
    if (err instanceof ApiError && err.status === 400) {
      // Stale or malformed cursor — start over.
      page = await publicApiFetch<PublicEventsPage>("/public/events?limit=20");
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
                  <p className="text-base font-medium text-zinc-900 dark:text-zinc-50">
                    {event.title}
                  </p>
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
              href={`/events?cursor=${encodeURIComponent(page.nextCursor)}`}
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
