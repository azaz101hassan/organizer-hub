import Link from "next/link";
import { Icon, NavItem } from "@organizer-hub/web-shared/ui";
import { ThemeSwitcher } from "@organizer-hub/web-shared/ui/theme";
import type { SessionIdentity } from "@organizer-hub/web-shared";
import type { ThemeMode } from "@organizer-hub/web-shared/ui/theme";

export function DashSidebar({
  session,
  currentTheme,
}: {
  session: SessionIdentity;
  currentTheme: ThemeMode;
}) {
  const displayName = session.name ?? session.email ?? session.sub ?? "";
  const initials =
    displayName
      .split(" ")
      .map((w) => w[0] ?? "")
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?";

  return (
    <aside className="dash__side">
      <Link
        href="/"
        className="brand"
        style={{ marginBottom: 22, paddingLeft: 6 }}
      >
        <span className="brand__mark" aria-hidden="true">
          O
        </span>
        <span className="brand__name" style={{ fontSize: 17 }}>
          OrganizerHub
        </span>
      </Link>

      <NavItem href="/dashboard" icon="grid" exact>
        Overview
      </NavItem>
      <NavItem href="/dashboard/membership" icon="crown">
        My membership
      </NavItem>
      <NavItem href="/dashboard/donations" icon="dollar">
        Donations
      </NavItem>
      <NavItem href="/dashboard/requests" icon="ticket">
        My requests
      </NavItem>
      <NavItem href="/dashboard/payments" icon="layers">
        Payments
      </NavItem>

      {/* Theme switcher section */}
      <div
        style={{
          marginTop: 16,
          paddingTop: 14,
          borderTop: "1px solid var(--line)",
        }}
      >
        <p
          className="eyebrow eyebrow--muted"
          style={{ paddingLeft: 6, marginBottom: 8 }}
        >
          Appearance
        </p>
        <ThemeSwitcher cookieName="oh_member_theme" current={currentTheme} />
      </div>

      <div
        style={{
          marginTop: "auto",
          paddingTop: 16,
          borderTop: "1px solid var(--line)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 11,
            padding: "8px 6px",
          }}
        >
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 999,
              background: "var(--accent)",
              color: "var(--accent-on)",
              display: "grid",
              placeItems: "center",
              fontWeight: 700,
              fontSize: 14,
              flexShrink: 0,
            }}
          >
            {initials}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {session.name ?? session.email}
            </div>
            <div
              className="faint"
              style={{
                fontSize: 11.5,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {session.email}
            </div>
          </div>
          <Link
            href="/auth/logout"
            aria-label="Sign out"
            style={{
              color: "var(--faint)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 44,
              height: 44,
              borderRadius: "var(--radius-sm)",
              flexShrink: 0,
            }}
          >
            <Icon name="logout" size={16} />
          </Link>
        </div>
      </div>
    </aside>
  );
}
