-- Phase 4 U6: snapshot the requester's contact on the TicketRequest at intake.
--
-- The API bounded context has no User table (userId is an opaque accounts
-- `sub`), so the admin reject/approve and scheduler auto-reject email flows
-- (R16) cannot resolve the requester's address later — it must travel with the
-- request. Both columns are nullable (a JWT may omit email/name).
--
-- Hand-written (two trivial ADD COLUMNs) and applied via `migrate deploy`
-- rather than `migrate dev`, because migrate dev would see the Prisma-
-- inexpressible partial unique index as drift and try to DROP it.

ALTER TABLE "ticket_requests" ADD COLUMN "user_email" TEXT;
ALTER TABLE "ticket_requests" ADD COLUMN "user_name" TEXT;
