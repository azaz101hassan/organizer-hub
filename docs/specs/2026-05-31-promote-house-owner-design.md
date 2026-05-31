# Promote-house-owner CLI — design

**Status:** approved, ready to implement
**Date:** 2026-05-31

## Problem

After signing up via the accounts OIDC IdP, a brand-new user has a row in
`accounts_db.users` but no row in `api_db.organization_members`. Every admin
write path (`/event-labels` CRUD, `POST /organizations/:orgId/events`, etc.)
runs `EventLabelsService.requireRole` which 404s on missing membership and
403s on insufficient role. The admin UI lets the user sign in and land on
`/events` cleanly, but every action then fails with no useful affordance.

The end-to-end browser smoke (`scripts/admin-member-smoke.mjs`) had to work
around this by inlining a `psql INSERT INTO organization_members ... role =
'OWNER'`. That worked but is exactly the friction a fresh dev hits.

Scope: **local development convenience only**. Production onboarding is out
of scope for this change.

## Solution

A standalone CLI script that takes an email, looks up the corresponding
accounts user, and upserts an `OrganizationMember` row with role `OWNER` on
the seeded house organization.

```
node scripts/promote-house-owner.mjs alice@example.com
# or via the workspace alias:
pnpm setup:owner alice@example.com
```

### Shape

- Single file: `scripts/promote-house-owner.mjs` (ESM, top-level await, no
  TS — mirrors `scripts/setup-env.mjs`).
- Reads `ACCOUNTS_DATABASE_URL` and `API_DATABASE_URL` from the root `.env`
  via the same dotenv approach the api seed uses.
- Uses Prisma clients (`@organizer-hub/db/accounts` and `@organizer-hub/db/api`)
  rather than psql — keeps the script honest with the schema.
- House org id is the seeded constant `org_house_000000000000000001`. No
  flag to target a different org.
- Argument parsing: one positional email arg. No flags. Missing/multiple →
  exit 2 with usage.

### Behavior

1. Validate the email arg shape (cheap regex: contains `@`).
2. Open accounts Prisma client. Look up `users` by email; error out with a
   clear "no user with that email — sign up at http://localhost:3002 first"
   if not found.
3. Open api Prisma client. Confirm the house org exists; error out with a
   hint to run `pnpm -F api seed` if not.
4. Upsert `organization_members` by `(organizationId, userId)`:
   - Not present → insert with role `OWNER`. Print
     `granted OWNER to alice@example.com (cmpt…) on house org`.
   - Already `OWNER` → no-op. Print `alice@example.com is already OWNER, nothing to do`.
   - Other role → update to `OWNER`. Print
     `upgraded alice@example.com (cmpt…) from MEMBER to OWNER`.
5. Close both clients. Exit 0.

Any DB error: print stack to stderr, exit 1.

### Workspace integration

Root `package.json` `scripts` section grows one entry:

```json
"setup:owner": "node scripts/promote-house-owner.mjs"
```

So both `node scripts/...` and `pnpm setup:owner <email>` work.

### Documentation touch

`apps/admin/README.md` already documents the admin app's setup steps. Add a
short paragraph after the seed step pointing at `pnpm setup:owner` for the
"I just signed up and the admin UI 404s on every write" case.

## Out of scope

- Roles other than `OWNER`.
- Multiple orgs or a `--org` flag.
- Demoting / removing membership.
- A web-facing onboarding flow.
- Calling the script automatically (e.g. from setup-env or post-install).

## Alternatives considered

- **Extend `pnpm -F api seed` with `BOOTSTRAP_OWNER_EMAIL`** — couples seed
  to a runtime concern, and the seed runs before any user has signed up the
  first time. Rejected.
- **Auto-promote first signin to admin** — simpler UX, but quietly leaks
  privilege to whichever browser hits `/admin/auth/login` first. Wrong
  default for anything that isn't strictly local.
- **psql one-liner in a README snippet** — what the smoke does today.
  Discoverable only if you find the right docs; this script raises that
  discoverability without much added complexity.

## Verification

After implementation:

1. Sign up a fresh user via accounts (any email).
2. Confirm `pnpm setup:owner <email>` prints `granted OWNER ...`.
3. Confirm a second run prints `already OWNER, nothing to do`.
4. Confirm an unknown email prints the "sign up first" hint and exits non-zero.
5. Confirm the admin UI's `/labels` page now lists the seeded labels (no
   404), and label CRUD succeeds.
