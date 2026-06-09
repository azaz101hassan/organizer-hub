"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ThemeMode } from "./themeTypes";
import { setThemeCookie } from "./setThemeCookie";

const MODES: { value: ThemeMode; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

export function ThemeSwitcher({
  cookieName,
  current,
}: {
  cookieName: string;
  current: ThemeMode;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleSelect(mode: ThemeMode) {
    if (mode === current) return;
    // Flip the data-theme attribute immediately so the visual change is
    // instant without waiting for a server round-trip. "system" matches no
    // CSS rule intentionally — color-scheme: light dark then resolves from
    // the OS via light-dark() natively, with no matchMedia JS needed.
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-theme", mode);
    }
    startTransition(async () => {
      await setThemeCookie(cookieName, mode);
      // Refresh SSR tree so subsequent server renders pick up the new cookie.
      router.refresh();
    });
  }

  return (
    <div
      role="radiogroup"
      aria-label="Appearance"
      style={{ display: "flex", gap: 4, opacity: isPending ? 0.7 : 1 }}
    >
      {MODES.map((m) => {
        const active = m.value === current;
        return (
          <button
            key={m.value}
            role="radio"
            aria-checked={active}
            disabled={isPending}
            onClick={() => handleSelect(m.value)}
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
            {m.label}
          </button>
        );
      })}
    </div>
  );
}
