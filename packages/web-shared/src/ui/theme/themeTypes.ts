export type ThemeMode = "light" | "dark" | "system";

export const VALID_MODES: ReadonlySet<string> = new Set<ThemeMode>([
  "light",
  "dark",
  "system",
]);

/** @deprecated Use ThemeMode */
export type Theme = ThemeMode;
