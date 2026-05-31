import Link from "next/link";
import { publicApiFetch } from "@organizer-hub/web-shared";
import type { MembershipPlanView } from "@organizer-hub/web-shared";
import { subscribeToTier } from "./actions";

const TIER_COPY: Record<
  "BRONZE" | "SILVER" | "GOLD",
  { tagline: string; perks: string[]; accent: string }
> = {
  BRONZE: {
    tagline: "Get started — coverage on Bronze-tier events.",
    perks: ["Free claim on Bronze events", "Member-only updates"],
    accent: "border-amber-300 dark:border-amber-700",
  },
  SILVER: {
    tagline: "More events covered, including Bronze and Silver tiers.",
    perks: ["Everything in Bronze", "Free claim on Silver events"],
    accent: "border-zinc-400 dark:border-zinc-500",
  },
  GOLD: {
    tagline: "Top tier — coverage across every membership event.",
    perks: [
      "Everything in Silver",
      "Free claim on Gold-tier events",
      "Priority support",
    ],
    accent: "border-yellow-400 dark:border-yellow-600",
  },
};

function groupByTier(plans: MembershipPlanView[]) {
  const map = new Map<MembershipPlanView["tier"], MembershipPlanView[]>();
  for (const plan of plans) {
    const list = map.get(plan.tier) ?? [];
    list.push(plan);
    map.set(plan.tier, list);
  }
  return ["BRONZE", "SILVER", "GOLD"]
    .map((tier) => ({
      tier: tier as MembershipPlanView["tier"],
      plans: map.get(tier as MembershipPlanView["tier"]) ?? [],
    }))
    .filter((g) => g.plans.length > 0);
}

interface PageProps {
  searchParams: Promise<{ error?: string }>;
}

export default async function MembershipPage({ searchParams }: PageProps) {
  const { error } = await searchParams;
  const plans = await publicApiFetch<MembershipPlanView[]>(
    "/public/memberships",
  );
  const groups = groupByTier(plans);

  return (
    <main className="min-h-screen bg-zinc-50 dark:bg-black px-6 py-16">
      <div className="max-w-5xl mx-auto">
        <div className="text-center">
          <Link
            href="/"
            className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          >
            ← OrganizerHub
          </Link>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Become a member
          </h1>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            Pick a tier. Higher tiers cover everything in the tiers below them.
          </p>
        </div>

        {error && (
          <div className="mt-6 mx-auto max-w-md rounded-xl border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950/40 p-4 text-sm text-red-700 dark:text-red-300">
            We couldn&apos;t start checkout: {error}
          </div>
        )}

        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {groups.map(({ tier, plans }) => {
            const copy = TIER_COPY[tier];
            return (
              <div
                key={tier}
                className={`rounded-2xl border-2 ${copy.accent} bg-white dark:bg-zinc-900 p-6 flex flex-col`}
              >
                <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                  {tier.charAt(0) + tier.slice(1).toLowerCase()}
                </h2>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  {copy.tagline}
                </p>
                <ul className="mt-4 space-y-2 text-sm text-zinc-700 dark:text-zinc-300">
                  {copy.perks.map((perk) => (
                    <li key={perk} className="flex gap-2">
                      <span aria-hidden>·</span>
                      <span>{perk}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-6 flex flex-col gap-2">
                  {plans.map((plan) => (
                    <form key={plan.lookupKey} action={subscribeToTier}>
                      <input
                        type="hidden"
                        name="lookupKey"
                        value={plan.lookupKey}
                      />
                      <button
                        type="submit"
                        className="w-full rounded-full bg-zinc-900 dark:bg-zinc-100 text-zinc-50 dark:text-zinc-900 px-4 py-2 text-xs font-medium hover:bg-zinc-700 dark:hover:bg-zinc-300 transition"
                      >
                        Subscribe · {plan.cadence}
                      </button>
                    </form>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <p className="mt-10 text-center text-xs text-zinc-500 dark:text-zinc-400">
          Already a member?{" "}
          <Link
            href="/dashboard/membership"
            className="underline hover:text-zinc-700 dark:hover:text-zinc-300"
          >
            View your membership
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
