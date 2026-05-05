-- Ticket: per-attendee issued ticket, with PAID/MEMBERSHIP_CLAIM provenance.
-- PAID idempotency is enforced by the unique stripe_checkout_session_id
-- catching webhook redeliveries; MEMBERSHIP_CLAIM uniqueness is enforced at
-- the service layer (one claim per user/event/ticket_type for that source).
-- We intentionally do NOT @@unique (user, event, ticket_type) since a family
-- buying multiple GA tickets from one account is legitimate.

CREATE TYPE "TicketSource" AS ENUM ('PAID', 'MEMBERSHIP_CLAIM');

CREATE TABLE "tickets" (
    "id"                          TEXT         NOT NULL,
    "user_id"                     TEXT         NOT NULL,
    "event_id"                    TEXT         NOT NULL,
    "ticket_type_id"              TEXT         NOT NULL,
    "source"                      "TicketSource" NOT NULL,
    "stripe_checkout_session_id"  TEXT,
    "stripe_payment_intent_id"    TEXT,
    "issued_at"                   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tickets_stripe_checkout_session_id_key" ON "tickets"("stripe_checkout_session_id");
CREATE UNIQUE INDEX "tickets_stripe_payment_intent_id_key"   ON "tickets"("stripe_payment_intent_id");
CREATE INDEX        "tickets_user_id_idx"                    ON "tickets"("user_id");
CREATE INDEX        "tickets_event_id_idx"                   ON "tickets"("event_id");
CREATE INDEX        "tickets_user_id_event_id_ticket_type_id_source_idx"
                                                              ON "tickets"("user_id", "event_id", "ticket_type_id", "source");

ALTER TABLE "tickets"
    ADD CONSTRAINT "tickets_ticket_type_id_fkey"
    FOREIGN KEY ("ticket_type_id") REFERENCES "ticket_types"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tickets"
    ADD CONSTRAINT "tickets_event_id_fkey"
    FOREIGN KEY ("event_id") REFERENCES "events"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
