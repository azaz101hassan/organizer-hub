-- CreateEnum
CREATE TYPE "CoalitionStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'COMPLETE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "DonationMode" AS ENUM ('ONE_TIME', 'RECURRING');

-- CreateEnum
CREATE TYPE "DonationCadence" AS ENUM ('ONCE', 'MONTHLY', 'QUARTERLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "DonationStatus" AS ENUM ('PENDING', 'ACTIVE', 'COMPLETED', 'CANCELED', 'FAILED');

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "donations_enabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "payment_events" ADD COLUMN     "donation_id" TEXT;

-- CreateTable
CREATE TABLE "coalitions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "cover_image_url" TEXT,
    "status" "CoalitionStatus" NOT NULL DEFAULT 'ACTIVE',
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coalitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "coalition_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "cover_image_url" TEXT,
    "target_amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "deadline" TIMESTAMP(3),
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "donations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "mode" "DonationMode" NOT NULL,
    "cadence" "DonationCadence" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "status" "DonationStatus" NOT NULL DEFAULT 'PENDING',
    "stripe_customer_id" TEXT,
    "stripe_checkout_session_id" TEXT,
    "stripe_subscription_id" TEXT,
    "display_name_opt_in" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "canceled_at" TIMESTAMP(3),

    CONSTRAINT "donations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "coalitions_organization_id_status_display_order_idx" ON "coalitions"("organization_id", "status", "display_order");

-- CreateIndex
CREATE UNIQUE INDEX "coalitions_organization_id_slug_key" ON "coalitions"("organization_id", "slug");

-- CreateIndex
CREATE INDEX "campaigns_coalition_id_status_display_order_idx" ON "campaigns"("coalition_id", "status", "display_order");

-- CreateIndex
CREATE INDEX "campaigns_organization_id_status_idx" ON "campaigns"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "campaigns_organization_id_slug_key" ON "campaigns"("organization_id", "slug");

-- CreateIndex
CREATE INDEX "donations_user_id_status_idx" ON "donations"("user_id", "status");

-- CreateIndex
CREATE INDEX "donations_campaign_id_status_idx" ON "donations"("campaign_id", "status");

-- CreateIndex
CREATE INDEX "donations_stripe_subscription_id_idx" ON "donations"("stripe_subscription_id");

-- CreateIndex
CREATE INDEX "donations_stripe_checkout_session_id_idx" ON "donations"("stripe_checkout_session_id");

-- CreateIndex
CREATE INDEX "payment_events_donation_id_idx" ON "payment_events"("donation_id");

-- AddForeignKey
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_donation_id_fkey" FOREIGN KEY ("donation_id") REFERENCES "donations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_coalition_id_fkey" FOREIGN KEY ("coalition_id") REFERENCES "coalitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "donations" ADD CONSTRAINT "donations_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed one General coalition + one General fund campaign per organization.
-- Idempotent: WHERE NOT EXISTS guards against re-runs and partial applies.
INSERT INTO "coalitions" (id, organization_id, name, slug, status, display_order, created_at, updated_at)
SELECT
  'coal_general_' || o.id,
  o.id,
  'General',
  'general',
  'ACTIVE',
  0,
  NOW(),
  NOW()
FROM "organizations" o
WHERE NOT EXISTS (
  SELECT 1 FROM "coalitions" c WHERE c.organization_id = o.id AND c.slug = 'general'
);

INSERT INTO "campaigns" (id, organization_id, coalition_id, name, slug, target_amount_cents, currency, status, display_order, created_at, updated_at)
SELECT
  'camp_general_fund_' || o.id,
  o.id,
  'coal_general_' || o.id,
  'General fund',
  'general-fund',
  0,
  'usd',
  'ACTIVE',
  0,
  NOW(),
  NOW()
FROM "organizations" o
WHERE NOT EXISTS (
  SELECT 1 FROM "campaigns" c WHERE c.organization_id = o.id AND c.slug = 'general-fund'
);
