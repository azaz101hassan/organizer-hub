import Link from "next/link";
import type { PaymentEventView } from "@organizer-hub/web-shared";

interface TableParams {
  cursor?: string;
  kind?: string;
  status?: string;
  userEmail?: string;
  from?: string;
  to?: string;
}

function fmtAmount(cents: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function TransactionsTable({
  items,
  nextCursor,
  params,
}: {
  items: PaymentEventView[];
  nextCursor: string | null;
  params: TableParams;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-700 p-8 text-center text-sm text-zinc-500">
        No transactions match the current filters.
      </div>
    );
  }

  const nextHref = (() => {
    if (!nextCursor) return null;
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v && k !== "cursor") qs.set(k, v);
    }
    qs.set("cursor", nextCursor);
    return `/transactions?${qs.toString()}`;
  })();

  return (
    <div>
      <div className="overflow-x-auto">
        <ul className="divide-y divide-zinc-200 dark:divide-zinc-800 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 min-w-[600px]">
          {items.map((p) => (
            <li
              key={p.id}
              className="px-5 py-4 grid grid-cols-[120px_1fr_90px_96px_110px] items-baseline gap-4"
            >
              <span className="text-xs text-zinc-400 dark:text-zinc-500 tabular-nums">
                {fmtDate(p.createdAt)}
              </span>
              <span className="text-sm text-zinc-700 dark:text-zinc-300 truncate min-w-0">
                {p.description ?? `${p.kind} ${p.stripePaymentIntentId ?? ""}`.trim()}
              </span>
              <span className="text-[10px] uppercase tracking-wide font-medium text-zinc-500 dark:text-zinc-400">
                {p.kind}
              </span>
              <StatusBadge status={p.status} />
              <span
                className={`text-sm text-right font-mono tabular-nums ${
                  p.amountCents < 0
                    ? "text-red-600 dark:text-red-400"
                    : "text-zinc-900 dark:text-zinc-50"
                }`}
              >
                {fmtAmount(p.amountCents, p.currency)}
              </span>
            </li>
          ))}
        </ul>
      </div>
      {nextHref && (
        <div className="mt-4">
          <Link
            href={nextHref}
            className="text-sm font-medium text-blue-600 hover:underline"
          >
            Next page →
          </Link>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "SUCCEEDED"
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
      : status === "PENDING"
        ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
        : status === "FAILED"
          ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"
          : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${cls}`}
    >
      {status}
    </span>
  );
}
