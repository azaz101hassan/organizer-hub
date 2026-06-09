"use server";

import { cookies } from "next/headers";
import { type ThemeMode, VALID_MODES } from "./themeTypes";

export async function setThemeCookie(
  cookieName: string,
  mode: ThemeMode,
): Promise<void> {
  if (!VALID_MODES.has(mode)) return;
  const store = await cookies();
  store.set(cookieName, mode, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // 1 year
    sameSite: "lax",
    httpOnly: false, // must be readable by client for `router.refresh()` flow
    secure: process.env.NODE_ENV === "production",
  });
}
