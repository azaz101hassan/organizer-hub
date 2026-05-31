import { redirect } from "next/navigation";
import {
  ApiError,
  listPaymentEvents,
  UnauthorizedError,
} from "@organizer-hub/web-shared";
import type {
  PaymentEventView,
  PaymentEventListPage,
} from "@organizer-hub/web-shared";
import { BarChart, Donut, Icon } from "@organizer-hub/web-shared/ui";
import { PageHead } from "../../components/PageHead";
import { Panel } from "../../components/Panel";
import { monthlyRevenue } from "../../lib/aggregate-payment-events";

export const dynamic = "force-dynamic";

function money0(cents: number) {
  return "$" + Math.round(cents / 100).toLocaleString();
}

async function fetchEvents(): Promise<PaymentEventListPage> {
  try {
    return await listPaymentEvents({ limit: 500 });
  } catch (err) {
    if (err instanceof UnauthorizedError) throw err;
    if (err instanceof ApiError) {
      console.error("[analytics] payment-events fetch failed:", err.message);
    } else {
      console.error("[analytics] unexpected error:", err);
    }
    return { items: [], nextCursor: null };
  }
}

export default async function AnalyticsPage() {
  let page: PaymentEventListPage;
  try {
    page = await fetchEvents();
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login");
    throw err;
  }

  const events: PaymentEventView[] = page.items;
  const succeeded = events.filter((e) => e.status === "SUCCEEDED");
  const series = monthlyRevenue(events, 12);
  const totalRevenue = succeeded.reduce(
    (sum, e) => sum + Math.max(0, e.amountCents),
    0,
  );

  const kinds = ["TICKET", "MEMBERSHIP", "DONATION"] as const;
  const byKind = kinds.map((k) => ({
    label: k.charAt(0) + k.slice(1).toLowerCase(),
    cents: succeeded
      .filter((e) => e.kind === k)
      .reduce((s, e) => s + Math.max(0, e.amountCents), 0),
  }));

  if (events.length === 0) {
    return (
      <>
        <PageHead
          crumb={
            <>
              <Icon name="home" size={13} /> OrganizerHub{" "}
              <Icon name="chevR" size={12} /> Analytics
            </>
          }
          title="Analytics"
          sub="No payment data yet."
        />
        <div
          className="card"
          style={{
            padding: "56px 24px",
            textAlign: "center",
            borderStyle: "dashed",
          }}
        >
          <p className="muted" style={{ fontSize: 14 }}>
            No transactions recorded yet. Data will appear here once payments come in.
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHead
        crumb={
          <>
            <Icon name="home" size={13} /> OrganizerHub{" "}
            <Icon name="chevR" size={12} /> Analytics
          </>
        }
        title="Analytics"
        sub={`${money0(totalRevenue)} in succeeded payments across the last 12 months.`}
      />
      <div className="grid-main" style={{ marginBottom: 20 }}>
        <Panel title="Monthly revenue">
          <BarChart data={series} valueKey="cents" />
        </Panel>
        <Panel title="Revenue by kind">
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 14,
            }}
          >
            <Donut data={byKind} valueKey="cents" size={160} />
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                width: "100%",
              }}
            >
              {byKind.map((b) => (
                <div
                  key={b.label}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: 13,
                  }}
                >
                  <span className="muted">{b.label}</span>
                  <span className="mono" style={{ fontWeight: 600 }}>
                    {money0(b.cents)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Panel>
      </div>
    </>
  );
}
