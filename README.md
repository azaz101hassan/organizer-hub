# OrganizerHub

Unified dashboard for event organizers — attacking the fragmented US ticketing stack with one pane of glass for sales, attendees, communications, and check-in.

## Stack

- **Monorepo:** Turborepo + pnpm workspaces
- **Frontend:** Next.js (App Router, TypeScript)
- **Backend:** NestJS (TypeScript)
- **Database:** PostgreSQL + Prisma
- **Auth:** OAuth2/OIDC — custom Identity Provider (`apps/accounts`) using `node-oidc-provider`
- **Payments:** Stripe Checkout (one-time tickets) + Stripe Subscriptions (memberships)

## Apps

| App | Port | Purpose |
|---|---|---|
| `apps/web` | 3000 | Next.js — organizer dashboard + public event pages (OAuth client) |
| `apps/api` | 3001 | NestJS — events, tickets, memberships, Stripe webhooks |
| `apps/accounts` | 3002 | NestJS — OAuth2/OIDC Identity Provider |

## Packages

| Package | Purpose |
|---|---|
| `packages/db` | Prisma schemas + clients (separate per bounded context) |
| `packages/types` | Shared DTOs and types |
| `packages/ui` | Shared React components |
| `packages/config` | ESLint, TSConfig, Prettier presets |

## Prerequisites

- Node 24+ (via `nvm install --lts`)
- pnpm (via `corepack enable`)
- PostgreSQL 16+ running locally (`brew install postgresql@16 && brew services start postgresql@16`)

## Getting started

```bash
pnpm install
cp .env.example .env
pnpm dev
```

## Phases

- **Phase 0** — Monorepo scaffold + tooling (current)
- **Phase 1** — Accounts service (OIDC IdP) with signup/login
- **Phase 2** — Organizer onboarding + event CRUD (OAuth client)
- **Phase 3** — Stripe Checkout for one-time tickets
- **Phase 4** — Stripe Subscriptions for memberships + coverage logic
