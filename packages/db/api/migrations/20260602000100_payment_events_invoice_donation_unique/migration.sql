-- One DONATION PaymentEvent row per invoice. Prevents concurrent redelivery
-- of invoice.payment_failed from writing duplicate FAILED rows when
-- payment_intent is NULL (zero-amount / out-of-band invoices), because the
-- existing partial unique on (stripe_payment_intent_id, kind) does NOT fire
-- on (NULL, 'DONATION') under Postgres unique-null semantics.
--
-- HAND-WRITTEN and Prisma-INEXPRESSIBLE — Prisma 6.x cannot represent
-- partial unique indexes. Mirror of payment_events_pi_kind_key convention.
--
-- DRIFT WARNING: a future `prisma migrate dev` / `db push` may emit a
-- DROP INDEX for this. Inspect migrate dev output and delete any such DROP
-- before applying.
CREATE UNIQUE INDEX "payment_events_invoice_donation_key"
    ON "payment_events" ("stripe_invoice_id", "kind")
    WHERE "kind" = 'DONATION' AND "stripe_invoice_id" IS NOT NULL;
