# @organizer-hub/db

Holds Prisma schemas for OrganizerHub's two bounded contexts. Each context has its own database and its own generated client — they share no tables.

| Schema | DB | Consumer |
|---|---|---|
| `accounts/schema.prisma` | `accounts_db` | `apps/accounts` (OIDC IdP) |
| `api/schema.prisma` | `organizer_db` | `apps/api` |

## Commands (from this package)

```bash
pnpm generate                  # regenerate both clients
pnpm migrate:accounts:dev      # run a dev migration on accounts
pnpm migrate:api:dev           # run a dev migration on api
pnpm studio:accounts           # open Prisma Studio on accounts DB
pnpm studio:api                # open Prisma Studio on api DB
```

Env vars (`.env` at repo root): `ACCOUNTS_DATABASE_URL`, `API_DATABASE_URL`.
