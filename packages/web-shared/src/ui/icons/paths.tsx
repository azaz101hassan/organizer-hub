import { type ReactElement } from "react";

export type IconName =
  | "calendar"
  | "pin"
  | "clock"
  | "arrowR"
  | "arrowL"
  | "ticket"
  | "users"
  | "building"
  | "plus"
  | "check"
  | "x"
  | "sparkle"
  | "bell"
  | "layers"
  | "grid"
  | "logout"
  | "chevR"
  | "chevD"
  | "star"
  | "crown"
  | "inbox"
  | "settings"
  | "moon"
  | "edit"
  | "eye";

const p = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export const ICON_PATHS: Record<IconName, ReactElement> = {
  calendar: (
    <g {...p}>
      <rect x="3" y="4.5" width="18" height="16" rx="2" />
      <path d="M3 9h18M8 2.5v4M16 2.5v4" />
    </g>
  ),
  pin: (
    <g {...p}>
      <path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </g>
  ),
  clock: (
    <g {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 1.8" />
    </g>
  ),
  arrowR: (
    <g {...p}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </g>
  ),
  arrowL: (
    <g {...p}>
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </g>
  ),
  ticket: (
    <g {...p}>
      <path d="M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2 2 2 0 0 0 0 4 2 2 0 0 1-2 2H5a2 2 0 0 1-2-2 2 2 0 0 0 0-4Z" />
      <path d="M14 7v10" strokeDasharray="1.5 2.5" />
    </g>
  ),
  users: (
    <g {...p}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19.5a5.5 5.5 0 0 1 11 0M16 5.2a3.2 3.2 0 0 1 0 5.6M17.5 19.5a5.5 5.5 0 0 0-2-4.2" />
    </g>
  ),
  building: (
    <g {...p}>
      <path d="M5 21V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v16M5 21h14M9 7h2M9 11h2M9 15h2" />
      <path d="M16 21V9h3a1 1 0 0 1 1 1v11" />
    </g>
  ),
  plus: (
    <g {...p}>
      <path d="M12 5v14M5 12h14" />
    </g>
  ),
  check: (
    <g {...p}>
      <path d="M5 12.5l4.5 4.5L19 6.5" />
    </g>
  ),
  x: (
    <g {...p}>
      <path d="M6 6l12 12M18 6 6 18" />
    </g>
  ),
  sparkle: (
    <g {...p}>
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" />
    </g>
  ),
  bell: (
    <g {...p}>
      <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </g>
  ),
  layers: (
    <g {...p}>
      <path d="M12 3 3 8l9 5 9-5-9-5Z" />
      <path d="M3 13l9 5 9-5M3 16.5l9 5 9-5" />
    </g>
  ),
  grid: (
    <g {...p}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </g>
  ),
  logout: (
    <g {...p}>
      <path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3M16 16l4-4-4-4M20 12H9" />
    </g>
  ),
  chevR: (
    <g {...p}>
      <path d="M9 6l6 6-6 6" />
    </g>
  ),
  chevD: (
    <g {...p}>
      <path d="M6 9l6 6 6-6" />
    </g>
  ),
  star: (
    <g {...p}>
      <path d="M12 3.5l2.6 5.7 6.2.6-4.7 4.1 1.4 6.1L12 16.9 6.5 20l1.4-6.1-4.7-4.1 6.2-.6L12 3.5Z" />
    </g>
  ),
  crown: (
    <g {...p}>
      <path d="M4 8l3.5 3L12 5l4.5 6L20 8l-1.5 10h-13L4 8Z" />
    </g>
  ),
  inbox: (
    <g {...p}>
      <path d="M4 13l2.5-7.5A2 2 0 0 1 8.4 4h7.2a2 2 0 0 1 1.9 1.5L20 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-5Z" />
      <path d="M4 13h5l1.5 2.5h3L15 13h5" />
    </g>
  ),
  settings: (
    <g {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.5 12a7.5 7.5 0 0 0-.1-1.3l1.9-1.4-1.8-3.1-2.2.9a7.6 7.6 0 0 0-2.3-1.3L14.5 2h-3.6l-.3 2.5a7.6 7.6 0 0 0-2.3 1.3L6.1 5l-1.8 3.1 1.9 1.4a7.6 7.6 0 0 0 0 2.6L4.3 13.5 6.1 16.6l2.2-.9a7.6 7.6 0 0 0 2.3 1.3l.3 2.5h3.6l.3-2.5a7.6 7.6 0 0 0 2.3-1.3l2.2.9 1.8-3.1-1.9-1.4c.06-.43.1-.86.1-1.3Z" />
    </g>
  ),
  moon: (
    <g {...p}>
      <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />
    </g>
  ),
  edit: (
    <g {...p}>
      <path d="M4 20h4l10.5-10.5a2 2 0 0 0 0-2.8l-1.2-1.2a2 2 0 0 0-2.8 0L4 16v4Z" />
    </g>
  ),
  eye: (
    <g {...p}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="2.8" />
    </g>
  ),
};
