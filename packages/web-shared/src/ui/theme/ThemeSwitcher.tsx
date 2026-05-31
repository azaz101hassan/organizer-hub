"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Theme } from "./readThemeCookie";
import { setThemeCookie } from "./setThemeCookie";

const THEMES: { value: Theme; label: string }[] = [
  { value: "atrium", label: "Atrium" },
  { value: "noir", label: "Noir" },
  { value: "vellum", label: "Vellum" },
];

export function ThemeSwitcher({
  cookieName,
  current,
}: {
  cookieName: string;
  current: Theme;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleSelect(theme: Theme) {
    if (theme === current) return;
    // Flip the data-theme attribute immediately so the visual change is instant
    // without waiting for a server round-trip.
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-theme", theme);
    }
    startTransition(async () => {
      await setThemeCookie(cookieName, theme);
      // Refresh SSR tree so subsequent server renders pick up the new cookie.
      router.refresh();
    });
  }

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      style={{ display: "flex", gap: 4, opacity: isPending ? 0.7 : 1 }}
    >
      {THEMES.map((t) => {
        const active = t.value === current;
        return (
          <button
            key={t.value}
            role="radio"
            aria-checked={active}
            disabled={isPending}
            onClick={() => handleSelect(t.value)}
            style={{
              flex: 1,
              padding: "5px 0",
              fontSize: 11.5,
              fontWeight: active ? 700 : 500,
              fontFamily: "var(--font-body)",
              background: active ? "var(--accent-soft)" : "transparent",
              color: active ? "var(--accent)" : "var(--faint)",
              border: `1px solid ${active ? "var(--accent-soft)" : "transparent"}`,
              borderRadius: "var(--btn-radius)",
              cursor: "pointer",
              transition: "background .15s ease, color .15s ease",
              letterSpacing: "0.02em",
              whiteSpace: "nowrap",
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
