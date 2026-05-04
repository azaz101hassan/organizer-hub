-- MembershipPlan: local catalog for the six membership SKUs (tier × cadence).
-- Rows are seeded by packages/db/seed/seed-membership-plans.ts; the seed is
-- the authoritative writer here, not the application. Stripe is the source
-- of truth for price + amount; the local lookup_key bridges to the Stripe
-- Price object configured with the matching `lookup_key`.

CREATE TYPE "MembershipTier" AS ENUM ('BRONZE', 'SILVER', 'GOLD');

CREATE TABLE "membership_plans" (
    "id"           TEXT NOT NULL,
    "lookup_key"   TEXT NOT NULL,
    "tier"         "MembershipTier" NOT NULL,
    "tier_level"   INTEGER NOT NULL,
    "display_name" TEXT NOT NULL,
    "cadence"      TEXT NOT NULL,

    CONSTRAINT "membership_plans_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "membership_plans_lookup_key_key"    ON "membership_plans"("lookup_key");
CREATE UNIQUE INDEX "membership_plans_tier_cadence_key"  ON "membership_plans"("tier", "cadence");
