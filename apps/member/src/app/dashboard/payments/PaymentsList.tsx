import Link from "next/link";
import type { PaymentEventView } from "@organizer-hub/web-shared";
import { Pill } from "@organizer-hub/web-shared/ui";
import type { PillTone } from "@organizer-hub/web-shared/ui";

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

// Map payment status to Pill tone
function statusTone(status: string): PillTone {
  switch (status) {
    case "SUCCEEDED":
      return "paid";
    case "PENDING":
      return "pending";
    case "FAILED":
      return "refunded";
    case "CANCELED":
      return "lapsed";
    case "REFUNDED":
      return "refunded";
    default:
      return "lapsed";
  }
}

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
      <div
        style={{
          borderRadius: "var(--radius-lg)",
          border: "1px dashed var(--line-strong)",
          padding: "40px 32px",
          textAlign: "center",
        }}
      >
        <p className="muted" style={{ fontSize: 14, margin: "0 0 6px" }}>No payments yet.</p>
        <p className="faint" style={{ fontSize: 13, margin: "0 0 14px" }}>
          Charges appear here after you subscribe or make a donation.
        </p>
        <Link href="/membership" className="link" style={{ fontSize: 13 }}>
          Browse plans
        </Link>
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
      <ul
        style={{
          margin: 0,
          padding: 0,
          listStyle: "none",
          borderRadius: "var(--radius-lg)",
          border: "1px solid var(--line)",
          background: "var(--surface)",
          overflow: "hidden",
        }}
      >
        {items.map((p, i) => (
          <li
            key={p.id}
            style={{
              display: "grid",
              gridTemplateColumns: "110px 1fr auto auto",
              alignItems: "center",
              gap: 16,
              padding: "13px 20px",
              borderTop: i > 0 ? "1px solid var(--line)" : undefined,
            }}
          >
            <span className="faint" style={{ fontSize: 12 }}>{fmtDate(p.createdAt)}</span>
            <span style={{ fontSize: 13.5, minWidth: 0 }}>
              <span style={{ fontWeight: 600 }}>
                {KIND_LABEL[p.kind] ?? p.kind}
              </span>
              {p.description ? (
                <span className="muted">, {p.description}</span>
              ) : null}
            </span>
            <Pill tone={statusTone(p.status)}>
              {p.status.charAt(0) + p.status.slice(1).toLowerCase()}
            </Pill>
            <span
              className="mono"
              style={{
                fontSize: 13.5,
                textAlign: "right",
                color: p.amountCents < 0 ? "var(--bad)" : "var(--ink)",
                whiteSpace: "nowrap",
              }}
            >
              {fmtAmount(p.amountCents, p.currency)}
            </span>
          </li>
        ))}
      </ul>
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
