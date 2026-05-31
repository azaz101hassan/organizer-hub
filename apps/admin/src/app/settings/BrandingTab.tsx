"use client";
import { ThemeSwitcher } from "@organizer-hub/web-shared/ui/theme";
import type { Theme } from "@organizer-hub/web-shared/ui/theme";
import { Poster, Eyebrow, Display } from "@organizer-hub/web-shared/ui";

const PREVIEW: {
  theme: Theme;
  mood: "sand" | "midnight" | "forest";
  label: string;
  mark: string;
}[] = [
  { theme: "atrium", mood: "sand", label: "Atrium", mark: "A" },
  { theme: "noir", mood: "midnight", label: "Noir", mark: "N" },
  { theme: "vellum", mood: "forest", label: "Vellum", mark: "V" },
];

export function BrandingTab({ currentTheme }: { currentTheme: Theme }) {
  return (
    <div>
      <Eyebrow>Theme</Eyebrow>
      <Display as="h2" size="md" style={{ margin: "8px 0 16px" }}>
        Branding
      </Display>
      <p className="muted" style={{ fontSize: 14, marginBottom: 24 }}>
        Choose how the admin app presents itself. Theme persists per browser.
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 12,
          marginBottom: 24,
        }}
      >
        {PREVIEW.map((p) => (
          <div
            key={p.theme}
            style={{
              border:
                currentTheme === p.theme
                  ? "2px solid var(--accent)"
                  : "1px solid var(--line)",
              borderRadius: "var(--radius-lg)",
              overflow: "hidden",
            }}
          >
            <Poster mood={p.mood} label={p.mark} monoSize={64} style={{ height: 56 }} />
            <div style={{ padding: "8px 12px", fontSize: 12, fontWeight: 600 }}>
              {p.label}
            </div>
          </div>
        ))}
      </div>
      <ThemeSwitcher cookieName="oh_admin_theme" current={currentTheme} />
    </div>
  );
}
