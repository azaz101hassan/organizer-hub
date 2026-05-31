"use client";

import Link from "next/link";
import type { SessionIdentity } from "@organizer-hub/web-shared";
import {
  Icon,
  DropdownMenu,
  DropdownTrigger,
  DropdownContent,
} from "@organizer-hub/web-shared/ui";

function initials(name?: string, email?: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return parts[0][0].toUpperCase();
  }
  if (email) return email[0].toUpperCase();
  return "A";
}

export function TopBar({ session }: { session: SessionIdentity }) {
  return (
    <header className="ad__top">
      {/* Search */}
      <div className="ad__search">
        <Icon name="search" size={15} />
        <input
          type="search"
          placeholder="Search events, members, orders…"
          aria-label="Search"
        />
        <kbd>⌘K</kbd>
      </div>

      <div className="ad__spacer" />

      {/* Refresh */}
      <button
        type="button"
        className="ad__iconbtn"
        aria-label="Refresh"
        onClick={() => window.location.reload()}
      >
        <Icon name="refresh" size={17} />
      </button>

      {/* Notifications */}
      <DropdownMenu>
        <DropdownTrigger>
          <button
            type="button"
            className="ad__iconbtn"
            aria-label="Notifications"
          >
            <Icon name="bell" size={17} />
            <span className="ad__iconbtn-dot" aria-hidden="true" />
          </button>
        </DropdownTrigger>
        <DropdownContent className="ad__notifs">
          <div className="ad__menu-item" style={{ fontWeight: 700, fontSize: 13, borderBottom: "1px solid var(--line)", paddingBottom: 11 }}>
            Notifications
          </div>
          <div className="ad__notif">
            <div className="ad__notif-ic">
              <Icon name="ticket" size={15} />
            </div>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 500 }}>New ticket request</div>
              <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 3 }}>Just now</div>
            </div>
          </div>
          <div className="ad__notif">
            <div className="ad__notif-ic">
              <Icon name="users" size={15} />
            </div>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 500 }}>New member joined</div>
              <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 3 }}>5 min ago</div>
            </div>
          </div>
        </DropdownContent>
      </DropdownMenu>

      <div className="ad__topdiv" aria-hidden="true" />

      {/* User menu */}
      <DropdownMenu>
        <DropdownTrigger>
          <div className="ad__user" role="button" tabIndex={0} aria-label="User menu">
            <div className="ad__avatar" aria-hidden="true">
              {initials(session.name, session.email)}
            </div>
            <div className="ad__user-meta">
              <div className="ad__user-name">{session.name ?? session.email ?? "Admin"}</div>
              <div className="ad__user-role">Administrator</div>
            </div>
            <Icon name="chevD" size={14} />
          </div>
        </DropdownTrigger>
        <DropdownContent>
          <div
            className="ad__menu-item"
            style={{ borderBottom: "1px solid var(--line)", paddingBottom: 11, flexDirection: "column", alignItems: "flex-start", gap: 2 }}
          >
            <div style={{ fontWeight: 600, fontSize: 13.5 }}>{session.name ?? "Admin"}</div>
            <div style={{ fontSize: 12, color: "var(--faint)" }}>{session.email}</div>
          </div>
          <Link href="/settings" className="ad__menu-item">
            <span className="navitem__icon">
              <Icon name="settings" size={17} />
            </span>
            Settings
          </Link>
          <div style={{ height: 1, background: "var(--line)", margin: "4px 0" }} />
          <Link
            href="/auth/logout"
            className="ad__menu-item"
            style={{ color: "var(--bad)" }}
          >
            <span className="navitem__icon" style={{ color: "var(--bad)" }}>
              <Icon name="logout" size={17} />
            </span>
            Sign out
          </Link>
        </DropdownContent>
      </DropdownMenu>
    </header>
  );
}
