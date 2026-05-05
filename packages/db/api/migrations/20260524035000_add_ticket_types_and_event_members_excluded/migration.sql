-- TicketType: per-event ticket tier (GA / VIP / member-only). Mirrors a
-- Stripe Product + Price. Stripe Prices are immutable, so a priceCents
-- change archives the old Price in Stripe and creates a new one; the local
-- row points at whatever the current Stripe Price is.

CREATE TABLE "ticket_types" (
    "id"                 TEXT         NOT NULL,
    "event_id"           TEXT         NOT NULL,
    "name"               TEXT         NOT NULL,
    "price_cents"        INTEGER      NOT NULL,
    "min_tier_level"     INTEGER      NOT NULL DEFAULT 0,
    "stripe_product_id"  TEXT         NOT NULL,
    "stripe_price_id"    TEXT         NOT NULL,
    "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"         TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticket_types_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ticket_types_stripe_product_id_key" ON "ticket_types"("stripe_product_id");
CREATE UNIQUE INDEX "ticket_types_stripe_price_id_key"   ON "ticket_types"("stripe_price_id");
CREATE INDEX        "ticket_types_event_id_idx"          ON "ticket_types"("event_id");

ALTER TABLE "ticket_types"
    ADD CONSTRAINT "ticket_types_event_id_fkey"
    FOREIGN KEY ("event_id") REFERENCES "events"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- members_excluded: per-event toggle that opts the event out of membership
-- coverage. When true, ticket types under this event do NOT honor the free
-- claim path even if minTierLevel <= membership.tierLevel.
ALTER TABLE "events"
    ADD COLUMN "members_excluded" BOOLEAN NOT NULL DEFAULT false;
