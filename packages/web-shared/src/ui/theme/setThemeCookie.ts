"use server";

import { cookies } from "next/headers";
import { type Theme, VALID_THEMES } from "./themeTypes";

export async function setThemeCookie(
  cookieName: string,
  theme: Theme,
): Promise<void> {
  if (!VALID_THEMES.has(theme)) return;
  const store = await cookies();
  store.set(cookieName, theme, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // 1 year
    sameSite: "lax",
    httpOnly: false, // must be readable by client for `router.refresh()` flow
    secure: process.env.NODE_ENV === "production",
  });
}
