"use client";
import Link from "next/link";
import { Toolbar } from "@organizer-hub/web-shared/ui";

const KINDS = [
  "TICKET",
  "MEMBERSHIP",
  "DONATION",
  "REFUND",
  "DISPUTE",
] as const;
const STATUSES = ["PENDING", "SUCCEEDED", "FAILED", "CANCELED"] as const;

interface FilterParams {
  cursor?: string;
  kind?: string;
  status?: string;
  userEmail?: string;
  from?: string;
  to?: string;
}

export default function Filters({
  params,
  orgId,
}: {
  params: FilterParams;
  orgId: string;
}) {
  function hrefWith(key: keyof FilterParams, value: string | undefined) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v && k !== key && k !== "cursor") qs.set(k, v);
    }
    if (value) qs.set(key, value);
    const str = qs.toString();
    return `/transactions${str ? `?${str}` : ""}`;
  }

  const csvHref = (() => {
    const qs = new URLSearchParams({ organizationId: orgId });
    for (const [k, v] of Object.entries(params)) {
      if (v && k !== "cursor") qs.set(k, v);
    }
    return `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}/transactions.csv?${qs.toString()}`;
  })();

  return (
    <div style={{ marginBottom: 20, display: "flex", flexDirection: "column", gap: 10 }}>
      <Toolbar>
        <FilterChip href={hrefWith("kind", undefined)} active={!params.kind}>
          All kinds
        </FilterChip>
        {KINDS.map((k) => (
          <FilterChip key={k} href={hrefWith("kind", k)} active={params.kind === k}>
            {k}
          </FilterChip>
        ))}
      </Toolbar>
      <Toolbar>
        <FilterChip href={hrefWith("status", undefined)} active={!params.status}>
          All statuses
        </FilterChip>
        {STATUSES.map((s) => (
          <FilterChip key={s} href={hrefWith("status", s)} active={params.status === s}>
            {s}
          </FilterChip>
        ))}
      </Toolbar>
      <a
        href={csvHref}
        download
        className="link"
        style={{ fontSize: 12.5, alignSelf: "flex-start" }}
      >
        Export CSV →
      </a>
    </div>
  );
}

function FilterChip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className={active ? "chip chip--active" : "chip"}>
      {children}
    </Link>
  );
}
