"use client";
import { ThemeSwitcher } from "@organizer-hub/web-shared/ui/theme";
import type { ThemeMode } from "@organizer-hub/web-shared/ui/theme";
import { Eyebrow, Display } from "@organizer-hub/web-shared/ui";

const PREVIEW: { mode: ThemeMode; label: string }[] = [
  { mode: "light", label: "Light" },
  { mode: "dark",  label: "Dark"  },
];

export function BrandingTab({ currentTheme }: { currentTheme: ThemeMode }) {
  return (
    <div>
      <Eyebrow>Branding</Eyebrow>
      <Display as="h2" size="md" style={{ margin: "8px 0 16px" }}>
        Appearance
      </Display>
      <p className="muted" style={{ fontSize: 14, marginBottom: 24 }}>
        Appearance follows the system by default. Choosing Light or Dark pins
        it per browser.
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: 12,
          marginBottom: 24,
        }}
      >
        {PREVIEW.map((p) => {
          // "system" mode selects neither card — neither is highlighted.
          const selected = currentTheme === p.mode;
          return (
            <div
              key={p.mode}
              style={{
                border: selected
                  ? "2px solid var(--accent)"
                  : "1px solid var(--line)",
                borderRadius: "var(--radius-lg)",
                overflow: "hidden",
              }}
            >
              {/*
               * Setting color-scheme on this subtree is what makes every
               * light-dark() token inside resolve to the correct mode value,
               * regardless of the user's active preference or OS setting.
               */}
              <div
                style={{
                  colorScheme: p.mode,
                  background: "var(--bg)",
                  borderBottom: "1px solid var(--line)",
                  height: 64,
                  padding: "10px 14px",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                }}
              >
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span
                    style={{
                      fontFamily: "var(--font-display)",
                      fontSize: 22,
                      fontWeight: 500,
                      color: "var(--ink)",
                      lineHeight: 1,
                    }}
                  >
                    Aa
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      color: "var(--muted)",
                      letterSpacing: "0.04em",
                    }}
                  >
                    Sample text
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span
                    style={{
                      background: "var(--accent)",
                      color: "var(--accent-on)",
                      borderRadius: "var(--btn-radius)",
                      fontSize: 10,
                      fontWeight: 600,
                      padding: "2px 8px",
                      letterSpacing: "0.03em",
                    }}
                  >
                    Accent
                  </span>
                  <div
                    style={{
                      flex: 1,
                      height: 2,
                      borderRadius: 1,
                      background: "var(--line-strong)",
                    }}
                  />
                </div>
              </div>
              <div style={{ padding: "8px 12px", fontSize: 12, fontWeight: 600 }}>
                {p.label}
              </div>
            </div>
          );
        })}
      </div>
      <ThemeSwitcher cookieName="oh_admin_theme" current={currentTheme} />
    </div>
  );
}
