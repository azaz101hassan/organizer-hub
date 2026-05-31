import Link from "next/link";
import { redirect } from "next/navigation";
import { apiFetch, UnauthorizedError, formatDateTime } from "@organizer-hub/web-shared";
import type {
  MembershipView,
  SubscriptionStatus,
} from "@organizer-hub/web-shared";
import { Card, Badge, Display, Eyebrow } from "@organizer-hub/web-shared/ui";
import type { BadgeTone } from "@organizer-hub/web-shared/ui";
import { CancelButton } from "./CancelButton";

const STATUS_LABEL: Record<SubscriptionStatus, string> = {
  ACTIVE: "Active",
  TRIALING: "Trial",
  PAST_DUE: "Past due",
  CANCELED: "Canceled",
  UNPAID: "Unpaid",
  INCOMPLETE: "Awaiting payment",
  INCOMPLETE_EXPIRED: "Expired",
  PAUSED: "Paused",
};

// Map subscription status to Badge tone
const STATUS_TONE: Record<SubscriptionStatus, BadgeTone> = {
  ACTIVE: "published",
  TRIALING: "published",
  PAST_DUE: "cancelled",
  CANCELED: "cancelled",
  UNPAID: "cancelled",
  INCOMPLETE: "draft",
  INCOMPLETE_EXPIRED: "cancelled",
  PAUSED: "draft",
};

const CANCELLABLE: ReadonlySet<SubscriptionStatus> = new Set([
  "ACTIVE",
  "TRIALING",
  "PAST_DUE",
]);

export default async function DashboardMembershipPage() {
  let membership: MembershipView | null;
  try {
    membership = await apiFetch<MembershipView | null>("/memberships/me");
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login");
    throw err;
  }

  if (!membership) {
    return (
      <div>
        <Eyebrow muted style={{ marginBottom: 10 }}>Membership</Eyebrow>
        <Display as="h1" size="lg" style={{ marginBottom: 32 }}>
          Your membership
        </Display>
        <Card style={{ padding: "40px 32px", textAlign: "center", borderStyle: "dashed" }}>
          <p className="muted" style={{ fontSize: 14, marginBottom: 20 }}>
            You don&apos;t have an active membership.
          </p>
          <Link href="/membership" className="btn btn--primary btn--sm">
            Browse plans
          </Link>
        </Card>
      </div>
    );
  }

  const tierLabel =
    membership.tier.charAt(0) + membership.tier.slice(1).toLowerCase();
  const periodEnd = formatDateTime(membership.currentPeriodEnd);
  const cancelling =
    membership.cancelAtPeriodEnd && membership.status === "ACTIVE";

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 32 }}>
        <div>
          <Eyebrow muted style={{ marginBottom: 8 }}>Membership</Eyebrow>
          <Display as="h1" size="lg">Your membership</Display>
        </div>
        <Link href="/membership" className="muted link" style={{ fontSize: 12 }}>
          See all plans →
        </Link>
      </div>

      {membership.status === "PAST_DUE" && (
        <div
          style={{
            marginBottom: 24,
            padding: "14px 18px",
            borderRadius: "var(--radius-lg)",
            border: "1px solid color-mix(in oklab, var(--bad) 40%, transparent)",
            background: "var(--bad-soft)",
            color: "var(--bad)",
            fontSize: 13.5,
          }}
        >
          Your last payment failed. Update your payment method to keep
          coverage — Stripe will retry automatically.
        </div>
      )}

      <Card padded>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
          <div>
            <Eyebrow muted style={{ marginBottom: 6 }}>Current tier</Eyebrow>
            <Display as="h2" size="md">{tierLabel}</Display>
          </div>
          <Badge tone={STATUS_TONE[membership.status]}>
            {STATUS_LABEL[membership.status]}
          </Badge>
        </div>

        <hr className="rule" style={{ margin: "20px 0" }} />

        <dl style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
          <div>
            <dt className="eyebrow eyebrow--muted" style={{ marginBottom: 6 }}>
              {cancelling ? "Cancels on" : "Renews on"}
            </dt>
            <dd style={{ margin: 0, fontSize: 14 }}>{periodEnd}</dd>
          </div>
          <div>
            <dt className="eyebrow eyebrow--muted" style={{ marginBottom: 6 }}>Last updated</dt>
            <dd style={{ margin: 0, fontSize: 14 }}>{formatDateTime(membership.updatedAt)}</dd>
          </div>
        </dl>

        {cancelling && (
          <p className="muted" style={{ marginTop: 16, fontSize: 13 }}>
            You&apos;ve scheduled cancellation. Access continues until{" "}
            {periodEnd}.
          </p>
        )}

        {CANCELLABLE.has(membership.status) && !cancelling && (
          <div style={{ marginTop: 24, paddingTop: 20, borderTop: "1px solid var(--line)" }}>
            <CancelButton />
          </div>
        )}
      </Card>
    </div>
  );
}
