-- Annotate the donation_id FK with ON DELETE SET NULL.
-- The original add_donations migration already created the constraint with
-- SET NULL semantics; this migration makes the Prisma schema annotation
-- consistent with the live database definition.
-- Net effect on existing databases: none (constraint already has ON DELETE SET NULL).
-- Effect on fresh migrations (e.g. CI, new dev envs): the prior add_donations
-- migration already applies the correct constraint, so this is a no-op there too.
-- The drop+recreate is written for completeness and so prisma migrate status
-- never reports this migration as unapplied against a fresh schema build.

ALTER TABLE "payment_events" DROP CONSTRAINT IF EXISTS "payment_events_donation_id_fkey";

ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_donation_id_fkey"
    FOREIGN KEY ("donation_id") REFERENCES "donations"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
