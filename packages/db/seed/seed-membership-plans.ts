// Idempotent seed for the six membership SKUs. Run as
//   pnpm -F db seed:api
// The catalog is static — Stripe-side Products and Prices are created
// manually in the Dashboard (or via the Stripe CLI) with the matching
// lookup_keys, per docs/phase-3-stripe-setup.md.
//
// The seed itself never calls Stripe; it only upserts local catalog rows so
// syncStripeData(customerId) can map a subscription's `price.lookup_key`
// back to a local tier + tierLevel.

import { PrismaClient } from '../client/api';

interface PlanInput {
  lookupKey: string;
  tier: 'BRONZE' | 'SILVER' | 'GOLD';
  tierLevel: number;
  displayName: string;
  cadence: 'monthly' | 'yearly';
}

const PLANS: PlanInput[] = [
  {
    lookupKey: 'membership_bronze_monthly',
    tier: 'BRONZE',
    tierLevel: 1,
    displayName: 'Bronze (monthly)',
    cadence: 'monthly',
  },
  {
    lookupKey: 'membership_bronze_yearly',
    tier: 'BRONZE',
    tierLevel: 1,
    displayName: 'Bronze (yearly)',
    cadence: 'yearly',
  },
  {
    lookupKey: 'membership_silver_monthly',
    tier: 'SILVER',
    tierLevel: 2,
    displayName: 'Silver (monthly)',
    cadence: 'monthly',
  },
  {
    lookupKey: 'membership_silver_yearly',
    tier: 'SILVER',
    tierLevel: 2,
    displayName: 'Silver (yearly)',
    cadence: 'yearly',
  },
  {
    lookupKey: 'membership_gold_monthly',
    tier: 'GOLD',
    tierLevel: 3,
    displayName: 'Gold (monthly)',
    cadence: 'monthly',
  },
  {
    lookupKey: 'membership_gold_yearly',
    tier: 'GOLD',
    tierLevel: 3,
    displayName: 'Gold (yearly)',
    cadence: 'yearly',
  },
];

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    for (const p of PLANS) {
      await prisma.membershipPlan.upsert({
        where: { lookupKey: p.lookupKey },
        create: p,
        update: {
          tier: p.tier,
          tierLevel: p.tierLevel,
          displayName: p.displayName,
          cadence: p.cadence,
        },
      });
    }
    const count = await prisma.membershipPlan.count();
    console.log(`[seed-membership-plans] ${count} plan rows present`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
