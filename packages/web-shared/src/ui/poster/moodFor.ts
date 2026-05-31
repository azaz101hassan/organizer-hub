import { MOODS, type Mood } from "./moods";

const MOOD_BY_INDEX: Mood[] = ["midnight", "plum", "forest", "sand", "oxblood", "ember", "teal"];

export function moodFor(event: { id: string }): Mood {
  let h = 0;
  for (let i = 0; i < event.id.length; i++) {
    h = (h * 31 + event.id.charCodeAt(i)) | 0;
  }
  return MOOD_BY_INDEX[Math.abs(h) % MOOD_BY_INDEX.length] as Mood;
}

// re-export Mood for consumers who only need this
export type { Mood };
// Provide MOODS too for direct consumers that need the palette
export { MOODS };
