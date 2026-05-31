import Link from "next/link";
import type { PaymentEventView } from "@organizer-hub/web-shared";

interface ListParams {
  cursor?: string;
  kind?: string;
}

const KIND_LABEL: Record<string, string> = {
  TICKET: "Ticket",
  MEMBERSHIP: "Membership",
  DONATION: "Donation",
  REFUND: "Refund",
  DISPUTE: "Dispute",
};

function fmtAmount(cents: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function PaymentsList({
  items,
  nextCursor,
  params,
}: {
  items: PaymentEventView[];
  nextCursor: string | null;
  params: ListParams;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-700 px-6 py-10 text-center text-sm text-zinc-500">
        No payments yet.
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
    return `/dashboard/payments?${qs.toString()}`;
  })();
  return (
    <div>
      <ul className="divide-y divide-zinc-200 dark:divide-zinc-800 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
        {items.map((p) => (
          <li
            key={p.id}
            className="px-5 py-4 grid grid-cols-[110px_1fr_100px_120px] items-baseline gap-4"
          >
            <span className="text-xs text-zinc-500">{fmtDate(p.createdAt)}</span>
            <span className="text-sm text-zinc-700 dark:text-zinc-300">
              <span className="font-medium text-zinc-900 dark:text-zinc-50">
                {KIND_LABEL[p.kind] ?? p.kind}
              </span>
              {p.description ? (
                <span className="text-zinc-500"> — {p.description}</span>
              ) : null}
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
      ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
      : status === "PENDING"
        ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
        : status === "FAILED"
          ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"
          : status === "CANCELED"
            ? "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
            : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}
    >
      {status}
    </span>
  );
}
