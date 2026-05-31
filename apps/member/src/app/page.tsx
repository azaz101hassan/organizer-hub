import Link from "next/link";
import { publicApiFetch } from "@organizer-hub/web-shared";
import type { PublicEventView } from "@organizer-hub/web-shared";
import { Button, Display, Eyebrow, Icon, Lede, Poster } from "@organizer-hub/web-shared/ui";
import { PublicShell } from "../components/PublicShell";
import { EventCard } from "../components/EventCard";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  // Featured events: first three published events; tolerate fetch errors.
  let featured: PublicEventView[] = [];
  try {
    const page = await publicApiFetch<{ items: PublicEventView[] }>(
      "/public/events?limit=3",
    );
    featured = page.items.slice(0, 3);
  } catch (err) {
    console.error("[HomePage] featured fetch failed:", err);
    featured = [];
  }

  return (
    <PublicShell>
      <header
        className="container container--wide"
        style={{ paddingTop: 64, paddingBottom: 64 }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.05fr .95fr",
            gap: 48,
            alignItems: "center",
          }}
        >
          <div
            className="fade-in"
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
            }}
          >
            <Eyebrow>Members · Events · Evenings of note</Eyebrow>
            <Display
              as="h1"
              style={{
                fontSize: "clamp(40px, 4.6vw, 58px)",
                lineHeight: 1.04,
                margin: "18px 0 20px",
              }}
            >
              The evenings worth keeping a seat for.
            </Display>
            <Lede style={{ maxWidth: 460 }}>
              One pane of glass for the societies, clubs, and collectives behind
              the calendar — and a membership that opens the door to all of
              them.
            </Lede>
            <div style={{ display: "flex", gap: 12, marginTop: 30 }}>
              <Link href="/events">
                <Button size="lg">
                  Browse events <Icon name="arrowR" size={16} />
                </Button>
              </Link>
              <Link href="/membership">
                <Button size="lg" variant="ghost">
                  Become a member
                </Button>
              </Link>
            </div>
          </div>
          <Poster
            mood="oxblood"
            label="O"
            monoSize={460}
            className="fade-in"
            style={{ height: 520, borderRadius: "var(--radius-lg)" }}
          >
            <div
              style={{
                position: "absolute",
                zIndex: 2,
                inset: 0,
                display: "flex",
                flexDirection: "column",
                justifyContent: "flex-end",
                padding: 30,
              }}
            >
              <Display as="h3" style={{ color: "#fff", fontSize: 34 }}>
                OrganizerHub
              </Display>
              <p
                style={{
                  color: "rgba(255,255,255,.8)",
                  fontSize: 14,
                  marginTop: 6,
                }}
              >
                Membership that opens every door.
              </p>
            </div>
          </Poster>
        </div>
      </header>

      {featured.length > 0 && (
        <section
          className="container container--wide"
          style={{ paddingBottom: 72 }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              marginBottom: 22,
            }}
          >
            <Display as="h2" size="md">
              On the calendar
            </Display>
            <Link href="/events" className="link">
              All events →
            </Link>
          </div>
          <div className="grid-3-narrow">
            {featured.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        </section>
      )}
    </PublicShell>
  );
}
