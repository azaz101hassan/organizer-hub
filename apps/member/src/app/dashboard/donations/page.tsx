import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import {
  apiFetch,
  ApiError,
  UnauthorizedError,
  donationsEnabledForOrg,
} from "@organizer-hub/web-shared";
import { Card, Display, Eyebrow, Lede } from "@organizer-hub/web-shared/ui";
import { RecurringRow, type DonationRow } from "./RecurringRow";

export const dynamic = "force-dynamic";

export const metadata = { title: "My recurring donations" };

export default async function MyDonationsPage() {
  if (!(await donationsEnabledForOrg())) notFound();

  let rows: DonationRow[] = [];
  try {
    const all = await apiFetch<DonationRow[]>("/donations/mine?mode=RECURRING");
    const list = Array.isArray(all) ? all : [];
    rows = list.filter((r) => r.status === "ACTIVE");
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect("/auth/login");
    }
    if (err instanceof ApiError && err.status === 404) {
      rows = [];
    } else {
      throw err;
    }
  }

  return (
    <div>
      <Eyebrow muted style={{ marginBottom: 8 }}>Account</Eyebrow>
      <Display as="h1" size="lg" style={{ marginBottom: 8 }}>
        My recurring donations
      </Display>
      <Lede style={{ marginBottom: 32, fontSize: 15 }}>
        Manage your recurring gifts.
      </Lede>

      {rows.length === 0 ? (
        <Card
          style={{
            padding: "40px 32px",
            textAlign: "center",
            borderStyle: "dashed",
          }}
        >
          <p className="muted" style={{ fontSize: 14, margin: 0 }}>
            You don&apos;t have any recurring donations yet.{" "}
            <Link href="/coalitions" className="link">
              Browse our campaigns
            </Link>
            .
          </p>
        </Card>
      ) : (
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
          {rows.map((row, i) => (
            <RecurringRow key={row.id} row={row} index={i} />
          ))}
        </ul>
      )}

      <p className="muted" style={{ marginTop: 24, fontSize: 13.5 }}>
        Looking for past one-time donations?{" "}
        <Link href="/dashboard/payments?kind=DONATION" className="link">
          View payments history.
        </Link>
      </p>
    </div>
  );
}
