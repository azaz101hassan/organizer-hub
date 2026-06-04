export type Theme = "atrium" | "noir" | "vellum";

export const VALID_THEMES: ReadonlySet<string> = new Set<Theme>([
  "atrium",
  "noir",
  "vellum",
]);
