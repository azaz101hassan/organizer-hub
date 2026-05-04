-- Membership: local mirror of a Stripe subscription, one per user.
-- `syncStripeData(stripeCustomerId)` upserts this row from a Stripe
-- Subscription read; Stripe owns transactional state, this row exists so
-- coverage checks and dashboard renders don't have to call Stripe.

CREATE TYPE "SubscriptionStatus" AS ENUM (
    'ACTIVE',
    'TRIALING',
    'PAST_DUE',
    'CANCELED',
    'UNPAID',
    'INCOMPLETE',
    'INCOMPLETE_EXPIRED',
    'PAUSED'
);

CREATE TABLE "memberships" (
    "id"                      TEXT NOT NULL,
    "user_id"                 TEXT NOT NULL,
    "stripe_customer_id"      TEXT NOT NULL,
    "stripe_subscription_id"  TEXT NOT NULL,
    "status"                  "SubscriptionStatus" NOT NULL,
    "tier"                    "MembershipTier" NOT NULL,
    "tier_level"              INTEGER NOT NULL,
    "current_period_end"      TIMESTAMP(3) NOT NULL,
    "cancel_at_period_end"    BOOLEAN NOT NULL DEFAULT false,
    "updated_at"              TIMESTAMP(3) NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "memberships_user_id_key"                 ON "memberships"("user_id");
CREATE UNIQUE INDEX "memberships_stripe_subscription_id_key"  ON "memberships"("stripe_subscription_id");
CREATE INDEX        "memberships_stripe_customer_id_idx"      ON "memberships"("stripe_customer_id");
