import { redirect } from "next/navigation";
import { apiFetch, UnauthorizedError } from "@organizer-hub/web-shared";
import type {
  MembershipView,
  RequesterTicketRequestView,
} from "@organizer-hub/web-shared";
import { Display, Eyebrow } from "@organizer-hub/web-shared/ui";
import { StatCard } from "../../components/StatCard";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  let membership: MembershipView | null = null;
  let requests: RequesterTicketRequestView[] = [];
  try {
    [membership, requests] = await Promise.all([
      apiFetch<MembershipView | null>("/memberships/me").catch(
        (err: unknown) => {
          if (err instanceof UnauthorizedError) throw err;
          console.error("[DashboardPage] /memberships/me failed:", err);
          return null;
        }
      ),
      apiFetch<RequesterTicketRequestView[]>("/requests").catch(
        (err: unknown) => {
          if (err instanceof UnauthorizedError) throw err;
          console.error("[DashboardPage] /requests failed:", err);
          return [];
        }
      ),
    ]);
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login");
    throw err;
  }

  const pending = requests.filter((r) => r.status === "PENDING").length;
  const resolved = requests.length - pending;
  const tierLabel = membership
    ? membership.tier.charAt(0) + membership.tier.slice(1).toLowerCase()
    : "None";

  return (
    <>
      <Eyebrow>Welcome back</Eyebrow>
      <Display as="h1" size="lg" style={{ margin: "10px 0 28px" }}>
        Overview
      </Display>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4,1fr)",
          gap: 16,
          marginBottom: 36,
        }}
      >
        <StatCard num={tierLabel} label="Membership" icon="crown" accent />
        <StatCard num={requests.length} label="Total requests" icon="ticket" />
        <StatCard
          num={pending}
          label="Pending"
          icon="inbox"
          accent={pending > 0}
        />
        <StatCard num={resolved} label="Resolved" icon="check" />
      </div>
    </>
  );
}
