import Link from "next/link";
import {
  Card,
  Chip,
  Display,
  Eyebrow,
  Icon,
  Poster,
  monogram,
  moodFor,
} from "@organizer-hub/web-shared/ui";
import type { PublicEventView } from "@organizer-hub/web-shared";

function fmtShortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function EventCard({
  event,
  tall = false,
}: {
  event: PublicEventView;
  tall?: boolean;
}) {
  return (
    <Link href={`/events/${event.id}`} className="card-link">
      <Card
        padded={false}
        style={{
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          height: "100%",
        }}
      >
        <Poster
          mood={moodFor(event)}
          label={monogram(event.title)}
          monoSize={tall ? 220 : 150}
          style={{ height: tall ? 260 : 188, flexShrink: 0 }}
        >
          {event.label && (
            <div
              style={{
                position: "absolute",
                zIndex: 2,
                top: 14,
                left: 14,
                right: 14,
              }}
            >
              <Chip>{event.label.name}</Chip>
            </div>
          )}
        </Poster>
        <div
          style={{
            padding: "16px 18px 18px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
            flex: 1,
          }}
        >
          {event.organization && (
            <Eyebrow muted>{event.organization.name}</Eyebrow>
          )}
          <Display as="h3" size={tall ? "md" : "sm"}>
            {event.title}
          </Display>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              color: "var(--muted)",
              fontSize: 13.5,
              marginTop: "auto",
            }}
          >
            <Icon name="calendar" size={15} />
            <span>{fmtShortDate(event.startsAt)}</span>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              paddingTop: 4,
            }}
          >
            <span
              style={{
                color: "var(--accent)",
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              View <Icon name="arrowR" size={14} />
            </span>
          </div>
        </div>
      </Card>
    </Link>
  );
}
