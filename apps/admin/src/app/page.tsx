import { redirect } from "next/navigation";
import {
  listPaymentEvents,
  UnauthorizedError,
  ApiError,
} from "@organizer-hub/web-shared";
import { Icon, BarChart } from "@organizer-hub/web-shared/ui";
import { PageHead } from "../components/PageHead";
import { KpiCard } from "../components/KpiCard";
import { Panel } from "../components/Panel";
import { FeedItem } from "../components/FeedItem";
import {
  feedFromPaymentEvents,
  monthlyRevenue,
} from "../lib/aggregate-payment-events";
import type {
  PaymentEventView,
  PaymentEventListPage,
} from "@organizer-hub/web-shared";

async function fetchEvents(): Promise<PaymentEventListPage> {
  try {
    return await listPaymentEvents({ limit: 100 });
  } catch (err) {
    if (err instanceof UnauthorizedError) throw err;
    if (err instanceof ApiError) {
      console.error("[dashboard] payment-events fetch failed:", err.message);
    } else {
      console.error("[dashboard] unexpected error:", err);
    }
    return { items: [], nextCursor: null };
  }
}

function money0(cents: number): string {
  return "$" + Math.round(cents / 100).toLocaleString();
}


const KIND_ICON: Record<string, "ticket" | "star" | "dollar" | "card"> = {
  TICKET: "ticket",
  MEMBERSHIP: "star",
  DONATION: "dollar",
  REFUND: "card",
  DISPUTE: "card",
};
const KIND_BG: Record<string, string> = {
  TICKET: "var(--accent-soft)",
  MEMBERSHIP: "var(--good-soft)",
  DONATION: "var(--warn-soft)",
  REFUND: "var(--bad-soft)",
  DISPUTE: "var(--bad-soft)",
};
const KIND_COLOR: Record<string, string> = {
  TICKET: "var(--accent)",
  MEMBERSHIP: "var(--good)",
  DONATION: "var(--warn)",
  REFUND: "var(--bad)",
  DISPUTE: "var(--bad)",
};

export default async function AdminDashboardPage() {
  let page: PaymentEventListPage;
  try {
    page = await fetchEvents();
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect("/auth/login");
    }
    throw err;
  }

  const events: PaymentEventView[] = page.items;
  const succeeded = events.filter((e) => e.status === "SUCCEEDED");

  // KPI aggregates
  const totalRevenueCents = succeeded.reduce(
    (sum, e) => sum + e.amountCents,
    0,
  );
  const ticketCount = succeeded.filter((e) => e.kind === "TICKET").length;
  const memberCount = succeeded.filter((e) => e.kind === "MEMBERSHIP").length;
  const refundCents = events
    .filter((e) => e.kind === "REFUND" && e.status === "SUCCEEDED")
    .reduce((sum, e) => sum + e.amountCents, 0);

  // Monthly revenue for chart (last 6 months)
  const revenueByMonth = monthlyRevenue(events, 6);

  // Sparklines: monthly counts per KPI
  const now = new Date();
  function monthlyCountFor(
    kind: PaymentEventView["kind"],
    lookback = 6,
  ): number[] {
    return Array.from({ length: lookback }, (_, i) => {
      const m = new Date(
        now.getFullYear(),
        now.getMonth() - (lookback - 1 - i),
        1,
      );
      return succeeded.filter((e) => {
        const d = new Date(e.succeededAt ?? e.createdAt);
        return (
          e.kind === kind &&
          d.getFullYear() === m.getFullYear() &&
          d.getMonth() === m.getMonth()
        );
      }).length;
    });
  }

  const ticketSparkline = monthlyCountFor("TICKET");
  const memberSparkline = monthlyCountFor("MEMBERSHIP");
  const revenueSparkline = revenueByMonth.map((b) => b.cents);

  const feed = feedFromPaymentEvents(events, 20);

  return (
    <>
      <PageHead
        crumb={
          <>
            <Icon name="home" size={13} /> OrganizerHub{" "}
            <Icon name="chevR" size={12} /> Dashboard
          </>
        }
        title="Dashboard"
        sub="Revenue, activity, and key metrics at a glance."
      />

      {/* KPI row */}
      <div className="grid-kpi" style={{ marginBottom: 20 }}>
        <KpiCard
          label="Total Revenue"
          value={money0(totalRevenueCents)}
          icon="dollar"
          sparkline={revenueSparkline}
          sparklineUp={true}
        />
        <KpiCard
          label="Tickets Sold"
          value={ticketCount.toLocaleString()}
          icon="ticket"
          sparkline={ticketSparkline}
          sparklineUp={
            ticketSparkline.length > 1
              ? ticketSparkline[ticketSparkline.length - 1] >= ticketSparkline[0]
              : true
          }
        />
        <KpiCard
          label="Memberships"
          value={memberCount.toLocaleString()}
          icon="users"
          sparkline={memberSparkline}
          sparklineUp={true}
        />
        <KpiCard
          label="Refunds"
          value={money0(refundCents)}
          icon="card"
          sparklineUp={false}
        />
      </div>

      {/* Main grid: chart + feed */}
      <div className="grid-main">
        <Panel title="Monthly Revenue">
          <BarChart data={revenueByMonth} valueKey="cents" />
        </Panel>

        <Panel title="Recent Activity">
          {feed.length === 0 ? (
            <p
              className="muted"
              style={{
                fontSize: 13.5,
                textAlign: "center",
                padding: "24px 0",
              }}
            >
              No activity yet.
            </p>
          ) : (
            <div className="feed">
              {feed.map((entry) => (
                <FeedItem
                  key={entry.id}
                  icon={
                    <Icon
                      name={KIND_ICON[entry.kind] ?? "dollar"}
                      size={15}
                    />
                  }
                  iconBg={KIND_BG[entry.kind] ?? "var(--accent-soft)"}
                  iconColor={KIND_COLOR[entry.kind] ?? "var(--accent)"}
                  who={entry.who}
                  what={entry.what}
                  when={entry.when}
                  amount={entry.amount}
                />
              ))}
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
