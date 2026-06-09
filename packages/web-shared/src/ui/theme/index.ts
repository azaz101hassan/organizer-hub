// Client-safe theme exports. The server-only `readThemeCookie` (which imports
// `next/headers`) lives at `@organizer-hub/web-shared/ui/theme/server` so it
// is never pulled into a client bundle through this barrel.
export type { ThemeMode, Theme } from "./themeTypes";
export { setThemeCookie } from "./setThemeCookie";
export { ThemeSwitcher } from "./ThemeSwitcher";
