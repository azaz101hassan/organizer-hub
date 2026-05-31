import { Poster, monogram, moodFor } from "@organizer-hub/web-shared/ui";

type EventLite = { id: string; title: string };

export function Thumb({ event, size = 38 }: { event: EventLite; size?: number }) {
  return (
    <span
      className="cellthumb"
      style={{ width: size, height: size, display: "inline-block" }}
    >
      <Poster
        mood={moodFor(event)}
        label={monogram(event.title)}
        monoSize={size * 0.9}
        style={{ height: size }}
      />
    </span>
  );
}
