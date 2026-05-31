export type Mood = "midnight" | "plum" | "forest" | "sand" | "oxblood" | "ember" | "teal";

export const MOODS: Record<Mood, { p1: string; p2: string; ink: string }> = {
  midnight: { p1: "#171d3a", p2: "#39477a", ink: "#c4cdec" },
  plum: { p1: "#371d3b", p2: "#6c3a64", ink: "#eccce4" },
  forest: { p1: "#1a3a2d", p2: "#3f7053", ink: "#cfe5c6" },
  sand: { p1: "#54401f", p2: "#9c7c3d", ink: "#f3e4ba" },
  oxblood: { p1: "#42151b", p2: "#7e2c35", ink: "#f1cdc3" },
  ember: { p1: "#65271c", p2: "#b85a30", ink: "#f6dcae" },
  teal: { p1: "#103635", p2: "#2f6f6a", ink: "#bfe6e1" },
};

export function monogram(title: string): string {
  const words = title
    .replace(/[—–-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !/^(the|and|a|an|of|with)$/i.test(w));
  const first = words[0] ?? title;
  return (first[0] ?? "").toUpperCase();
}
