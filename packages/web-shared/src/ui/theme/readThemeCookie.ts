// packages/web-shared/src/ui/theme/readThemeCookie.ts
import { cookies } from "next/headers";

export type Theme = "atrium" | "noir" | "vellum";
const VALID: ReadonlySet<string> = new Set<Theme>(["atrium", "noir", "vellum"]);

export async function readThemeCookie(
  name: string,
  fallback: Theme,
): Promise<Theme> {
  const store = await cookies();
  const raw = store.get(name)?.value;
  return raw && VALID.has(raw) ? (raw as Theme) : fallback;
}
