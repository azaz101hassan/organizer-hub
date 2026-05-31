"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Icon, type IconName } from "../icons/Icon";

export function NavItem({
  href,
  icon,
  children,
  badge,
  exact = false,
}: {
  href: string;
  icon: IconName;
  children: ReactNode;
  badge?: ReactNode;
  exact?: boolean;
}) {
  const pathname = usePathname();
  const active = exact
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link href={href} className={`navitem${active ? " navitem--active" : ""}`}>
      <span className="navitem__icon">
        <Icon name={icon} size={17} />
      </span>
      <span
        style={{
          flex: 1,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {children}
      </span>
      {badge}
    </Link>
  );
}
