"use client";
import Link from "next/link";

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
    <div className="mb-6 space-y-3">
      <div className="flex flex-wrap gap-2">
        <Chip href={hrefWith("kind", undefined)} active={!params.kind}>
          All kinds
        </Chip>
        {KINDS.map((k) => (
          <Chip key={k} href={hrefWith("kind", k)} active={params.kind === k}>
            {k}
          </Chip>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Chip href={hrefWith("status", undefined)} active={!params.status}>
          All statuses
        </Chip>
        {STATUSES.map((s) => (
          <Chip
            key={s}
            href={hrefWith("status", s)}
            active={params.status === s}
          >
            {s}
          </Chip>
        ))}
      </div>
      <a
        href={csvHref}
        download
        className="inline-block text-xs font-medium text-blue-600 hover:underline"
      >
        Export CSV →
      </a>
    </div>
  );
}

function Chip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
        active
          ? "bg-zinc-900 text-white border-zinc-900 dark:bg-zinc-50 dark:text-zinc-900 dark:border-zinc-50"
          : "bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-200 dark:border-zinc-800 dark:hover:bg-zinc-800"
      }`}
    >
      {children}
    </Link>
  );
}
