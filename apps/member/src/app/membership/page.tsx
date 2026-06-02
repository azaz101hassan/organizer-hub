import Link from "next/link";
import { publicApiFetch, donationsEnabledForOrg } from "@organizer-hub/web-shared";
import type { MembershipPlanView } from "@organizer-hub/web-shared";
import {
  Badge,
  Button,
  Card,
  Display,
  Eyebrow,
  Icon,
  Lede,
} from "@organizer-hub/web-shared/ui";
import { PublicShell } from "../../components/PublicShell";
import { subscribeToTier } from "./actions";

const TIER_COPY: Record<
  "BRONZE" | "SILVER" | "GOLD",
  { displayName: string; tagline: string; perks: string[] }
> = {
  BRONZE: {
    displayName: "Bronze",
    tagline: "Coverage on Bronze-tier events.",
    perks: ["Free claim on Bronze events", "Member-only updates"],
  },
  SILVER: {
    displayName: "Silver",
    tagline: "Bronze and Silver tier coverage.",
    perks: ["Everything in Bronze", "Free claim on Silver events"],
  },
  GOLD: {
    displayName: "Gold",
    tagline: "Top tier — every membership event.",
    perks: [
      "Everything in Silver",
      "Free claim on Gold-tier events",
      "Priority support",
    ],
  },
};

const TIERS = ["BRONZE", "SILVER", "GOLD"] as const;

export const dynamic = "force-dynamic";

function groupByTier(plans: MembershipPlanView[]) {
  return TIERS.map((tier) => ({
    tier,
    plans: plans.filter((p) => p.tier === tier),
  })).filter((g) => g.plans.length > 0);
}

interface PageProps {
  searchParams: Promise<{ error?: string }>;
}

export default async function MembershipPage({ searchParams }: PageProps) {
  const { error } = await searchParams;
  const [plans, donationsOn] = await Promise.all([
    publicApiFetch<MembershipPlanView[]>("/public/memberships"),
    donationsEnabledForOrg(),
  ]);
  const groups = groupByTier(plans);

  return (
    <PublicShell>
      <div
        className="container"
        style={{ paddingTop: 56, paddingBottom: 80, textAlign: "center" }}
      >
        <Eyebrow>One membership, every society</Eyebrow>
        <Display
          as="h1"
          size="xl"
          style={{ margin: "14px 0 14px" }}
        >
          Become a member
        </Display>
        <Lede style={{ maxWidth: 520, margin: "0 auto" }}>
          Pick a tier. Each tier covers everything in the tiers beneath it —
          claim covered seats free, across every organizer on the platform.
        </Lede>

        {error && (
          <div
            style={{
              marginTop: 24,
              marginInline: "auto",
              maxWidth: 460,
              padding: 14,
              borderRadius: "var(--radius-sm)",
              background: "var(--bad-soft)",
              color: "var(--bad)",
              fontSize: 14,
              lineHeight: 1.5,
            }}
          >
            We couldn&apos;t start checkout: {error}
          </div>
        )}

        <div
          className="grid-3-narrow"
          style={{
            marginTop: 44,
            textAlign: "left",
          }}
        >
          {groups.map(({ tier, plans: tierPlans }) => {
            const copy = TIER_COPY[tier];
            const featured = tier === "SILVER";
            return (
              <div key={tier} style={{ position: "relative" }}>
                {featured && (
                  <div
                    style={{ position: "absolute", top: -12, right: 18, zIndex: 1 }}
                  >
                    <Badge tone="featured">Most chosen</Badge>
                  </div>
                )}
                <Card
                  style={{
                    padding: "30px 28px",
                    borderColor: featured ? "var(--accent)" : "var(--line)",
                    borderWidth: featured ? 2 : 1,
                    boxShadow: featured ? "var(--shadow)" : "none",
                    height: "100%",
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <Icon name="crown" size={20} />
                    <Display as="h2" size="md">
                      {copy.displayName}
                    </Display>
                  </div>
                  <p
                    className="muted"
                    style={{ fontSize: 14, marginTop: 8, lineHeight: 1.5 }}
                  >
                    {copy.tagline}
                  </p>
                  <hr
                    className="rule"
                    style={{ margin: "18px 0" }}
                  />
                  <ul
                    style={{
                      listStyle: "none",
                      padding: 0,
                      margin: "0 0 24px",
                      display: "flex",
                      flexDirection: "column",
                      gap: 11,
                      flexGrow: 1,
                    }}
                  >
                    {copy.perks.map((perk) => (
                      <li
                        key={perk}
                        style={{ display: "flex", gap: 10, fontSize: 14, alignItems: "flex-start" }}
                      >
                        <span style={{ color: "var(--good)", flexShrink: 0, marginTop: 1 }}>
                          <Icon name="check" size={15} />
                        </span>
                        <span style={{ color: "var(--ink)" }}>{perk}</span>
                      </li>
                    ))}
                  </ul>
                  <div
                    style={{
                      marginTop: "auto",
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                    }}
                  >
                    {tierPlans.map((plan) => (
                      <form key={plan.lookupKey} action={subscribeToTier}>
                        <input
                          type="hidden"
                          name="lookupKey"
                          value={plan.lookupKey}
                        />
                        <Button
                          block
                          size="md"
                          variant={featured ? "primary" : "solid"}
                          type="submit"
                        >
                          Subscribe · {plan.cadence}
                        </Button>
                      </form>
                    ))}
                  </div>
                </Card>
              </div>
            );
          })}
        </div>

        <p className="muted" style={{ marginTop: 32, fontSize: 13 }}>
          Already a member?{" "}
          <a href="/dashboard/membership" className="link" style={{ fontSize: 13 }}>
            View your membership
          </a>
        </p>

        {donationsOn && (
          <p className="muted" style={{ marginTop: 8, fontSize: 13 }}>
            Not ready to subscribe?{" "}
            <Link href="/coalitions" className="link" style={{ fontSize: 13 }}>
              Support a campaign
            </Link>
            .
          </p>
        )}
      </div>
    </PublicShell>
  );
}
