import type { IconName } from "@organizer-hub/web-shared/ui";

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export interface NavItem {
  label: string;
  href: string;
  icon: IconName;
  exact?: boolean;
}

export const ADMIN_NAV: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { label: "Dashboard", href: "/", icon: "home", exact: true },
      { label: "Analytics", href: "/analytics", icon: "pie" },
    ],
  },
  {
    label: "Manage",
    items: [
      { label: "Events", href: "/events", icon: "cal2" },
      { label: "Labels", href: "/labels", icon: "tag" },
      { label: "Coalitions", href: "/coalitions", icon: "layers" },
      { label: "Members", href: "/members", icon: "users" },
      { label: "Waitlist", href: "/waitlist", icon: "inbox" },
    ],
  },
  {
    label: "Finance",
    items: [
      { label: "Transactions", href: "/transactions", icon: "dollar" },
    ],
  },
  {
    label: "System",
    items: [
      { label: "Settings", href: "/settings", icon: "settings" },
    ],
  },
];
