"use client";
import Link from "next/link";
import { Toolbar } from "@organizer-hub/web-shared/ui";

const STATUS_FILTER = [
  { label: "All", value: "all" },
  { label: "Active", value: "ACTIVE" },
  { label: "Archived", value: "ARCHIVED" },
] as const;

interface Params {
  status?: string;
  q?: string;
}

export default function Filters({ params }: { params: Params }) {
  function hrefWith(key: keyof Params, value: string | undefined) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v && k !== key) qs.set(k, v);
    }
    if (value) qs.set(key, value);
    const str = qs.toString();
    return `/coalitions${str ? `?${str}` : ""}`;
  }

  const activeStatus = params.status ?? "all";

  return (
    <div style={{ marginBottom: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      <Toolbar>
        {STATUS_FILTER.map(({ label, value }) => (
          <FilterChip
            key={value}
            href={hrefWith("status", value === "all" ? undefined : value)}
            active={activeStatus === value}
          >
            {label}
          </FilterChip>
        ))}
      </Toolbar>

      <form method="get" action="/coalitions" style={{ display: "flex", gap: 8 }}>
        {params.status && (
          <input type="hidden" name="status" value={params.status} />
        )}
        <input
          type="search"
          name="q"
          placeholder="Search by name…"
          defaultValue={params.q ?? ""}
          style={{
            height: 34,
            borderRadius: 8,
            border: "1px solid var(--border, #d1d5db)",
            background: "var(--surface, #fff)",
            padding: "0 10px",
            fontSize: 13.5,
            width: 220,
            color: "var(--ink)",
          }}
        />
        <button
          type="submit"
          className="btn btn--ghost btn--sm"
          style={{ height: 34 }}
        >
          Search
        </button>
        {params.q && (
          <Link
            href={hrefWith("q", undefined)}
            className="btn btn--ghost btn--sm"
            style={{ height: 34 }}
          >
            Clear
          </Link>
        )}
      </form>
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
