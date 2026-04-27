import Link from "next/link";
import { notFound } from "next/navigation";
import { ApiError, publicApiFetch } from "@/lib/api/client";
import type { PublicEventView } from "@/lib/api/types";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function PublicEventDetailPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;

  let event: PublicEventView;
  try {
    event = await publicApiFetch<PublicEventView>(
      `/public/events/${eventId}`,
    );
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
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
        <Link
          href="/events"
          className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
        >
          ← All events
        </Link>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {event.title}
        </h1>
        <p className="mt-2 text-sm text-zinc-500">
          Hosted by{" "}
          <span className="text-zinc-700 dark:text-zinc-300">
            {event.organization.name}
          </span>
        </p>

        <dl className="mt-8 grid gap-4 sm:grid-cols-2">
          <Fact label="Starts">{formatDateTime(event.startsAt)}</Fact>
          {event.endsAt && (
            <Fact label="Ends">{formatDateTime(event.endsAt)}</Fact>
          )}
          {event.venue && <Fact label="Venue">{event.venue}</Fact>}
        </dl>

        {event.description && (
          <div className="mt-8">
            <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              About
            </h2>
            <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
              {event.description}
            </p>
          </div>
        )}

        <div className="mt-10">
          <button
            type="button"
            disabled
            title="Ticketing arrives in the next phase"
            className="cursor-not-allowed rounded-full bg-zinc-300 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-400 px-6 py-2.5 text-sm font-medium"
          >
            Get tickets · coming soon
          </button>
        </div>
      </div>
    </main>
  );
}

function Fact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-zinc-900 dark:text-zinc-50">
        {children}
      </dd>
    </div>
  );
}
