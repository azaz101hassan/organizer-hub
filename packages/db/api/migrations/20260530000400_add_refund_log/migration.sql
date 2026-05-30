-- Phase 4 U7: durable record of dead-request auto-refunds.
--
-- stripe_checkout_session_id is UNIQUE so the webhook's dead-request branch can
-- UPSERT it — a redelivered completed event refunds at most once (idempotency
-- key) and writes exactly one record. Hand-written + applied via migrate deploy
-- (migrate dev would try to DROP the Prisma-inexpressible partial unique index).

CREATE TABLE "refund_logs" (
    "id"                          TEXT         NOT NULL,
    "ticket_request_id"           TEXT,
    "stripe_checkout_session_id"  TEXT         NOT NULL,
    "stripe_payment_intent_id"    TEXT,
    "reason"                      TEXT         NOT NULL,
    "amount_cents"                INTEGER      NOT NULL,
    "created_at"                  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refund_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "refund_logs_stripe_checkout_session_id_key" ON "refund_logs"("stripe_checkout_session_id");
