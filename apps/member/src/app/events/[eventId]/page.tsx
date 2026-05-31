import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ApiError,
  apiFetch,
  publicApiFetch,
  readSession,
  UnauthorizedError,
  formatDateTime,
} from "@organizer-hub/web-shared";
import type {
  CoverageResult,
  PublicEventView,
  TicketTypePublicView,
} from "@organizer-hub/web-shared";
import TicketRow from "./TicketRow";

export const dynamic = "force-dynamic";

export default async function PublicEventDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { eventId } = await params;
  const { error } = await searchParams;

  let event: PublicEventView;
  let ticketTypes: TicketTypePublicView[];
  try {
    [event, ticketTypes] = await Promise.all([
      publicApiFetch<PublicEventView>(`/public/events/${eventId}`),
      publicApiFetch<TicketTypePublicView[]>(
        `/public/events/${eventId}/ticket-types`,
      ),
    ]);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }

  const session = await readSession({ session: "oh_member_session", refresh: "oh_member_refresh", accessToken: "oh_member_access_token" });
  const signedIn = session !== null;

  // Coverage is per-user — only fetch if signed in. On any failure (token
  // expired, api blip) the verdicts default to BUY so the page still renders;
  // the api re-checks on claim/intake, so showing Buy when CLAIMABLE/AT_CAP was
  // possible only costs the user a click to refresh.
  let coverage: Record<string, CoverageResult> = {};
  if (signedIn && ticketTypes.length > 0) {
    const ids = ticketTypes.map((t) => t.id).join(",");
    try {
      coverage = await apiFetch<Record<string, CoverageResult>>(
        `/memberships/me/coverage?ticketTypeIds=${encodeURIComponent(ids)}`,
      );
    } catch (err) {
      if (!(err instanceof UnauthorizedError) && !(err instanceof ApiError)) {
        throw err;
      }
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
          {signedIn ? (
            <Link
              href="/dashboard/membership"
              className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            >
              Membership
            </Link>
          ) : (
            <Link
              href="/auth/login"
              className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            >
              Sign in
            </Link>
          )}
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-6 py-10">
        <Link
          href="/events"
          className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
        >
          ← All events
        </Link>
        <div className="mt-2 flex items-start justify-between gap-3">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {event.title}
          </h1>
          {event.label && (
            <span className="mt-2 shrink-0 rounded-full bg-zinc-100 dark:bg-zinc-800 px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
              {event.label.name}
            </span>
          )}
        </div>
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

        <section className="mt-10">
          <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Tickets
          </h2>

          {error && (
            <div className="mt-3 rounded-xl border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950/40 p-3 text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          {ticketTypes.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-500">
              Tickets aren&apos;t on sale yet — check back soon.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-zinc-200 dark:divide-zinc-800 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
              {ticketTypes.map((tt) => (
                <TicketRow
                  key={tt.id}
                  eventId={eventId}
                  ticketType={tt}
                  coverage={coverage[tt.id] ?? { verdict: "BUY" }}
                  signedIn={signedIn}
                />
              ))}
            </ul>
          )}

          {!signedIn && ticketTypes.some((t) => t.minTierLevel > 0) && (
            <p className="mt-3 text-xs text-zinc-500">
              <Link
                href="/membership"
                className="text-blue-600 hover:underline"
              >
                Become a member
              </Link>{" "}
              to claim covered tickets for free.
            </p>
          )}
        </section>
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
