---
title: "CAS + partial-unique concurrency model for multi-actor state machines"
date: 2026-05-30
category: design-patterns
module: ticket-requests
problem_type: design_pattern
component: database
severity: high
applies_when:
  - A state-machine row can be moved by multiple actors concurrently (admin, user, webhook, scheduler)
  - The system uses a soft cap with no seat hold (approval does not reserve a resource)
  - Prisma cannot express a required constraint natively (partial unique indexes)
  - An audit trail must record pre/post counts that are correct under concurrency
tags: [concurrency, compare-and-set, partial-unique-index, prisma, for-update, optimistic-locking, serializable-isolation]
---

# CAS + partial-unique concurrency model for multi-actor state machines

## Context

OrganizerHub's Phase 4 waitlist introduces a TicketRequest state machine with five states (PENDING, APPROVED, REJECTED, CANCELLED_BY_USER, EXPIRED) and multiple concurrent actors: two admins, a user self-cancel, a Stripe webhook, and a scheduled auto-reject job. The "soft cap with no seat hold" design means approving a request does not deduct from capacity — a Ticket row only materializes on payment (PAID) or on admin approval of a membership claim. This creates windows where multiple actors race to move the same row, and without controls: double-issued tickets, phantom approvals on cancelled requests, or audit rows with stale counts.

## Guidance

Three-layer defense: **CAS transitions** for every state move, **DB constraints** as hard backstops, and **escalated isolation** for operations that need stronger guarantees.

### Layer 1: Compare-and-Set (CAS) Transitions

Every transition goes through a single chokepoint — `updateMany` with a `where` clause on the current status:

```typescript
const { count } = await db.ticketRequest.updateMany({
  where: { id, status: from },
  data: { status: to },
});
if (count === 0) {
  throw new ConflictException(`Ticket request ${id} is no longer ${from}`);
}
```

count===1 means this caller won; count===0 means another actor already moved it → 409. External side-effects (Stripe session, email, SSE emit) run ONLY after the CAS win commits.

### Layer 2: DB Constraints as Hard Backstops

- **`Ticket.ticketRequestId @unique`** — at most one Ticket per request. A double-issue hits P2002.
- **Partial unique index** `(userId, ticketTypeId) WHERE status IN ('PENDING','APPROVED')` — one open request per user per tier. Hand-written SQL because Prisma 6.x cannot express partial unique indexes:

```sql
CREATE UNIQUE INDEX "ticket_requests_one_open_per_user_type"
    ON "ticket_requests" ("user_id", "ticket_type_id")
    WHERE "status" IN ('PENDING', 'APPROVED');
```

The predicate includes APPROVED so an approved-awaiting-payment request holds the slot until it expires.

### Layer 2.5: Boot Guard for Prisma-Inexpressible Indexes

`prisma migrate dev` can silently DROP partial indexes. A boot guard queries `pg_indexes` at startup and fails the app if the index is missing:

```typescript
const rows = await this.prisma.$queryRaw`
  SELECT indexname FROM pg_indexes WHERE tablename = 'ticket_requests'
`;
assertOpenRequestIndexPresent(rows.map((r) => r.indexname));
```

The assertion function is exported separately for unit testing without a database.

### Layer 3: Escalated Isolation

Two operations need stronger guarantees than bare CAS:

**Webhook reconciliation — SELECT FOR UPDATE:** The webhook must atomically check that a request is still APPROVED + event in future, then issue the Ticket. A bare CAS is insufficient because the check spans multiple tables. Uses `SELECT ... FOR UPDATE OF tr` inside an interactive transaction.

**Claim-approve audit — Serializable with P2034 retry:** The audit row must record accurate `issuedCountBefore` / `issuedCountAfter`. You cannot `FOR UPDATE` a `COUNT(*)`, so the transaction runs at Serializable isolation. A single retry on P2034 handles concurrent approvals for the same tier.

## Why This Matters

Without this layered model:
- **Double issuance:** Two admins approve the same claim concurrently — two Ticket rows for one request
- **Double queuing:** A user submits two PENDING requests for the same tier; without the partial unique index, both land in the queue
- **Phantom payment:** Webhook issues a ticket for a request the user already cancelled (TOCTOU race)
- **Stale audit counts:** Two concurrent approvals both read `issuedCountBefore = 5`, both write `issuedCountAfter = 6`, but the real count is 7
- **Silent index drift:** `prisma migrate dev` drops the partial unique index with no error

## When to Apply

- A state machine where multiple actors can move the same row
- Your ORM cannot express a required constraint (partial unique index, filtered index, exclusion constraint) — you need hand-written SQL + a drift guard
- An audit trail must record pre/post counts correct under concurrency
- A webhook handler must atomically verify preconditions across multiple tables
- Your model has a "hold" gap: approval does not reserve a resource; the resource materializes later on a separate event

## Examples

| File | Role |
|---|---|
| `apps/api/src/ticket-requests/ticket-request-transitions.ts` | CAS core: `transition()`, audit writer |
| `apps/api/src/ticket-requests/admin-ticket-requests.service.ts` | Serializable isolation + P2034 retry |
| `apps/api/src/webhooks/stripe-webhook.service.ts` | FOR UPDATE reconciliation, dead-request refund |
| `apps/api/src/ticket-requests/open-request-index.ts` | Boot guard with exported pure assertion |
| The partial-unique-index migration SQL | Hand-written, Prisma-inexpressible |

## Related

- Phase 4 commits U2 (`310f5c9`), U7 (`1b3515c`)
- `docs/solutions/billing/rename-before-reuse-migration.md` — same hand-written-SQL-in-Prisma approach for schema changes Prisma cannot express
- `docs/solutions/architecture-patterns/webhook-reconciliation-guard.md` — the FOR UPDATE pattern applied to webhook payment reconciliation
