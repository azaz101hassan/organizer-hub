-- Add stripe_dispute_id column + unique constraint to payment_events.
-- Enables row-level idempotency for charge.dispute.created redeliveries via
-- the existing P2002 catch in insertDispute. Mirrors the stripe_refund_id
-- @unique convention on the same model.
ALTER TABLE "payment_events"
    ADD COLUMN IF NOT EXISTS "stripe_dispute_id" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "payment_events_stripe_dispute_id_key"
    ON "payment_events" ("stripe_dispute_id")
    WHERE "stripe_dispute_id" IS NOT NULL;
