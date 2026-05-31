import { notFound } from "next/navigation";
import {
  ApiError,
  apiFetch,
  publicApiFetch,
  readSession,
  UnauthorizedError,
} from "@organizer-hub/web-shared";
import type {
  CoverageResult,
  PublicEventView,
  TicketTypePublicView,
} from "@organizer-hub/web-shared";
import {
  Card,
  Chip,
  Display,
  Eyebrow,
  Poster,
  monogram,
  moodFor,
} from "@organizer-hub/web-shared/ui";
import { PublicShell } from "../../../components/PublicShell";
import { Fact } from "../../../components/Fact";
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

  const session = await readSession({
    session: "oh_member_session",
    refresh: "oh_member_refresh",
    accessToken: "oh_member_access_token",
  });
  const signedIn = session !== null;

  // Coverage is per-user — only fetch if signed in. On any failure (token
  // expired, api blip) the verdicts default to BUY so the page still renders.
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
    <PublicShell>
      {/* Hero poster — full-width, no horizontal container */}
      <Poster
        mood={moodFor(event)}
        label={monogram(event.title)}
        monoSize={520}
        style={{ height: 380 }}
      >
        <div
          style={{
            position: "absolute",
            zIndex: 2,
            inset: 0,
            background:
              "linear-gradient(180deg, transparent 40%, rgba(0,0,0,.5))",
          }}
        />
      </Poster>

      {/* Sticky-overhang card */}
      <div
        className="container container--narrow"
        style={{ marginTop: -120, position: "relative", zIndex: 3, paddingBottom: 80 }}
      >
        <Card style={{ padding: "34px 38px", boxShadow: "var(--shadow-lg)" }}>
          {/* Label + org row */}
          <div
            style={{
              display: "flex",
              gap: 10,
              alignItems: "center",
              marginBottom: 14,
              flexWrap: "wrap",
            }}
          >
            {event.label && <Chip>{event.label.name}</Chip>}
            {event.organization && (
              <Eyebrow muted>{event.organization.name}</Eyebrow>
            )}
          </div>

          {/* Event title */}
          <Display as="h1" style={{ fontSize: 44, marginBottom: 22 }}>
            {event.title}
          </Display>

          {/* Fact grid — date / time / venue */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 18,
              paddingBottom: 26,
              borderBottom: "1px solid var(--line)",
            }}
          >
            <Fact icon="calendar" label="Date">
              {new Date(event.startsAt).toLocaleDateString()}
            </Fact>
            <Fact icon="clock" label="Time">
              {new Date(event.startsAt).toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              })}
            </Fact>
            <Fact icon="pin" label="Venue">
              {event.venue ?? "TBA"}
            </Fact>
          </div>

          {/* Description */}
          {event.description && (
            <div
              style={{
                padding: "26px 0",
                borderBottom: "1px solid var(--line)",
              }}
            >
              <Eyebrow muted>About</Eyebrow>
              <p
                style={{
                  fontSize: 16,
                  lineHeight: 1.65,
                  marginTop: 10,
                  whiteSpace: "pre-wrap",
                  maxWidth: "65ch",
                }}
              >
                {event.description}
              </p>
            </div>
          )}

          {/* Tickets section */}
          <div style={{ paddingTop: 24 }}>
            <Eyebrow muted>Tickets</Eyebrow>

            {error && (
              <div
                style={{
                  marginTop: 12,
                  padding: 12,
                  borderRadius: "var(--radius-sm)",
                  background: "var(--bad-soft)",
                  color: "var(--bad)",
                  fontSize: 14,
                }}
              >
                {error}
              </div>
            )}

            {ticketTypes.length === 0 ? (
              <p className="muted" style={{ marginTop: 12 }}>
                Tickets aren&apos;t on sale yet — check back soon.
              </p>
            ) : (
              <Card
                style={{ marginTop: 12, overflow: "hidden", padding: 0 }}
              >
                <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
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
              </Card>
            )}

            {!signedIn && ticketTypes.some((t) => t.minTierLevel > 0) && (
              <p style={{ marginTop: 12, fontSize: 13, color: "var(--muted)" }}>
                <a href="/membership" className="link">
                  Become a member
                </a>{" "}
                to claim covered tickets for free.
              </p>
            )}
          </div>
        </Card>
      </div>
    </PublicShell>
  );
}
