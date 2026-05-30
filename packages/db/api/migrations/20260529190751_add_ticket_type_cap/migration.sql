-- Phase 4 U1: optional soft cap on TicketType.
--
-- `cap` is nullable; null means "no cap" (Phase 3 instant-issue behavior).
-- The CHECK is hand-written because Prisma 6.x cannot express CHECK
-- constraints in schema.prisma — it is belt-and-suspenders behind the DTO
-- @Min(1). The tickets(ticket_type_id) index backs computeIssuedCount's
-- count(Ticket WHERE ticketTypeId=...) used by the atCap predicate.
--
-- Scale note: at production scale the index should be built with
-- CREATE INDEX CONCURRENTLY to avoid an ACCESS EXCLUSIVE lock, but
-- CONCURRENTLY cannot run inside the transaction Prisma wraps each migration
-- in. At portfolio scale the plain CREATE INDEX below is fine.

-- AlterTable
ALTER TABLE "ticket_types" ADD COLUMN     "cap" INTEGER;

-- Soft-cap domain invariant (Prisma-inexpressible; mirrors DTO @Min(1)).
ALTER TABLE "ticket_types"
    ADD CONSTRAINT "ticket_types_cap_check" CHECK ("cap" IS NULL OR "cap" >= 1);

-- CreateIndex
CREATE INDEX "tickets_ticket_type_id_idx" ON "tickets"("ticket_type_id");
