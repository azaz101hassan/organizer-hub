-- DropIndex
DROP INDEX "payment_events_pi_kind_key";

-- One charge row per PaymentIntent. Partial: refund/dispute rows
-- intentionally share the PI with the charge they reference, so the
-- unique only applies to non-refund/dispute kinds.
--
-- HAND-WRITTEN and Prisma-INEXPRESSIBLE — Prisma 6.x cannot represent
-- partial unique indexes (mirrors ticket_requests_one_open_per_user_type).
--
-- DRIFT WARNING: a future `prisma migrate dev` / `db push` can silently
-- emit a DROP INDEX for this. Inspect migrate dev output and delete any
-- such DROP before applying.
CREATE UNIQUE INDEX "payment_events_pi_kind_key"
    ON "payment_events" ("stripe_payment_intent_id", "kind")
    WHERE "kind" NOT IN ('REFUND', 'DISPUTE');
