-- Phase 4 U2: one-open-request-per-(user, tier) partial unique index.
--
-- HAND-WRITTEN and Prisma-INEXPRESSIBLE — partial indexes are not supported in
-- Prisma 6.x (they arrive in 7.4, which has its own drift bugs). This migration
-- MUST remain the last of the U2 pair.
--
-- Predicate is status IN ('PENDING','APPROVED'): an APPROVED-awaiting-payment
-- PAID request intentionally HOLDS the slot until it EXPIREs, so a user cannot
-- re-request a tier they already hold an open/approved request for (the
-- documented recovery is "request a new spot" after expiry). Do NOT narrow the
-- predicate to PENDING-only — that reopens the double-queue hole on the
-- approved side. The index is per user_id, so it can never lock a *different*
-- user out of a tier.
--
-- DRIFT WARNING: because this index is invisible to schema.prisma, a future
-- `prisma migrate dev` / `db push` can silently emit a DROP INDEX for it.
-- Inspect migrate dev output and delete any such DROP before applying. The
-- boot-time open-request-index assertion (ticket-requests module) fails loudly
-- if this index ever goes missing.

CREATE UNIQUE INDEX "ticket_requests_one_open_per_user_type"
    ON "ticket_requests" ("user_id", "ticket_type_id")
    WHERE "status" IN ('PENDING', 'APPROVED');
