import type { PaymentEventView } from "@organizer-hub/web-shared";

/** Returns the first 8 chars of a user ID as a display handle. */
export function shortUserId(id: string): string {
  return id.slice(0, 8);
}

export interface FeedEntry {
  id: string;
  who: string;
  what: string;
  when: string;
  amount: string;
  kind: PaymentEventView["kind"];
  status: PaymentEventView["status"];
}

const KIND_VERB: Record<PaymentEventView["kind"], string> = {
  TICKET: "bought a ticket",
  MEMBERSHIP: "purchased a membership",
  DONATION: "made a donation",
  REFUND: "received a refund",
  DISPUTE: "filed a dispute",
};

function fmt0(cents: number): string {
  return "$" + Math.round(cents / 100).toLocaleString();
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/** Build a flat activity feed from payment events (most recent first). */
export function feedFromPaymentEvents(
  events: PaymentEventView[],
  limit = 20,
): FeedEntry[] {
  return events
    .filter((e) => e.status === "SUCCEEDED")
    .sort(
      (a, b) =>
        new Date(b.succeededAt ?? b.createdAt).getTime() -
        new Date(a.succeededAt ?? a.createdAt).getTime(),
    )
    .slice(0, limit)
    .map((e) => ({
      id: e.id,
      who: shortUserId(e.userId),
      what: KIND_VERB[e.kind] ?? e.kind.toLowerCase(),
      when: relativeTime(e.succeededAt ?? e.createdAt),
      amount: fmt0(e.amountCents),
      kind: e.kind,
      status: e.status,
    }));
}

export interface MonthBucket {
  month: string;
  cents: number;
  [key: string]: number | string;
}

/**
 * Aggregate succeeded payment events into monthly revenue buckets.
 * Uses local time for month labelling (acceptable for v1 admin chart;
 * a future enhancement can switch to UTC or org TZ).
 */
export function monthlyRevenue(
  events: PaymentEventView[],
  months = 6,
): MonthBucket[] {
  const buckets: Record<string, number> = {};

  // Pre-populate the last N months so empty months still appear
  const now = new Date();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = d.toLocaleDateString("en-US", { month: "short" });
    buckets[key] = 0;
  }

  for (const e of events) {
    if (e.status !== "SUCCEEDED") continue;
    const d = new Date(e.succeededAt ?? e.createdAt);
    // Only include events within the look-back window
    const ageMonths =
      (now.getFullYear() - d.getFullYear()) * 12 +
      (now.getMonth() - d.getMonth());
    if (ageMonths < 0 || ageMonths >= months) continue;
    const key = d.toLocaleDateString("en-US", { month: "short" });
    buckets[key] = (buckets[key] ?? 0) + e.amountCents;
  }

  return Object.entries(buckets).map(([month, cents]) => ({ month, cents }));
}
