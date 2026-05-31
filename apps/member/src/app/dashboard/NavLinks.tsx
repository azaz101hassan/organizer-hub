"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/dashboard", label: "Dashboard", exact: true },
  { href: "/events", label: "Browse events", exact: false },
  { href: "/dashboard/membership", label: "Membership", exact: false },
  { href: "/dashboard/requests", label: "My requests", exact: false },
];

export default function NavLinks() {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-4 text-xs">
      {NAV.map((item) => {
        const active = item.exact
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(`${item.href}/`);
        const cls = active
          ? "text-zinc-900 dark:text-zinc-50 font-medium"
          : "text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-50";
        return (
          <Link key={item.href} href={item.href} className={cls}>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
