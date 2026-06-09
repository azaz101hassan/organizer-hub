import { cookies } from "next/headers";
import { type ThemeMode, VALID_MODES } from "./themeTypes";

export type { ThemeMode } from "./themeTypes";

export async function readThemeCookie(
  name: string,
  fallback: ThemeMode,
): Promise<ThemeMode> {
  const store = await cookies();
  const raw = store.get(name)?.value;
  // Legacy values ("atrium", "noir", "vellum") are not in VALID_MODES and
  // fall through to the fallback.
  return raw && VALID_MODES.has(raw) ? (raw as ThemeMode) : fallback;
}
