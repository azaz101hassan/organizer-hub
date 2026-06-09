"use client";

import { useState } from "react";
import type { ThemeMode } from "@organizer-hub/web-shared/ui/theme";
import { Icon, type IconName } from "@organizer-hub/web-shared/ui";
import { BrandingTab } from "./BrandingTab";

type TabId = "organization" | "branding" | "team" | "billing";

interface TabDef {
  id: TabId;
  label: string;
  icon: IconName;
}

const TABS: TabDef[] = [
  { id: "organization", label: "Organization", icon: "building" },
  { id: "branding", label: "Branding", icon: "settings" },
  { id: "team", label: "Team", icon: "users" },
  { id: "billing", label: "Billing", icon: "card" },
];

function PlaceholderTab({ label }: { label: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        padding: "60px 24px",
        textAlign: "center",
        color: "var(--faint)",
      }}
    >
      <Icon name="dots" size={28} />
      <p style={{ fontSize: 14, margin: 0, fontWeight: 500 }}>
        {label} settings coming soon.
      </p>
      <p style={{ fontSize: 13, margin: 0, color: "var(--faint)" }}>
        This section is reserved for a future update.
      </p>
    </div>
  );
}

export function SettingsClient({ currentTheme }: { currentTheme: ThemeMode }) {
  const [active, setActive] = useState<TabId>("branding");

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "176px 1fr",
        gap: 20,
        alignItems: "start",
      }}
    >
      {/* Vertical tab rail */}
      <nav
        aria-label="Settings sections"
        style={{
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: "var(--radius-lg)",
          padding: "8px 6px",
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        {TABS.map((tab) => {
          const isActive = tab.id === active;
          return (
            <button
              key={tab.id}
              type="button"
              aria-pressed={isActive}
              onClick={() => setActive(tab.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                padding: "8px 12px",
                borderRadius: "var(--radius)",
                border: "none",
                background: isActive ? "var(--accent-soft)" : "transparent",
                color: isActive ? "var(--accent)" : "var(--faint)",
                fontSize: 13.5,
                fontWeight: isActive ? 600 : 500,
                fontFamily: "var(--font-body)",
                textAlign: "left",
                cursor: "pointer",
                transition: "background 0.14s ease, color 0.14s ease",
                width: "100%",
              }}
            >
              <Icon name={tab.icon} size={15} />
              {tab.label}
            </button>
          );
        })}
      </nav>

      {/* Tab content panel */}
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: "var(--radius-lg)",
          padding: "24px 28px",
          minHeight: 320,
        }}
      >
        {active === "organization" && (
          <PlaceholderTab label="Organization" />
        )}
        {active === "branding" && (
          <BrandingTab currentTheme={currentTheme} />
        )}
        {active === "team" && <PlaceholderTab label="Team" />}
        {active === "billing" && <PlaceholderTab label="Billing" />}
      </div>
    </div>
  );
}
