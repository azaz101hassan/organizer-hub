---
title: "Rename-before-reuse migration: free a name with ALTER, then redefine it"
tags: [database, migrations, prisma, postgres, refactoring, conventions]
category: workflow
date: 2026-05-24
phase: 3
source: docs/plans/2026-05-21-001-feat-phase-3-stripe-billing-plan.md
---

## Problem

A model exists with a name that's *almost right* but a new product concept
needs the same name with different semantics. Phase 2 had
`Membership(userId, organizationId, role)` — a user-role pivot.
Phase 3 needed `Membership(userId, tier, status, currentPeriodEnd, ...)` —
a Stripe subscription mirror. The Phase 2 model wasn't being deleted; it
was just being renamed because the *better* name for it was
`OrganizationMember`.

If you do this naively — change the Prisma model name and run `prisma
migrate dev` — Prisma's diff engine produces a `DROP TABLE memberships;
CREATE TABLE organization_members;` migration. That loses every Phase 2
row in dev and is non-recoverable in production.

## The pattern

Do the rename as a **data-preserving** migration step that uses `ALTER`
exclusively. Bundle every name-bearing artifact in one transaction:

- `ALTER TABLE` for the table itself
- `ALTER TYPE … RENAME TO` for any Postgres enum the table uses
- `ALTER INDEX … RENAME TO` for every named index
- `ALTER TABLE … RENAME CONSTRAINT …` for FKs and unique constraints

Use Prisma's `--create-only` flag to scaffold the migration, then **replace**
the diff-engine output with hand-written `ALTER` statements before applying.

## In this codebase

`packages/db/api/migrations/20260521232247_rename_membership_to_organization_member/migration.sql`:

```sql
-- Rename the Phase 2 user↔org role table (and its enum, indexes, FK) so the
-- term "Membership" can be reused later in its new platform-subscription
-- sense without collision. Data-preserving renames only — no DROP/CREATE.

ALTER TABLE "memberships" RENAME TO "organization_members";

ALTER TYPE "MembershipRole" RENAME TO "OrganizationRole";

ALTER INDEX "memberships_pkey" RENAME TO "organization_members_pkey";
ALTER INDEX "memberships_user_id_idx" RENAME TO "organization_members_user_id_idx";
ALTER INDEX "memberships_organization_id_user_id_key" RENAME TO "organization_members_organization_id_user_id_key";

ALTER TABLE "organization_members"
  RENAME CONSTRAINT "memberships_organization_id_fkey" TO "organization_members_organization_id_fkey";
```

The workflow to produce this:

1. Edit `packages/db/api/schema.prisma`: rename `Membership` → `OrganizationMember`,
   rename `MembershipRole` enum → `OrganizationRole`, update both `@@map`
   and `@@index` names, fix the back-relation field on `Organization`.
2. `pnpm exec prisma migrate dev --create-only --name rename_membership_to_organization_member`
   inside `packages/db/`. **Pass `--create-only`** so Prisma generates the
   migration file but does not apply it. The generated SQL will be the
   wrong DROP/CREATE shape.
3. Replace the migration body with the hand-written `ALTER` block above.
4. Run `pnpm exec prisma migrate dev` (no flag) — applies the corrected SQL.
5. Cross-grep the codebase for every reference to the old names —
   `MembershipRole`, `prisma.membership`, `findMembership*`, etc. The rename
   touches guards (`RolesGuard`), services, controllers, e2e specs,
   and seed scripts. Phase 3's U1 found ~20 call sites this way.

## Why this works

- **Postgres `ALTER` is metadata-only.** Renaming a table, enum, index, or
  constraint rewrites the system catalog row but doesn't touch the data
  pages. The operation is fast (constant time) and transactional — if any
  statement fails, all rollback.
- **Prisma's `--create-only` is the explicit escape hatch.** It exists
  because Prisma's diff engine intentionally favors simplicity (DROP +
  CREATE) over data-preservation. When a rename's intent is "same data,
  new name," the engineer has to assert that intent by writing the SQL
  themselves.
- **One migration per rename, applied first.** Bundling makes
  `migrate deploy` atomic in CI/prod. Putting it as the first migration
  in the next phase (Phase 3 U1) means every later schema change in the
  phase sees the new names and never has to reference the old ones.

## When not to reach for this

- The model has very few rows and you genuinely don't care about losing
  them in dev (still: production care + audit-trail care usually wins).
- The "rename" is actually splitting one model into two — that's a
  different operation: copy data + add NOT NULL FKs + drop old.
- Postgres-specific syntax — if your DB engine doesn't support
  `RENAME CONSTRAINT` (MySQL, SQLite), you'll need DROP + ADD on the FK,
  which is non-trivially different.

## Where to apply

- Any product evolution where you want the **better name** for an existing
  concept *and* want to reuse the old name for a new concept.
- Bundle the rename as the first migration of the phase that needs the
  reused name — never interleave with substantive schema changes that
  could fail and force a rollback of the rename.
- Cross-reference all client code (service layers, guards, controllers,
  e2e helpers, seeds) before applying the migration; Prisma generates
  fresh types after migrate, so TS will catch the missed refs at compile
  time — but only if you re-run `pnpm -F db generate:api` after the
  schema edit. The Prisma client is gitignored in this repo, so anyone
  merging this migration on a fresh checkout also needs that step.

## Related

- Phase 3 U1 commit: `f04613f` (`refactor(api): rename Membership to OrganizationMember`)
- Prisma migrate docs on customizing migrations: https://www.prisma.io/docs/orm/prisma-migrate/workflows/customizing-migrations
