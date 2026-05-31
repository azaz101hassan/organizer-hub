import Link from "next/link";
import { DataTable, type Column, Pill, type PillTone } from "@organizer-hub/web-shared/ui";
import type { PaymentEventView, PaymentEventStatus } from "@organizer-hub/web-shared";

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

const STATUS_PILL: Record<PaymentEventStatus, PillTone | null> = {
  SUCCEEDED: "paid",
  PENDING: "pending",
  FAILED: null,
  CANCELED: "lapsed",
};

function PaymentStatusPill({ status }: { status: PaymentEventStatus }) {
  const tone = STATUS_PILL[status];
  if (tone) {
    return <Pill tone={tone}>{status.charAt(0) + status.slice(1).toLowerCase()}</Pill>;
  }
  // FAILED — use bad tokens directly
  return (
    <span
      className="pill"
      style={{ background: "var(--bad-soft)", color: "var(--bad)" }}
    >
      Failed
    </span>
  );
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
  const nextHref = (() => {
    if (!nextCursor) return null;
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v && k !== "cursor") qs.set(k, v);
    }
    qs.set("cursor", nextCursor);
    return `/transactions?${qs.toString()}`;
  })();

  const columns: Column<PaymentEventView>[] = [
    {
      key: "date",
      header: "Date",
      width: 164,
      cell: (p) => (
        <span className="mono faint" style={{ fontSize: 12 }}>
          {fmtDate(p.createdAt)}
        </span>
      ),
    },
    {
      key: "description",
      header: "Description",
      cell: (p) => (
        <span style={{ fontSize: 13.5, color: "var(--ink)" }}>
          {p.description ?? `${p.kind} ${p.stripePaymentIntentId ?? ""}`.trim()}
        </span>
      ),
    },
    {
      key: "kind",
      header: "Kind",
      width: 100,
      cell: (p) => (
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--faint)",
          }}
        >
          {p.kind}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      width: 110,
      cell: (p) => <PaymentStatusPill status={p.status} />,
    },
    {
      key: "amount",
      header: "Amount",
      numeric: true,
      width: 120,
      cell: (p) => (
        <span
          className="mono"
          style={{
            fontSize: 13.5,
            color: p.amountCents < 0 ? "var(--bad)" : "var(--ink)",
          }}
        >
          {fmtAmount(p.amountCents, p.currency)}
        </span>
      ),
    },
  ];

  return (
    <div>
      <DataTable
        columns={columns}
        rows={items}
        empty="No transactions match the current filters."
      />
      {nextHref && (
        <div style={{ marginTop: 16 }}>
          <Link href={nextHref} className="link" style={{ fontSize: 13.5 }}>
            Next page →
          </Link>
        </div>
      )}
    </div>
  );
}
