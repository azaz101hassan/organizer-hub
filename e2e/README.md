# e2e

End-to-end browser tests for the `member` and `admin` web apps using `@playwright/test`.

## Prerequisites

1. All four apps running locally:
   - `apps/api` on port 3001
   - `apps/accounts` on port 3002
   - `apps/member` on port 3000
   - `apps/admin` on port 3003
2. Seeds applied: `pnpm -F accounts seed && pnpm -F api seed`
3. Browsers installed: `pnpm -F @organizer-hub/e2e install:browsers`

## Running

From the repo root:

```
pnpm e2e             # both projects
pnpm e2e:member      # member project only
pnpm e2e:admin       # admin project only
```

Or from inside `e2e/`:

```
pnpm test            # both projects
pnpm test:member     # member project only
pnpm test:admin      # admin project only
pnpm test:headed     # headed mode
pnpm test:ui         # interactive UI
pnpm report          # open the last HTML report
```

## How auth works

`global-setup.ts` runs once before any project starts. It signs up a fresh user against `accounts:3002`, grants the user OWNER on the house org via `psql`, then opens each app and persists the authenticated browser state to `e2e/.auth/member.json` and `e2e/.auth/admin.json`. Each project's specs reuse the right storage state automatically.

`.auth/` is gitignored. A fresh `pnpm e2e` run regenerates it.

## Notes

- Not wired into CI. Run on demand against a running local stack.
- The admin `event-publish.spec.ts` is the only spec that uses both browser contexts (admin publishes, then a member context verifies visibility).
