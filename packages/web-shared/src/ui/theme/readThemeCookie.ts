import { cookies } from "next/headers";
import { type Theme, VALID_THEMES } from "./themeTypes";

export type { Theme } from "./themeTypes";

export async function readThemeCookie(
  name: string,
  fallback: Theme,
): Promise<Theme> {
  const store = await cookies();
  const raw = store.get(name)?.value;
  return raw && VALID_THEMES.has(raw) ? (raw as Theme) : fallback;
}
