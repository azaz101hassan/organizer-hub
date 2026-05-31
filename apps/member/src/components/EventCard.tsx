import Link from "next/link";
import { Card, Display } from "@organizer-hub/web-shared/ui";
import type { PublicEventView } from "@organizer-hub/web-shared";

export function EventCard({ event }: { event: PublicEventView }) {
  return (
    <Card padded>
      <Display as="h3" size="sm">
        {event.title}
      </Display>
      <Link href={`/events/${event.id}`} className="link">
        View →
      </Link>
    </Card>
  );
}
