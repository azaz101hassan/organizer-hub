-- WebhookEvent: idempotency / dedupe gate for incoming Stripe webhook
-- deliveries. The handler inserts at the end of its transaction; P2002 on a
-- redelivered event lets us ack 200 without re-running side effects. The full
-- payload is not stored — Stripe is the source of truth for replay.

CREATE TABLE "webhook_events" (
    "stripe_event_id" TEXT        NOT NULL,
    "type"            TEXT        NOT NULL,
    "received_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("stripe_event_id")
);

CREATE INDEX "webhook_events_type_idx" ON "webhook_events"("type");
