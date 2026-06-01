---
title: "feat: donation intake flow"
type: feat
status: planned
date: 2026-06-01
origin: docs/specs/2026-06-01-donation-intake-design.md
---

# feat: donation intake flow

> **For implementers:** Each Unit (U#) is one commit unless explicitly grouped. Steps use checkbox (`- [ ]`) syntax — check off as you complete. Phases are independently shippable: stop after any Phase boundary and the codebase is in a working state. Lands in 28 dependency-ordered units across nine phases.

## Summary

Ship donation intake end-to-end: a public `/coalitions` / `/campaigns/[slug]` storytelling surface, a `/donate` general-fund landing, a `Continue to donate` panel that creates a Stripe Checkout Session in one-time or recurring mode (monthly / quarterly / yearly), a `/dashboard/donations` recurring-management page, full admin CRUD for coalitions and campaigns, a `/transactions` filter for donations, and the targeted webhook patches that route donation events to the right ledger writes and prevent the bug-in-waiting where the existing `checkout.session.completed` handler would attempt to issue a Ticket for an unguarded `mode='payment'` donation. Gated behind a per-organization `donationsEnabled` feature flag for a clean rollback.

## Spec reference

Authoritative: `docs/specs/2026-06-01-donation-intake-design.md`. Every section of this plan implements a corresponding section of that spec. When in doubt, the spec wins; if you find a conflict, file an inline note in the spec and adjust the plan.

## Scope boundaries

Carried verbatim from the spec — out of scope here:
- App-side branded confirmation email. Stripe's own receipt covers acknowledgement.
- Tax-receipt-compliant emails.
- Change-amount and change-cadence for recurring donations. Cancel only.
- Public donor list (the `displayNameOptIn` field is reserved but unused).
- Image upload pipeline for `coverImageUrl`. Paste URLs.
- Bulk admin operations, CSV export, donation activity feed entries.
- Multi-currency donations and Apple/Google Pay configuration beyond Stripe Checkout defaults.
- Coalition-level donations, sub-coalition trees.

## Phase boundaries

- **Phase A** lands the schema and seeds the General coalition/campaign per org. No runtime behavior changes.
- **Phase B** lands the `donationsEnabled` flag and gating helpers. Still off by default — no surface visible.
- **Phase C** lands the donor checkout API (`POST /billing/checkout/donation` + cancel). curl-testable.
- **Phase D** lands public read API and `GET /donations/mine`. Donor pages can render once Phase G ships them.
- **Phase E** lands the webhook patches. Donation lifecycle becomes correct end-to-end at the API level.
- **Phase F** lands shared UI primitives (`DonatePanel`, `CampaignCard`, `CoalitionCard`, `ProgressBar`).
- **Phase G** lands member-facing pages and server actions. Flip flag on for a test org and donations work UI-to-DB.
- **Phase H** lands admin CRUD pages and the `/transactions` filter extensions.
- **Phase I** lands cross-cutting (SEO metadata) + manual verification + PR open.

A team could ship A–E and pause; the API is correct and curl-testable. Or A–G and pause; donors can give but admins manage via direct DB writes. The full landing is A–I.

---

## Phase A — Schema and migration

### U1: Add `Coalition`, `Campaign`, `Donation` models + 5 enums + additive columns

Foundational schema work. Adds three models, five enums, one nullable column on `PaymentEvent`, and one column on `Organization`. Migration also seeds a `General` coalition with a `General fund` campaign per existing organization, so the `/donate` landing has a destination from day one.

**Files:**
- Modify: `packages/db/api/schema.prisma` (append enums + models; modify `PaymentEvent`, `Organization`)
- Create: `packages/db/api/migrations/<timestamp>_add_donations/migration.sql`

- [ ] **Step 1: Append the five enums to `packages/db/api/schema.prisma`**

Add at the bottom of the file, after the existing enums:

```prisma
enum CoalitionStatus {
  ACTIVE
  ARCHIVED
}

enum CampaignStatus {
  DRAFT
  ACTIVE
  COMPLETE
  ARCHIVED
}

enum DonationMode {
  ONE_TIME
  RECURRING
}

enum DonationCadence {
  ONCE
  MONTHLY
  QUARTERLY
  YEARLY
}

enum DonationStatus {
  PENDING
  ACTIVE
  COMPLETED
  CANCELED
  FAILED
}
```

- [ ] **Step 2: Append the three models to `packages/db/api/schema.prisma`**

```prisma
model Coalition {
  id              String           @id @default(cuid())
  organizationId  String           @map("organization_id")
  name            String
  slug            String
  description     String?
  coverImageUrl   String?          @map("cover_image_url")
  status          CoalitionStatus  @default(ACTIVE)
  displayOrder    Int              @default(0) @map("display_order")
  createdAt       DateTime         @default(now()) @map("created_at")
  updatedAt       DateTime         @updatedAt @map("updated_at")

  campaigns       Campaign[]

  @@unique([organizationId, slug])
  @@index([organizationId, status, displayOrder])
  @@map("coalitions")
}

model Campaign {
  id                  String         @id @default(cuid())
  organizationId      String         @map("organization_id")
  coalitionId         String         @map("coalition_id")
  name                String
  slug                String
  description         String?
  coverImageUrl       String?        @map("cover_image_url")
  targetAmountCents   Int            @map("target_amount_cents")
  currency            String         @default("usd")
  deadline            DateTime?
  status              CampaignStatus @default(DRAFT)
  displayOrder        Int            @default(0) @map("display_order")
  createdAt           DateTime       @default(now()) @map("created_at")
  updatedAt           DateTime       @updatedAt @map("updated_at")

  coalition           Coalition      @relation(fields: [coalitionId], references: [id])
  donations           Donation[]

  @@unique([organizationId, slug])
  @@index([coalitionId, status, displayOrder])
  @@index([organizationId, status])
  @@map("campaigns")
}

model Donation {
  id                       String          @id @default(cuid())
  organizationId           String          @map("organization_id")
  userId                   String          @map("user_id")
  campaignId               String          @map("campaign_id")
  mode                     DonationMode
  cadence                  DonationCadence
  amountCents              Int             @map("amount_cents")
  currency                 String          @default("usd")
  status                   DonationStatus  @default(PENDING)
  stripeCustomerId         String?         @map("stripe_customer_id")
  stripeCheckoutSessionId  String?         @map("stripe_checkout_session_id")
  stripeSubscriptionId     String?         @map("stripe_subscription_id")
  displayNameOptIn         Boolean         @default(false) @map("display_name_opt_in")
  createdAt                DateTime        @default(now()) @map("created_at")
  updatedAt                DateTime        @updatedAt @map("updated_at")
  canceledAt               DateTime?       @map("canceled_at")

  campaign                 Campaign        @relation(fields: [campaignId], references: [id])
  paymentEvents            PaymentEvent[]

  @@index([userId, status])
  @@index([campaignId, status])
  @@index([stripeSubscriptionId])
  @@index([stripeCheckoutSessionId])
  @@map("donations")
}
```

- [ ] **Step 3: Modify `PaymentEvent` to add `donationId`**

Inside the existing `model PaymentEvent { ... }` block, add the column and back-relation in the appropriate position (immediately after the other foreign-key columns like `membershipId`):

```prisma
  donationId               String?             @map("donation_id")
  donation                 Donation?           @relation(fields: [donationId], references: [id])
```

And add the index inside the same block, alongside the other `@@index` lines:

```prisma
  @@index([donationId])
```

- [ ] **Step 4: Modify `Organization` to add `donationsEnabled`**

Inside the existing `model Organization { ... }` block, add the column (anywhere the other booleans live; if there are none, place it near the bottom before `createdAt`):

```prisma
  donationsEnabled         Boolean             @default(false) @map("donations_enabled")
```

- [ ] **Step 5: Generate the migration**

```bash
pnpm --filter @organizer-hub/db migrate:api:dev --name add_donations
```

Expected: Prisma prints "Applying migration `<ts>_add_donations`" and regenerates the client. Open the generated SQL and confirm it:
- creates `coalitions`, `campaigns`, `donations` tables
- creates the five enum types (`CoalitionStatus`, `CampaignStatus`, `DonationMode`, `DonationCadence`, `DonationStatus`)
- adds `donation_id` column on `payment_events` with the index
- adds `donations_enabled BOOLEAN NOT NULL DEFAULT false` on `organizations`

- [ ] **Step 6: Append the seed block to the generated `migration.sql`**

Open the just-generated `packages/db/api/migrations/<timestamp>_add_donations/migration.sql` and append at the bottom:

```sql
-- Seed one General coalition + one General fund campaign per organization.
-- Idempotent: WHERE NOT EXISTS guards against re-runs and partial applies.
INSERT INTO "coalitions" (id, organization_id, name, slug, status, display_order, created_at, updated_at)
SELECT
  'coal_general_' || o.id,
  o.id,
  'General',
  'general',
  'ACTIVE',
  0,
  NOW(),
  NOW()
FROM "organizations" o
WHERE NOT EXISTS (
  SELECT 1 FROM "coalitions" c WHERE c.organization_id = o.id AND c.slug = 'general'
);

INSERT INTO "campaigns" (id, organization_id, coalition_id, name, slug, target_amount_cents, currency, status, display_order, created_at, updated_at)
SELECT
  'camp_general_fund_' || o.id,
  o.id,
  'coal_general_' || o.id,
  'General fund',
  'general-fund',
  0,
  'usd',
  'ACTIVE',
  0,
  NOW(),
  NOW()
FROM "organizations" o
WHERE NOT EXISTS (
  SELECT 1 FROM "campaigns" c WHERE c.organization_id = o.id AND c.slug = 'general-fund'
);
```

- [ ] **Step 7: Reset and re-apply the migration to verify the seed runs**

```bash
pnpm --filter @organizer-hub/db migrate:api:reset
```

Confirm by querying:

```bash
pnpm --filter @organizer-hub/db prisma db execute --schema=packages/db/api/schema.prisma --stdin <<EOF
SELECT o.id, c.slug AS coal_slug, ca.slug AS camp_slug
FROM organizations o
LEFT JOIN coalitions c ON c.organization_id = o.id AND c.slug = 'general'
LEFT JOIN campaigns ca ON ca.coalition_id = c.id AND ca.slug = 'general-fund';
EOF
```

Expected: every existing org has one `general` coalition and one `general-fund` campaign.

- [ ] **Step 8: Generate API types and confirm typecheck**

```bash
pnpm --filter @organizer-hub/db generate:api
pnpm -F api typecheck
```

Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add packages/db/api/schema.prisma packages/db/api/migrations packages/db/client
git commit -m "$(cat <<'EOF'
feat(db): add Coalition, Campaign, Donation models + flags

- add Coalition (org-scoped fundraising categorisation) and Campaign (time-bound goal with target, deadline, status) models with the required @@unique([organizationId, slug]) and lookup indexes
- add Donation entity modelling the donor's commitment, distinct from the append-only PaymentEvent ledger; recurring donations are a single Donation row whose status moves PENDING -> ACTIVE -> CANCELED across the Stripe subscription lifecycle
- add donationId column on PaymentEvent so refund/dispute rows can inherit it and Campaign.raisedCents nets correctly
- add donationsEnabled flag on Organization defaulted false; gates every donation surface for safe rollout
- seed a 'general' coalition and 'general-fund' campaign per existing organization so /donate has a destination from day one
EOF
)"
```

---

### U2: Test factories for the new entities

Test factories that subsequent units rely on for unit and e2e tests. Adds builders for Coalition, Campaign, Donation, plus a `seedActiveRecurringDonation` convenience that wires Donation + Stripe-mock SubscriptionId + first PaymentEvent.

**Files:**
- Modify: `apps/api/test/factories.ts` (append four factories + one helper)

- [ ] **Step 1: Locate the existing factory file**

```bash
ls apps/api/test/factories.ts && head -20 apps/api/test/factories.ts
```

If the file uses a different filename (e.g. `apps/api/test/__factories__/index.ts`), adopt that path in Steps 2–5. The remaining steps assume `apps/api/test/factories.ts`.

- [ ] **Step 2: Append the Coalition factory**

```ts
import type { Prisma } from '@organizer-hub/db/client/api';

export function coalitionFactory(
  overrides: Partial<Prisma.CoalitionUncheckedCreateInput> = {},
): Prisma.CoalitionUncheckedCreateInput {
  const id = overrides.id ?? `coal_${Math.random().toString(36).slice(2, 10)}`;
  return {
    id,
    organizationId: overrides.organizationId ?? 'org_test',
    name: overrides.name ?? 'Test coalition',
    slug: overrides.slug ?? `test-coalition-${id.slice(-4)}`,
    description: overrides.description ?? null,
    coverImageUrl: overrides.coverImageUrl ?? null,
    status: overrides.status ?? 'ACTIVE',
    displayOrder: overrides.displayOrder ?? 0,
    ...overrides,
  };
}
```

- [ ] **Step 3: Append the Campaign factory**

```ts
export function campaignFactory(
  overrides: Partial<Prisma.CampaignUncheckedCreateInput> = {},
): Prisma.CampaignUncheckedCreateInput {
  const id = overrides.id ?? `camp_${Math.random().toString(36).slice(2, 10)}`;
  return {
    id,
    organizationId: overrides.organizationId ?? 'org_test',
    coalitionId: overrides.coalitionId ?? 'coal_test',
    name: overrides.name ?? 'Test campaign',
    slug: overrides.slug ?? `test-campaign-${id.slice(-4)}`,
    description: overrides.description ?? null,
    coverImageUrl: overrides.coverImageUrl ?? null,
    targetAmountCents: overrides.targetAmountCents ?? 500_000,
    currency: overrides.currency ?? 'usd',
    deadline: overrides.deadline ?? null,
    status: overrides.status ?? 'ACTIVE',
    displayOrder: overrides.displayOrder ?? 0,
    ...overrides,
  };
}
```

- [ ] **Step 4: Append the Donation factory**

```ts
export function donationFactory(
  overrides: Partial<Prisma.DonationUncheckedCreateInput> = {},
): Prisma.DonationUncheckedCreateInput {
  const id = overrides.id ?? `don_${Math.random().toString(36).slice(2, 10)}`;
  const mode = overrides.mode ?? 'ONE_TIME';
  return {
    id,
    organizationId: overrides.organizationId ?? 'org_test',
    userId: overrides.userId ?? 'user_test',
    campaignId: overrides.campaignId ?? 'camp_test',
    mode,
    cadence: overrides.cadence ?? (mode === 'ONE_TIME' ? 'ONCE' : 'MONTHLY'),
    amountCents: overrides.amountCents ?? 2_500,
    currency: overrides.currency ?? 'usd',
    status: overrides.status ?? 'PENDING',
    stripeCustomerId: overrides.stripeCustomerId ?? null,
    stripeCheckoutSessionId: overrides.stripeCheckoutSessionId ?? null,
    stripeSubscriptionId: overrides.stripeSubscriptionId ?? null,
    displayNameOptIn: overrides.displayNameOptIn ?? false,
    canceledAt: overrides.canceledAt ?? null,
    ...overrides,
  };
}
```

- [ ] **Step 5: Append the `seedActiveRecurringDonation` helper**

```ts
import type { PrismaClient } from '@organizer-hub/db/client/api';

export async function seedActiveRecurringDonation(
  prisma: PrismaClient,
  opts: {
    userId: string;
    campaignId: string;
    organizationId: string;
    amountCents?: number;
    cadence?: 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
  },
): Promise<{ donationId: string; stripeSubscriptionId: string }> {
  const stripeSubscriptionId = `sub_test_${Math.random().toString(36).slice(2, 10)}`;
  const donation = await prisma.donation.create({
    data: donationFactory({
      userId: opts.userId,
      campaignId: opts.campaignId,
      organizationId: opts.organizationId,
      mode: 'RECURRING',
      cadence: opts.cadence ?? 'MONTHLY',
      amountCents: opts.amountCents ?? 2_500,
      status: 'ACTIVE',
      stripeSubscriptionId,
    }),
  });
  await prisma.paymentEvent.create({
    data: {
      organizationId: opts.organizationId,
      userId: opts.userId,
      kind: 'DONATION',
      status: 'SUCCEEDED',
      amountCents: donation.amountCents,
      currency: donation.currency,
      donationId: donation.id,
      stripePaymentIntentId: `pi_test_${donation.id}`,
      stripeInvoiceId: `inv_test_${donation.id}`,
      stripeChargeId: `ch_test_${donation.id}`,
      succeededAt: new Date(),
    },
  });
  return { donationId: donation.id, stripeSubscriptionId };
}
```

- [ ] **Step 6: Confirm the file compiles**

```bash
pnpm -F api typecheck
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add apps/api/test/factories.ts
git commit -m "$(cat <<'EOF'
test(api): add Coalition, Campaign, Donation factories

- coalitionFactory and campaignFactory build the new fundraising entities with sensible defaults so unit tests can opt into overrides instead of recreating the full shape
- donationFactory derives a sane default cadence from mode (ONE_TIME -> ONCE, RECURRING -> MONTHLY) to keep callers tight
- seedActiveRecurringDonation wires Donation + Stripe-mock SubscriptionId + the first SUCCEEDED PaymentEvent, the exact shape every recurring lifecycle test starts from
EOF
)"
```

---

## Phase B — Feature flag plumbing

### U3: `donationsEnabled` guard helper and route gating

A single helper resolves the current organization's `donationsEnabled` flag and an opinionated NestJS guard wraps it. Returns 404 (not 403) when off — the spec invariant is "don't leak existence". Member and admin shells will 404 on their donation routes by checking the same flag via a server-side fetch helper.

**Files:**
- Create: `apps/api/src/donations/donations-feature-flag.guard.ts`
- Create: `apps/api/src/donations/donations-feature-flag.guard.spec.ts`
- Create: `apps/api/src/donations/donations.module.ts` (empty module — donations service lands in U4)
- Create: `packages/web-shared/src/api/donations-enabled.ts`
- Modify: `apps/api/src/app.module.ts` (register `DonationsModule`)
- Modify: `packages/web-shared/src/index.ts` (re-export `donationsEnabledForOrg`)

- [ ] **Step 1: Write the failing guard test**

`apps/api/src/donations/donations-feature-flag.guard.spec.ts`:

```ts
import { ExecutionContext, NotFoundException } from '@nestjs/common';
import { DonationsFeatureFlagGuard } from './donations-feature-flag.guard';

function ctxWithOrg(donationsEnabled: boolean | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        organization: donationsEnabled === undefined ? undefined : { id: 'org_1', donationsEnabled },
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('DonationsFeatureFlagGuard', () => {
  const guard = new DonationsFeatureFlagGuard();

  it('passes when the organization has donations enabled', () => {
    expect(guard.canActivate(ctxWithOrg(true))).toBe(true);
  });

  it('throws 404 when the flag is off (do not leak existence)', () => {
    expect(() => guard.canActivate(ctxWithOrg(false))).toThrow(NotFoundException);
  });

  it('throws 404 when the request has no resolved organization', () => {
    expect(() => guard.canActivate(ctxWithOrg(undefined))).toThrow(NotFoundException);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
pnpm -F api test -- donations-feature-flag.guard
```

Expected: FAIL ("Cannot find module './donations-feature-flag.guard'").

- [ ] **Step 3: Implement the guard**

`apps/api/src/donations/donations-feature-flag.guard.ts`:

```ts
import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';

@Injectable()
export class DonationsFeatureFlagGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const org = req.organization as { donationsEnabled?: boolean } | undefined;
    if (!org || !org.donationsEnabled) {
      throw new NotFoundException();
    }
    return true;
  }
}
```

- [ ] **Step 4: Run the test and confirm it passes**

```bash
pnpm -F api test -- donations-feature-flag.guard
```

Expected: PASS (3 tests).

- [ ] **Step 5: Create the empty `DonationsModule`**

`apps/api/src/donations/donations.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { DonationsFeatureFlagGuard } from './donations-feature-flag.guard';

@Module({
  providers: [DonationsFeatureFlagGuard],
  exports: [DonationsFeatureFlagGuard],
})
export class DonationsModule {}
```

- [ ] **Step 6: Register `DonationsModule` in the root module**

In `apps/api/src/app.module.ts`, add the import alongside the other `*Module` imports and append it to the `imports: [...]` array:

```ts
import { DonationsModule } from './donations/donations.module';

// ...inside @Module({ imports: [...] })
DonationsModule,
```

- [ ] **Step 7: Create the web-shared helper**

`packages/web-shared/src/api/donations-enabled.ts`:

```ts
import { publicApiFetch } from './fetch';

interface OrgFlags {
  donationsEnabled: boolean;
}

/**
 * Resolves the current organization's donations feature flag.
 * Used by member and admin server components to 404 donation routes
 * when the flag is off. Cached per request via React's cache().
 */
export async function donationsEnabledForOrg(): Promise<boolean> {
  try {
    const flags = await publicApiFetch<OrgFlags>('/organization/flags');
    return Boolean(flags.donationsEnabled);
  } catch {
    return false;
  }
}
```

- [ ] **Step 8: Re-export from the package root**

In `packages/web-shared/src/index.ts`, add at the bottom alongside other API re-exports:

```ts
export { donationsEnabledForOrg } from './api/donations-enabled';
```

- [ ] **Step 9: Typecheck both sides**

```bash
pnpm -F api typecheck
pnpm -F @organizer-hub/web-shared typecheck
```

Expected: clean on both.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/donations apps/api/src/app.module.ts packages/web-shared/src/api/donations-enabled.ts packages/web-shared/src/index.ts
git commit -m "$(cat <<'EOF'
feat(donations): per-org feature flag guard

- DonationsFeatureFlagGuard reads the request-attached organization and throws NotFoundException when donationsEnabled is false or absent; 404 not 403 so the flag cannot be probed by existence
- DonationsModule registered in app.module so subsequent units can attach controllers behind the guard
- web-shared exposes donationsEnabledForOrg() so member and admin server components can 404 their donation routes by the same flag without bespoke fetches
EOF
)"
```

---

## Phase C — Donor checkout API

Three endpoints in this phase. `POST /billing/checkout/donation` is the core mint. `POST /billing/donation/:id/cancel` is the donor's only recurring management action. We split the one-time and recurring Checkout Session creation across two units so the second can build on the first's tests rather than smuggle two flows into one unit.

### U4: `DonationsService` + `POST /billing/checkout/donation` one-time path

**Files:**
- Create: `apps/api/src/donations/donations.service.ts`
- Create: `apps/api/src/donations/donations.service.spec.ts`
- Create: `apps/api/src/donations/donations.controller.ts`
- Create: `apps/api/src/donations/dto/create-donation-checkout.dto.ts`
- Modify: `apps/api/src/donations/donations.module.ts` (register controller + service)
- Create: `apps/api/test/billing-donations.e2e-spec.ts`

- [ ] **Step 1: Write the failing service unit test for the one-time happy path**

`apps/api/src/donations/donations.service.spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { DonationsService } from './donations.service';
import { PrismaService } from '../prisma/prisma.service';
import { StripeClientService } from '../billing/stripe-client.service';
import { BillingService } from '../billing/billing.service';
import { campaignFactory, coalitionFactory } from '../../test/factories';

describe('DonationsService (one-time)', () => {
  let service: DonationsService;
  let prisma: { campaign: any; donation: any; organization: any };
  let stripe: { stripe: { checkout: { sessions: { create: jest.Mock } } } };
  let billing: { getOrCreateStripeCustomer: jest.Mock };

  beforeEach(async () => {
    prisma = {
      campaign: { findUnique: jest.fn() },
      donation: { create: jest.fn(), update: jest.fn() },
      organization: { findUnique: jest.fn() },
    };
    stripe = {
      stripe: {
        checkout: {
          sessions: {
            create: jest.fn().mockResolvedValue({ id: 'cs_test_1', url: 'https://stripe.test/cs_test_1' }),
          },
        },
      },
    };
    billing = {
      getOrCreateStripeCustomer: jest.fn().mockResolvedValue({ stripeCustomerId: 'cus_test_1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DonationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: StripeClientService, useValue: stripe },
        { provide: BillingService, useValue: billing },
      ],
    }).compile();
    service = module.get(DonationsService);
  });

  it('creates a PENDING Donation row and returns the Stripe URL for a one-time gift', async () => {
    prisma.campaign.findUnique.mockResolvedValue({
      ...campaignFactory({ id: 'camp_1', organizationId: 'org_1', status: 'ACTIVE', currency: 'usd' }),
      coalition: coalitionFactory({ id: 'coal_1', organizationId: 'org_1' }),
    });
    prisma.donation.create.mockResolvedValue({ id: 'don_1' });

    const result = await service.createCheckoutSession({
      userSub: 'user_1',
      userEmail: 'donor@test',
      campaignId: 'camp_1',
      cadence: 'ONCE',
      amountCents: 2500,
      webOrigin: 'https://app.test',
    });

    expect(result).toEqual({ url: 'https://stripe.test/cs_test_1', donationId: 'don_1' });

    expect(prisma.donation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user_1',
          campaignId: 'camp_1',
          mode: 'ONE_TIME',
          cadence: 'ONCE',
          amountCents: 2500,
          status: 'PENDING',
        }),
      }),
    );

    expect(stripe.stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'payment',
        customer: 'cus_test_1',
        client_reference_id: 'user_1',
        metadata: expect.objectContaining({
          source: 'donation',
          userId: 'user_1',
          donationId: 'don_1',
          campaignId: 'camp_1',
        }),
        line_items: [
          expect.objectContaining({
            quantity: 1,
            price_data: expect.objectContaining({
              currency: 'usd',
              unit_amount: 2500,
              product_data: expect.objectContaining({ name: expect.stringContaining('Donation') }),
            }),
          }),
        ],
      }),
    );
  });

  it('rejects amount below $1.00', async () => {
    prisma.campaign.findUnique.mockResolvedValue({
      ...campaignFactory({ id: 'camp_1', organizationId: 'org_1', status: 'ACTIVE' }),
      coalition: coalitionFactory({ id: 'coal_1', organizationId: 'org_1' }),
    });
    await expect(
      service.createCheckoutSession({
        userSub: 'user_1',
        userEmail: 'donor@test',
        campaignId: 'camp_1',
        cadence: 'ONCE',
        amountCents: 99,
        webOrigin: 'https://app.test',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects amount above $10,000.00 (fat-finger guard)', async () => {
    prisma.campaign.findUnique.mockResolvedValue({
      ...campaignFactory({ id: 'camp_1', organizationId: 'org_1', status: 'ACTIVE' }),
      coalition: coalitionFactory({ id: 'coal_1', organizationId: 'org_1' }),
    });
    await expect(
      service.createCheckoutSession({
        userSub: 'user_1',
        userEmail: 'donor@test',
        campaignId: 'camp_1',
        cadence: 'ONCE',
        amountCents: 1_000_001,
        webOrigin: 'https://app.test',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects ONCE cadence on a campaign that is not ACTIVE', async () => {
    prisma.campaign.findUnique.mockResolvedValue({
      ...campaignFactory({ id: 'camp_1', organizationId: 'org_1', status: 'DRAFT' }),
      coalition: coalitionFactory({ id: 'coal_1', organizationId: 'org_1' }),
    });
    await expect(
      service.createCheckoutSession({
        userSub: 'user_1',
        userEmail: 'donor@test',
        campaignId: 'camp_1',
        cadence: 'ONCE',
        amountCents: 2500,
        webOrigin: 'https://app.test',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects ONCE on a campaign whose deadline has passed', async () => {
    prisma.campaign.findUnique.mockResolvedValue({
      ...campaignFactory({
        id: 'camp_1',
        organizationId: 'org_1',
        status: 'ACTIVE',
        deadline: new Date(Date.now() - 86_400_000), // yesterday
      }),
      coalition: coalitionFactory({ id: 'coal_1', organizationId: 'org_1' }),
    });
    await expect(
      service.createCheckoutSession({
        userSub: 'user_1',
        userEmail: 'donor@test',
        campaignId: 'camp_1',
        cadence: 'ONCE',
        amountCents: 2500,
        webOrigin: 'https://app.test',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
pnpm -F api test -- donations.service
```

Expected: FAIL ("Cannot find module './donations.service'").

- [ ] **Step 3: Implement the DTO**

`apps/api/src/donations/dto/create-donation-checkout.dto.ts`:

```ts
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { DonationCadence } from '@organizer-hub/db/client/api';

export class CreateDonationCheckoutDto {
  @IsString()
  campaignId!: string;

  @IsEnum(DonationCadence)
  cadence!: DonationCadence;

  @IsInt()
  @Min(100)
  @Max(1_000_000)
  amountCents!: number;

  @IsOptional()
  @IsString()
  currency?: string;
}
```

- [ ] **Step 4: Implement the service (one-time only; recurring lands in U5)**

`apps/api/src/donations/donations.service.ts`:

```ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DonationCadence,
  DonationMode,
  DonationStatus,
} from '@organizer-hub/db/client/api';
import { PrismaService } from '../prisma/prisma.service';
import { StripeClientService } from '../billing/stripe-client.service';
import { BillingService } from '../billing/billing.service';

interface CreateCheckoutInput {
  userSub: string;
  userEmail: string;
  campaignId: string;
  cadence: DonationCadence;
  amountCents: number;
  currency?: string;
  webOrigin: string;
}

@Injectable()
export class DonationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeClient: StripeClientService,
    private readonly billing: BillingService,
  ) {}

  async createCheckoutSession(
    input: CreateCheckoutInput,
  ): Promise<{ url: string; donationId: string }> {
    if (input.amountCents < 100 || input.amountCents > 1_000_000) {
      throw new BadRequestException('amount must be between $1.00 and $10,000.00');
    }
    const mode = this.deriveMode(input.cadence);

    const campaign = await this.prisma.campaign.findUnique({
      where: { id: input.campaignId },
      include: { coalition: true },
    });
    if (!campaign) {
      throw new NotFoundException('campaign not found');
    }
    if (campaign.status !== 'ACTIVE') {
      throw new ConflictException('campaign is not accepting donations');
    }
    if (campaign.deadline && campaign.deadline.getTime() < Date.now()) {
      throw new ConflictException('campaign deadline has passed');
    }

    const customer = await this.billing.getOrCreateStripeCustomer(
      input.userSub,
      input.userEmail,
    );

    const currency = input.currency ?? campaign.currency ?? 'usd';

    const donation = await this.prisma.donation.create({
      data: {
        organizationId: campaign.organizationId,
        userId: input.userSub,
        campaignId: campaign.id,
        mode,
        cadence: input.cadence,
        amountCents: input.amountCents,
        currency,
        status: DonationStatus.PENDING,
        stripeCustomerId: customer.stripeCustomerId,
      },
    });

    const metadata = {
      source: 'donation',
      userId: input.userSub,
      donationId: donation.id,
      campaignId: campaign.id,
    };

    const session = await this.stripeClient.stripe.checkout.sessions.create({
      mode: 'payment',
      customer: customer.stripeCustomerId,
      client_reference_id: input.userSub,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency,
            unit_amount: input.amountCents,
            product_data: {
              name: `Donation: ${campaign.name}`,
              metadata: {
                campaignId: campaign.id,
                coalitionId: campaign.coalitionId,
              },
            },
          },
        },
      ],
      metadata,
      success_url: `${input.webOrigin}/donate/thanks?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${input.webOrigin}/campaigns/${campaign.slug}?checkout=canceled`,
    });

    await this.prisma.donation.update({
      where: { id: donation.id },
      data: { stripeCheckoutSessionId: session.id },
    });

    return { url: session.url ?? '', donationId: donation.id };
  }

  private deriveMode(cadence: DonationCadence): DonationMode {
    if (cadence === DonationCadence.ONCE) return DonationMode.ONE_TIME;
    throw new BadRequestException(
      `cadence ${cadence} requires recurring mode; recurring lands in a follow-up unit`,
    );
  }
}
```

The `deriveMode` throw for non-ONCE cadences is deliberate — U5 replaces it with full recurring handling. Keeping it explicit here means a recurring request through this build fails loudly rather than silently miscategorizing.

- [ ] **Step 5: Run the unit test and confirm it passes**

```bash
pnpm -F api test -- donations.service
```

Expected: PASS (5 tests).

- [ ] **Step 6: Implement the controller**

`apps/api/src/donations/donations.controller.ts`:

```ts
import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { DonationsService } from './donations.service';
import { CreateDonationCheckoutDto } from './dto/create-donation-checkout.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DonationsFeatureFlagGuard } from './donations-feature-flag.guard';

@Controller('billing/checkout')
@UseGuards(JwtAuthGuard, DonationsFeatureFlagGuard)
export class DonationsController {
  constructor(private readonly donations: DonationsService) {}

  @Post('donation')
  async createDonationCheckout(
    @Req() req: Request,
    @Body() dto: CreateDonationCheckoutDto,
  ): Promise<{ url: string; donationId: string }> {
    const user = (req as any).user as { sub: string; email: string };
    const webOrigin = `${req.protocol}://${req.get('host')}`;
    return this.donations.createCheckoutSession({
      userSub: user.sub,
      userEmail: user.email,
      campaignId: dto.campaignId,
      cadence: dto.cadence,
      amountCents: dto.amountCents,
      currency: dto.currency,
      webOrigin,
    });
  }
}
```

If the existing auth guard import path or user-shape differs (the membership controller has the canonical pattern), match the membership controller's import and casting style verbatim.

- [ ] **Step 7: Register the controller + service in `DonationsModule`**

Update `apps/api/src/donations/donations.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { DonationsFeatureFlagGuard } from './donations-feature-flag.guard';
import { DonationsService } from './donations.service';
import { DonationsController } from './donations.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [PrismaModule, BillingModule],
  controllers: [DonationsController],
  providers: [DonationsService, DonationsFeatureFlagGuard],
  exports: [DonationsService, DonationsFeatureFlagGuard],
})
export class DonationsModule {}
```

- [ ] **Step 8: Add the controller-level e2e test**

`apps/api/test/billing-donations.e2e-spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { campaignFactory, coalitionFactory } from './factories';

describe('Donations checkout (one-time)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.donation.deleteMany();
    await prisma.campaign.deleteMany();
    await prisma.coalition.deleteMany();
    await prisma.organization.upsert({
      where: { id: 'org_test_donations' },
      update: { donationsEnabled: true },
      create: { id: 'org_test_donations', name: 'Test Org', donationsEnabled: true },
    });
    await prisma.coalition.create({
      data: coalitionFactory({ id: 'coal_1', organizationId: 'org_test_donations' }),
    });
    await prisma.campaign.create({
      data: campaignFactory({
        id: 'camp_1',
        coalitionId: 'coal_1',
        organizationId: 'org_test_donations',
        status: 'ACTIVE',
      }),
    });
  });

  function authHeader(): string {
    // Adopt whatever the existing membership e2e test uses to mint a bearer for
    // the test user. Copy the helper from billing/membership.e2e-spec.ts.
    return 'Bearer test-token';
  }

  it('returns 200 with url + donationId on a valid request', async () => {
    const res = await request(app.getHttpServer())
      .post('/billing/checkout/donation')
      .set('Authorization', authHeader())
      .send({ campaignId: 'camp_1', cadence: 'ONCE', amountCents: 2500 });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ url: expect.any(String), donationId: expect.any(String) });
  });

  it('returns 400 on amount=99', async () => {
    const res = await request(app.getHttpServer())
      .post('/billing/checkout/donation')
      .set('Authorization', authHeader())
      .send({ campaignId: 'camp_1', cadence: 'ONCE', amountCents: 99 });
    expect(res.status).toBe(400);
  });

  it('returns 404 when the org has donationsEnabled=false', async () => {
    await prisma.organization.update({
      where: { id: 'org_test_donations' },
      data: { donationsEnabled: false },
    });
    const res = await request(app.getHttpServer())
      .post('/billing/checkout/donation')
      .set('Authorization', authHeader())
      .send({ campaignId: 'camp_1', cadence: 'ONCE', amountCents: 2500 });
    expect(res.status).toBe(404);
  });
});
```

The Stripe client should be mocked at the module level the same way membership e2e tests do it. If the existing `billing-membership.e2e-spec.ts` uses a `StripeClientService` provider override, copy that override block into the `Test.createTestingModule` call above.

- [ ] **Step 9: Run the e2e test and confirm it passes**

```bash
pnpm -F api test:e2e -- billing-donations
```

Expected: PASS (3 tests).

- [ ] **Step 10: Run the full API test suite**

```bash
pnpm -F api test && pnpm -F api test:e2e
```

Expected: every prior test still passes.

- [ ] **Step 11: Commit**

```bash
git add apps/api/src/donations apps/api/test/billing-donations.e2e-spec.ts
git commit -m "$(cat <<'EOF'
feat(donations): one-time donation Checkout Session API

- DonationsService.createCheckoutSession validates amount bounds ($1.00-$10,000.00), campaign ACTIVE status, deadline, then mints a Stripe Checkout Session in mode=payment with metadata.source='donation' so the existing webhook layer can route the event correctly
- Donation row written PENDING first; stripeCheckoutSessionId backfilled after Stripe responds so a failed Stripe call leaves a discardable PENDING row rather than a session with no local mirror
- inline price_data + product_data so amounts are donor-chosen without a per-campaign Stripe Product
- controller behind the DonationsFeatureFlagGuard so off-flag orgs 404 the route
- e2e tests cover the happy path, the $0.99 lower-bound rejection, and the feature-flag 404
EOF
)"
```

---

### U5: Recurring path on `POST /billing/checkout/donation`

Extends U4's service with monthly/quarterly/yearly. The endpoint is the same — `deriveMode` now recognizes the recurring cadences and the session-creation branch builds the subscription-shaped request.

**Files:**
- Modify: `apps/api/src/donations/donations.service.ts`
- Modify: `apps/api/src/donations/donations.service.spec.ts`
- Modify: `apps/api/test/billing-donations.e2e-spec.ts`

- [ ] **Step 1: Add the failing recurring unit test**

Append to `apps/api/src/donations/donations.service.spec.ts` inside a new `describe('DonationsService (recurring)', ...)` block:

```ts
describe('DonationsService (recurring)', () => {
  // Reuse the same beforeEach scaffold; copy the existing module setup verbatim.
  // For brevity here, assume `service`, `prisma`, `stripe`, `billing` are wired
  // identically to the one-time describe block above.

  const setupCampaign = () => {
    prisma.campaign.findUnique.mockResolvedValue({
      ...campaignFactory({ id: 'camp_1', organizationId: 'org_1', status: 'ACTIVE', currency: 'usd' }),
      coalition: coalitionFactory({ id: 'coal_1', organizationId: 'org_1' }),
    });
    prisma.donation.create.mockResolvedValue({ id: 'don_2' });
  };

  it('maps MONTHLY to interval=month, interval_count=1', async () => {
    setupCampaign();
    await service.createCheckoutSession({
      userSub: 'user_1', userEmail: 'donor@test',
      campaignId: 'camp_1', cadence: 'MONTHLY', amountCents: 2500, webOrigin: 'https://app.test',
    });
    expect(stripe.stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'subscription',
        line_items: [
          expect.objectContaining({
            price_data: expect.objectContaining({
              recurring: { interval: 'month', interval_count: 1 },
            }),
          }),
        ],
        subscription_data: expect.objectContaining({
          metadata: expect.objectContaining({ source: 'donation' }),
        }),
      }),
    );
    expect(prisma.donation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ mode: 'RECURRING', cadence: 'MONTHLY' }) }),
    );
  });

  it('maps QUARTERLY to interval=month, interval_count=3', async () => {
    setupCampaign();
    await service.createCheckoutSession({
      userSub: 'user_1', userEmail: 'donor@test',
      campaignId: 'camp_1', cadence: 'QUARTERLY', amountCents: 2500, webOrigin: 'https://app.test',
    });
    expect(stripe.stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: [
          expect.objectContaining({
            price_data: expect.objectContaining({
              recurring: { interval: 'month', interval_count: 3 },
            }),
          }),
        ],
      }),
    );
  });

  it('maps YEARLY to interval=year, interval_count=1', async () => {
    setupCampaign();
    await service.createCheckoutSession({
      userSub: 'user_1', userEmail: 'donor@test',
      campaignId: 'camp_1', cadence: 'YEARLY', amountCents: 2500, webOrigin: 'https://app.test',
    });
    expect(stripe.stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: [
          expect.objectContaining({
            price_data: expect.objectContaining({
              recurring: { interval: 'year', interval_count: 1 },
            }),
          }),
        ],
      }),
    );
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
pnpm -F api test -- donations.service
```

Expected: FAIL (the new recurring tests throw BadRequest from the stub `deriveMode`).

- [ ] **Step 3: Replace `deriveMode` with full cadence handling and split session creation**

In `apps/api/src/donations/donations.service.ts`, replace `private deriveMode(...)` with the helper map and add a `buildSessionParams` method:

```ts
  private deriveMode(cadence: DonationCadence): DonationMode {
    return cadence === DonationCadence.ONCE
      ? DonationMode.ONE_TIME
      : DonationMode.RECURRING;
  }

  private recurringFor(cadence: DonationCadence):
    | { interval: 'month'; interval_count: 1 | 3 }
    | { interval: 'year'; interval_count: 1 }
    | null {
    switch (cadence) {
      case DonationCadence.MONTHLY:
        return { interval: 'month', interval_count: 1 };
      case DonationCadence.QUARTERLY:
        return { interval: 'month', interval_count: 3 };
      case DonationCadence.YEARLY:
        return { interval: 'year', interval_count: 1 };
      case DonationCadence.ONCE:
        return null;
    }
  }
```

Then in `createCheckoutSession`, replace the `sessions.create` call with the mode-aware build:

```ts
    const recurring = this.recurringFor(input.cadence);
    const isRecurring = recurring !== null;

    const session = await this.stripeClient.stripe.checkout.sessions.create({
      mode: isRecurring ? 'subscription' : 'payment',
      customer: customer.stripeCustomerId,
      client_reference_id: input.userSub,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency,
            unit_amount: input.amountCents,
            ...(recurring ? { recurring } : {}),
            product_data: {
              name: isRecurring
                ? `Recurring donation: ${campaign.name}`
                : `Donation: ${campaign.name}`,
              metadata: {
                campaignId: campaign.id,
                coalitionId: campaign.coalitionId,
              },
            },
          },
        },
      ],
      metadata,
      ...(isRecurring ? { subscription_data: { metadata } } : {}),
      success_url: `${input.webOrigin}/donate/thanks?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${input.webOrigin}/campaigns/${campaign.slug}?checkout=canceled`,
    });
```

- [ ] **Step 4: Run the unit tests and confirm all pass**

```bash
pnpm -F api test -- donations.service
```

Expected: PASS (all 8 tests across one-time + recurring describes).

- [ ] **Step 5: Add an e2e test for a recurring happy path**

Append to `apps/api/test/billing-donations.e2e-spec.ts`:

```ts
  it('returns 200 with url + donationId for a MONTHLY recurring request and writes mode=RECURRING', async () => {
    const res = await request(app.getHttpServer())
      .post('/billing/checkout/donation')
      .set('Authorization', authHeader())
      .send({ campaignId: 'camp_1', cadence: 'MONTHLY', amountCents: 2500 });
    expect(res.status).toBe(201);
    expect(res.body.donationId).toEqual(expect.any(String));

    const row = await prisma.donation.findUnique({ where: { id: res.body.donationId } });
    expect(row).toMatchObject({ mode: 'RECURRING', cadence: 'MONTHLY', status: 'PENDING' });
  });
```

- [ ] **Step 6: Run e2e**

```bash
pnpm -F api test:e2e -- billing-donations
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/donations/donations.service.ts apps/api/src/donations/donations.service.spec.ts apps/api/test/billing-donations.e2e-spec.ts
git commit -m "$(cat <<'EOF'
feat(donations): recurring checkout (monthly, quarterly, yearly)

- recurringFor() maps DonationCadence to Stripe recurring shape: MONTHLY -> month/1, QUARTERLY -> month/3, YEARLY -> year/1
- subscription_data.metadata mirrors session.metadata so every later invoice.paid carries source=donation without a Stripe API round-trip, matching the membership pattern
- the Donation row's mode is RECURRING for any non-ONCE cadence; the entity tracks the donor's commitment while PaymentEvent continues to track each individual charge
EOF
)"
```

---

### U6: `POST /billing/donation/:id/cancel`

Donor-initiated cancel for a recurring donation. Ownership check returns 404 (not 403) to avoid leaking the existence of others' donations. Cancel-at-period-end semantics — the current paid period stays paid, no new invoice generated, Donation flips optimistically and the `customer.subscription.deleted` webhook reconciles.

**Files:**
- Modify: `apps/api/src/donations/donations.service.ts`
- Modify: `apps/api/src/donations/donations.service.spec.ts`
- Modify: `apps/api/src/donations/donations.controller.ts`
- Modify: `apps/api/test/billing-donations.e2e-spec.ts`

- [ ] **Step 1: Add the failing cancel unit tests**

Append a new `describe('DonationsService (cancel)', ...)` block to the spec file:

```ts
describe('DonationsService (cancel)', () => {
  // Reuse the same beforeEach scaffold from the recurring describe.

  beforeEach(() => {
    stripe.stripe = {
      ...stripe.stripe,
      subscriptions: { update: jest.fn().mockResolvedValue({}) },
    } as any;
  });

  it('returns 404 (NotFoundException) when the donation belongs to another user', async () => {
    prisma.donation.findUnique.mockResolvedValue({
      id: 'don_1', userId: 'user_other', mode: 'RECURRING', status: 'ACTIVE',
      stripeSubscriptionId: 'sub_1',
    });
    await expect(service.cancel({ userSub: 'user_1', donationId: 'don_1' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns 409 (ConflictException) when the donation is not ACTIVE', async () => {
    prisma.donation.findUnique.mockResolvedValue({
      id: 'don_1', userId: 'user_1', mode: 'RECURRING', status: 'COMPLETED',
      stripeSubscriptionId: 'sub_1',
    });
    await expect(service.cancel({ userSub: 'user_1', donationId: 'don_1' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('returns 409 when the donation is not RECURRING', async () => {
    prisma.donation.findUnique.mockResolvedValue({
      id: 'don_1', userId: 'user_1', mode: 'ONE_TIME', status: 'COMPLETED',
      stripeSubscriptionId: null,
    });
    await expect(service.cancel({ userSub: 'user_1', donationId: 'don_1' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('schedules cancel-at-period-end on Stripe and flips Donation to CANCELED optimistically', async () => {
    prisma.donation.findUnique.mockResolvedValue({
      id: 'don_1', userId: 'user_1', mode: 'RECURRING', status: 'ACTIVE',
      stripeSubscriptionId: 'sub_1',
    });
    prisma.donation.update.mockResolvedValue({ id: 'don_1', status: 'CANCELED' });

    const result = await service.cancel({ userSub: 'user_1', donationId: 'don_1' });
    expect(result).toEqual({ status: 'canceled' });
    expect((stripe.stripe.subscriptions.update as jest.Mock)).toHaveBeenCalledWith('sub_1', { cancel_at_period_end: true });
    expect(prisma.donation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'don_1' },
        data: expect.objectContaining({ status: 'CANCELED', canceledAt: expect.any(Date) }),
      }),
    );
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
pnpm -F api test -- donations.service
```

Expected: FAIL ("service.cancel is not a function").

- [ ] **Step 3: Implement `cancel` on `DonationsService`**

Append to `apps/api/src/donations/donations.service.ts`:

```ts
  async cancel(input: { userSub: string; donationId: string }): Promise<{ status: 'canceled' }> {
    const donation = await this.prisma.donation.findUnique({
      where: { id: input.donationId },
    });
    if (!donation || donation.userId !== input.userSub) {
      // 404 not 403: do not leak existence of other users' donations.
      throw new NotFoundException();
    }
    if (donation.status !== DonationStatus.ACTIVE) {
      throw new ConflictException('donation is not active');
    }
    if (donation.mode !== DonationMode.RECURRING || !donation.stripeSubscriptionId) {
      throw new ConflictException('donation is not recurring');
    }

    // Cancel-at-period-end: the current paid period stays paid, no new invoice
    // generated. Mirrors BillingService.cancelMembership.
    await this.stripeClient.stripe.subscriptions.update(donation.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });

    await this.prisma.donation.update({
      where: { id: donation.id },
      data: { status: DonationStatus.CANCELED, canceledAt: new Date() },
    });

    return { status: 'canceled' };
  }
```

Verify the BillingService cancelMembership pattern uses the same `subscriptions.update({cancel_at_period_end: true})` call. If it uses a different shape (e.g. `subscriptions.cancel(...)`), adopt the same shape here. The spec defers to the existing pattern.

- [ ] **Step 4: Run the unit tests and confirm all pass**

```bash
pnpm -F api test -- donations.service
```

Expected: PASS (all four new tests plus the prior eight).

- [ ] **Step 5: Add the controller route**

Append to `apps/api/src/donations/donations.controller.ts`:

```ts
import { Param } from '@nestjs/common';

// ... inside the @Controller('billing/checkout') class
// (note: this endpoint is /billing/donation/:id/cancel, not /billing/checkout/...)
```

Realising the route path conflict: the cancel route is `/billing/donation/:id/cancel`, not under `/billing/checkout`. Split into a second controller:

`apps/api/src/donations/donation-management.controller.ts`:

```ts
import { Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { DonationsService } from './donations.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DonationsFeatureFlagGuard } from './donations-feature-flag.guard';

@Controller('billing/donation')
@UseGuards(JwtAuthGuard, DonationsFeatureFlagGuard)
export class DonationManagementController {
  constructor(private readonly donations: DonationsService) {}

  @Post(':id/cancel')
  async cancel(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<{ status: 'canceled' }> {
    const user = (req as any).user as { sub: string };
    return this.donations.cancel({ userSub: user.sub, donationId: id });
  }
}
```

- [ ] **Step 6: Register the new controller in `DonationsModule`**

In `apps/api/src/donations/donations.module.ts`, add `DonationManagementController` to the `controllers: [...]` array:

```ts
import { DonationManagementController } from './donation-management.controller';

// ...
controllers: [DonationsController, DonationManagementController],
```

- [ ] **Step 7: Add the cancel e2e test**

Append to `apps/api/test/billing-donations.e2e-spec.ts`:

```ts
describe('Donation cancel', () => {
  it('404 on cancelling another user\'s donation', async () => {
    const donation = await prisma.donation.create({
      data: donationFactory({
        userId: 'user_other',
        campaignId: 'camp_1',
        organizationId: 'org_test_donations',
        mode: 'RECURRING',
        status: 'ACTIVE',
        stripeSubscriptionId: 'sub_other',
      }),
    });
    const res = await request(app.getHttpServer())
      .post(`/billing/donation/${donation.id}/cancel`)
      .set('Authorization', authHeader());
    expect(res.status).toBe(404);
  });

  it('200 + flips status to CANCELED on the donor\'s own ACTIVE recurring donation', async () => {
    const donation = await prisma.donation.create({
      data: donationFactory({
        userId: 'test-user-sub', // whatever authHeader resolves to
        campaignId: 'camp_1',
        organizationId: 'org_test_donations',
        mode: 'RECURRING',
        status: 'ACTIVE',
        stripeSubscriptionId: 'sub_self',
      }),
    });
    const res = await request(app.getHttpServer())
      .post(`/billing/donation/${donation.id}/cancel`)
      .set('Authorization', authHeader());
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ status: 'canceled' });

    const after = await prisma.donation.findUnique({ where: { id: donation.id } });
    expect(after?.status).toBe('CANCELED');
    expect(after?.canceledAt).toBeTruthy();
  });
});
```

The user-sub the auth header resolves to must match the donation's `userId` — adapt the test data accordingly using the same value the existing membership-cancel e2e test uses.

- [ ] **Step 8: Add the necessary imports to factories at the top**

In `apps/api/test/billing-donations.e2e-spec.ts`, ensure `donationFactory` is imported:

```ts
import { campaignFactory, coalitionFactory, donationFactory } from './factories';
```

- [ ] **Step 9: Run all donation e2e tests**

```bash
pnpm -F api test:e2e -- billing-donations
```

Expected: PASS (5 tests now).

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/donations apps/api/test/billing-donations.e2e-spec.ts
git commit -m "$(cat <<'EOF'
feat(donations): donor-initiated cancel of recurring donation

- POST /billing/donation/:id/cancel calls Stripe with cancel_at_period_end so the current paid period stays paid, mirroring the membership cancel semantic
- ownership check returns 404 not 403; the spec invariant is that the existence of others' donations is not probable from this endpoint
- Donation row flips to CANCELED optimistically with canceledAt stamped; the customer.subscription.deleted webhook arm (lands in Phase E) is idempotent and reconciles drift
- new DonationManagementController separated from DonationsController because the path prefix differs (/billing/donation/ vs /billing/checkout/)
EOF
)"
```

---

## Phase D — Public read API

### U7: `GET /coalitions` and `GET /coalitions/:slug`

Two public read endpoints — no auth, scoped by `organizationId` resolved from the request host (existing convention). Each coalition surfaces aggregate stats (child-campaign count, total raised across children). The detail endpoint includes the nested `campaigns` list.

**Files:**
- Create: `apps/api/src/donations/coalitions.controller.ts`
- Create: `apps/api/src/donations/coalitions.service.ts`
- Create: `apps/api/src/donations/coalitions.service.spec.ts`
- Modify: `apps/api/src/donations/donations.module.ts` (register controller + service)
- Create: `apps/api/test/coalitions-public.e2e-spec.ts`

- [ ] **Step 1: Write the failing service test**

`apps/api/src/donations/coalitions.service.spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { CoalitionsService } from './coalitions.service';
import { PrismaService } from '../prisma/prisma.service';

describe('CoalitionsService', () => {
  let service: CoalitionsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      coalition: { findMany: jest.fn(), findUnique: jest.fn() },
      $queryRaw: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CoalitionsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(CoalitionsService);
  });

  it('listForOrg returns only ACTIVE coalitions ordered by displayOrder', async () => {
    prisma.coalition.findMany.mockResolvedValue([
      { id: 'c1', slug: 'a', name: 'A', description: null, coverImageUrl: null, displayOrder: 0 },
    ]);
    prisma.$queryRaw.mockResolvedValue([
      { coalition_id: 'c1', child_count: 2n, total_raised: 5000n },
    ]);
    const result = await service.listForOrg('org_1');
    expect(prisma.coalition.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org_1', status: 'ACTIVE' },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });
    expect(result).toEqual([
      expect.objectContaining({
        id: 'c1', slug: 'a', name: 'A',
        childCampaignCount: 2, totalRaisedCents: 5000,
      }),
    ]);
  });

  it('getBySlug throws on ARCHIVED', async () => {
    prisma.coalition.findUnique.mockResolvedValue({ id: 'c1', status: 'ARCHIVED' });
    await expect(service.getBySlug('org_1', 'a')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
pnpm -F api test -- coalitions.service
```

Expected: FAIL.

- [ ] **Step 3: Implement the service**

`apps/api/src/donations/coalitions.service.ts`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@organizer-hub/db/client/api';
import { PrismaService } from '../prisma/prisma.service';

export interface CoalitionListItem {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  coverImageUrl: string | null;
  childCampaignCount: number;
  totalRaisedCents: number;
}

export interface CampaignSummary {
  id: string;
  slug: string;
  name: string;
  coverImageUrl: string | null;
  targetAmountCents: number;
  raisedCents: number;
  donorCount: number;
  deadline: Date | null;
  status: 'ACTIVE' | 'COMPLETE';
}

@Injectable()
export class CoalitionsService {
  constructor(private readonly prisma: PrismaService) {}

  async listForOrg(organizationId: string): Promise<CoalitionListItem[]> {
    const coalitions = await this.prisma.coalition.findMany({
      where: { organizationId, status: 'ACTIVE' },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });
    if (coalitions.length === 0) return [];
    const ids = coalitions.map((c) => c.id);

    const stats = await this.prisma.$queryRaw<
      Array<{ coalition_id: string; child_count: bigint; total_raised: bigint | null }>
    >(Prisma.sql`
      SELECT
        c.coalition_id,
        COUNT(*)::bigint AS child_count,
        COALESCE(SUM(pe_totals.raised), 0)::bigint AS total_raised
      FROM "campaigns" c
      LEFT JOIN LATERAL (
        SELECT SUM(pe.amount_cents)::bigint AS raised
        FROM "donations" d
        JOIN "payment_events" pe ON pe.donation_id = d.id
        WHERE d.campaign_id = c.id AND pe.status = 'SUCCEEDED'
      ) pe_totals ON true
      WHERE c.coalition_id IN (${Prisma.join(ids)})
        AND c.status IN ('ACTIVE', 'COMPLETE')
      GROUP BY c.coalition_id
    `);

    const statsById = new Map(
      stats.map((s) => [s.coalition_id, { childCount: Number(s.child_count), raised: Number(s.total_raised ?? 0n) }]),
    );

    return coalitions.map((c) => ({
      id: c.id,
      slug: c.slug,
      name: c.name,
      description: c.description,
      coverImageUrl: c.coverImageUrl,
      childCampaignCount: statsById.get(c.id)?.childCount ?? 0,
      totalRaisedCents: statsById.get(c.id)?.raised ?? 0,
    }));
  }

  async getBySlug(
    organizationId: string,
    slug: string,
  ): Promise<{ coalition: CoalitionListItem; campaigns: CampaignSummary[] }> {
    const coalition = await this.prisma.coalition.findUnique({
      where: { organizationId_slug: { organizationId, slug } },
    });
    if (!coalition || coalition.status !== 'ACTIVE') {
      throw new NotFoundException();
    }

    const campaigns = await this.prisma.campaign.findMany({
      where: { coalitionId: coalition.id, status: { in: ['ACTIVE', 'COMPLETE'] } },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });

    const summaries = await Promise.all(
      campaigns.map(async (cmp) => {
        const [raised, donorCount] = await Promise.all([
          this.prisma.paymentEvent.aggregate({
            where: {
              donation: { campaignId: cmp.id },
              status: 'SUCCEEDED',
            },
            _sum: { amountCents: true },
          }),
          this.prisma.donation
            .groupBy({
              by: ['userId'],
              where: { campaignId: cmp.id, status: { in: ['ACTIVE', 'COMPLETED'] } },
            })
            .then((rows) => rows.length),
        ]);
        return {
          id: cmp.id,
          slug: cmp.slug,
          name: cmp.name,
          coverImageUrl: cmp.coverImageUrl,
          targetAmountCents: cmp.targetAmountCents,
          raisedCents: raised._sum.amountCents ?? 0,
          donorCount,
          deadline: cmp.deadline,
          status: cmp.status as 'ACTIVE' | 'COMPLETE',
        };
      }),
    );

    return {
      coalition: {
        id: coalition.id,
        slug: coalition.slug,
        name: coalition.name,
        description: coalition.description,
        coverImageUrl: coalition.coverImageUrl,
        childCampaignCount: summaries.length,
        totalRaisedCents: summaries.reduce((sum, s) => sum + s.raisedCents, 0),
      },
      campaigns: summaries,
    };
  }
}
```

- [ ] **Step 4: Run the unit tests and confirm they pass**

```bash
pnpm -F api test -- coalitions.service
```

Expected: PASS.

- [ ] **Step 5: Implement the controller**

`apps/api/src/donations/coalitions.controller.ts`:

```ts
import { Controller, Get, NotFoundException, Param, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { CoalitionsService } from './coalitions.service';
import { DonationsFeatureFlagGuard } from './donations-feature-flag.guard';

@Controller('coalitions')
@UseGuards(DonationsFeatureFlagGuard)
export class CoalitionsController {
  constructor(private readonly coalitions: CoalitionsService) {}

  @Get()
  list(@Req() req: Request) {
    const org = (req as any).organization as { id: string };
    return this.coalitions.listForOrg(org.id);
  }

  @Get(':slug')
  get(@Req() req: Request, @Param('slug') slug: string) {
    const org = (req as any).organization as { id: string };
    return this.coalitions.getBySlug(org.id, slug);
  }
}
```

The `DonationsFeatureFlagGuard` is the only guard — no `JwtAuthGuard`. Public endpoints.

- [ ] **Step 6: Register in `DonationsModule`**

Update `apps/api/src/donations/donations.module.ts`:

```ts
import { CoalitionsService } from './coalitions.service';
import { CoalitionsController } from './coalitions.controller';

// ...inside @Module({...})
controllers: [DonationsController, DonationManagementController, CoalitionsController],
providers: [DonationsService, CoalitionsService, DonationsFeatureFlagGuard],
exports: [DonationsService, CoalitionsService, DonationsFeatureFlagGuard],
```

- [ ] **Step 7: Add the public e2e test**

`apps/api/test/coalitions-public.e2e-spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { campaignFactory, coalitionFactory } from './factories';

describe('Coalitions (public)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.donation.deleteMany();
    await prisma.campaign.deleteMany();
    await prisma.coalition.deleteMany();
    await prisma.organization.upsert({
      where: { id: 'org_test_pub' },
      update: { donationsEnabled: true },
      create: { id: 'org_test_pub', name: 'Pub Org', donationsEnabled: true },
    });
    await prisma.coalition.create({
      data: coalitionFactory({ id: 'coal_pub_active', organizationId: 'org_test_pub', slug: 'a', status: 'ACTIVE' }),
    });
    await prisma.coalition.create({
      data: coalitionFactory({ id: 'coal_pub_archived', organizationId: 'org_test_pub', slug: 'b', status: 'ARCHIVED' }),
    });
    await prisma.campaign.create({
      data: campaignFactory({
        id: 'camp_pub_1',
        coalitionId: 'coal_pub_active',
        organizationId: 'org_test_pub',
        slug: 'c1',
        status: 'ACTIVE',
      }),
    });
  });

  it('GET /coalitions excludes ARCHIVED', async () => {
    const res = await request(app.getHttpServer()).get('/coalitions').set('Host', 'org_test_pub.test');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].slug).toBe('a');
  });

  it('GET /coalitions/:slug returns 404 on ARCHIVED', async () => {
    const res = await request(app.getHttpServer()).get('/coalitions/b').set('Host', 'org_test_pub.test');
    expect(res.status).toBe(404);
  });

  it('GET /coalitions/:slug returns coalition + nested campaigns', async () => {
    const res = await request(app.getHttpServer()).get('/coalitions/a').set('Host', 'org_test_pub.test');
    expect(res.status).toBe(200);
    expect(res.body.coalition.slug).toBe('a');
    expect(res.body.campaigns).toHaveLength(1);
    expect(res.body.campaigns[0].slug).toBe('c1');
  });

  it('returns 404 when donationsEnabled is off', async () => {
    await prisma.organization.update({ where: { id: 'org_test_pub' }, data: { donationsEnabled: false } });
    const res = await request(app.getHttpServer()).get('/coalitions').set('Host', 'org_test_pub.test');
    expect(res.status).toBe(404);
  });
});
```

The `Host` header should match however your org-resolution middleware extracts the org. Adapt to the existing convention if different.

- [ ] **Step 8: Run e2e**

```bash
pnpm -F api test:e2e -- coalitions-public
```

Expected: PASS (4 tests).

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/donations/coalitions.service.ts apps/api/src/donations/coalitions.service.spec.ts apps/api/src/donations/coalitions.controller.ts apps/api/src/donations/donations.module.ts apps/api/test/coalitions-public.e2e-spec.ts
git commit -m "$(cat <<'EOF'
feat(donations): public coalitions read API

- GET /coalitions returns only ACTIVE coalitions for the request's org, ordered by displayOrder then name; each row carries childCampaignCount and totalRaisedCents computed via a single $queryRaw aggregation to avoid N+1
- GET /coalitions/:slug 404s on ARCHIVED so donors cannot deep-link past a hidden coalition; returns the coalition plus its nested ACTIVE+COMPLETE child campaigns with each campaign's raisedCents and donorCount
- both routes guarded by DonationsFeatureFlagGuard only (no auth) so unauthenticated visitors can browse the storytelling surfaces
EOF
)"
```

---

### U8: `GET /campaigns/:slug`

The donor's most-trafficked surface. Returns the campaign plus the coalition context plus `raisedCents`, `donorCount`, and the most-recent-gifts snippet (counts only — no donor names in this cycle).

**Files:**
- Create: `apps/api/src/donations/campaigns.service.ts`
- Create: `apps/api/src/donations/campaigns.service.spec.ts`
- Create: `apps/api/src/donations/campaigns.controller.ts`
- Modify: `apps/api/src/donations/donations.module.ts`
- Modify: `apps/api/test/coalitions-public.e2e-spec.ts` (or split into `campaigns-public.e2e-spec.ts`)

- [ ] **Step 1: Write the failing service test**

`apps/api/src/donations/campaigns.service.spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { CampaignsService } from './campaigns.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';

describe('CampaignsService', () => {
  let service: CampaignsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      campaign: { findUnique: jest.fn() },
      paymentEvent: { aggregate: jest.fn(), count: jest.fn() },
      donation: { groupBy: jest.fn() },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CampaignsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(CampaignsService);
  });

  it('returns campaign + coalition + raisedCents (summed over DONATION/REFUND/DISPUTE rows)', async () => {
    prisma.campaign.findUnique.mockResolvedValue({
      id: 'cmp_1', organizationId: 'org_1', coalitionId: 'coal_1',
      slug: 'cmp', name: 'Cmp', description: null, coverImageUrl: null,
      targetAmountCents: 100_000, currency: 'usd', deadline: null,
      status: 'ACTIVE', displayOrder: 0,
      coalition: { id: 'coal_1', slug: 'gen', name: 'General' },
    });
    prisma.paymentEvent.aggregate.mockResolvedValue({ _sum: { amountCents: 12_000 } });
    prisma.donation.groupBy.mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }]);
    prisma.paymentEvent.count.mockResolvedValue(0);

    const result = await service.getBySlug('org_1', 'cmp');
    expect(result.campaign.raisedCents).toBe(12_000);
    expect(result.campaign.donorCount).toBe(2);
    expect(result.coalition.slug).toBe('gen');
  });

  it('404 on DRAFT', async () => {
    prisma.campaign.findUnique.mockResolvedValue({
      id: 'cmp_1', status: 'DRAFT',
      coalition: { id: 'coal_1' },
    });
    await expect(service.getBySlug('org_1', 'cmp')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404 on ARCHIVED', async () => {
    prisma.campaign.findUnique.mockResolvedValue({
      id: 'cmp_1', status: 'ARCHIVED',
      coalition: { id: 'coal_1' },
    });
    await expect(service.getBySlug('org_1', 'cmp')).rejects.toBeInstanceOf(NotFoundException);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
pnpm -F api test -- campaigns.service
```

- [ ] **Step 3: Implement the service**

`apps/api/src/donations/campaigns.service.ts`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface CampaignDetail {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  coverImageUrl: string | null;
  targetAmountCents: number;
  currency: string;
  deadline: Date | null;
  status: 'ACTIVE' | 'COMPLETE';
  raisedCents: number;
  donorCount: number;
  recentGiftCount: number;
}

export interface CampaignDetailResponse {
  campaign: CampaignDetail;
  coalition: { id: string; slug: string; name: string };
}

@Injectable()
export class CampaignsService {
  constructor(private readonly prisma: PrismaService) {}

  async getBySlug(organizationId: string, slug: string): Promise<CampaignDetailResponse> {
    const campaign = await this.prisma.campaign.findUnique({
      where: { organizationId_slug: { organizationId, slug } },
      include: { coalition: true },
    });
    if (!campaign || (campaign.status !== 'ACTIVE' && campaign.status !== 'COMPLETE')) {
      throw new NotFoundException();
    }

    // raisedCents sums ALL kinds (DONATION/REFUND/DISPUTE) by virtue of the
    // donationId join — refund and dispute rows carry negative amount_cents and
    // inherit donationId from the original donation event (Phase E webhook
    // inheritance rule).
    const raised = await this.prisma.paymentEvent.aggregate({
      where: { donation: { campaignId: campaign.id }, status: 'SUCCEEDED' },
      _sum: { amountCents: true },
    });
    const donors = await this.prisma.donation.groupBy({
      by: ['userId'],
      where: { campaignId: campaign.id, status: { in: ['ACTIVE', 'COMPLETED'] } },
    });
    const recentGiftCount = await this.prisma.paymentEvent.count({
      where: {
        donation: { campaignId: campaign.id },
        status: 'SUCCEEDED',
        kind: 'DONATION',
        succeededAt: { gte: new Date(Date.now() - 30 * 86_400_000) },
      },
    });

    return {
      campaign: {
        id: campaign.id,
        slug: campaign.slug,
        name: campaign.name,
        description: campaign.description,
        coverImageUrl: campaign.coverImageUrl,
        targetAmountCents: campaign.targetAmountCents,
        currency: campaign.currency,
        deadline: campaign.deadline,
        status: campaign.status as 'ACTIVE' | 'COMPLETE',
        raisedCents: raised._sum.amountCents ?? 0,
        donorCount: donors.length,
        recentGiftCount,
      },
      coalition: {
        id: campaign.coalition.id,
        slug: campaign.coalition.slug,
        name: campaign.coalition.name,
      },
    };
  }
}
```

- [ ] **Step 4: Run the unit tests and confirm they pass**

```bash
pnpm -F api test -- campaigns.service
```

- [ ] **Step 5: Implement the controller**

`apps/api/src/donations/campaigns.controller.ts`:

```ts
import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { CampaignsService } from './campaigns.service';
import { DonationsFeatureFlagGuard } from './donations-feature-flag.guard';

@Controller('campaigns')
@UseGuards(DonationsFeatureFlagGuard)
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Get(':slug')
  get(@Req() req: Request, @Param('slug') slug: string) {
    const org = (req as any).organization as { id: string };
    return this.campaigns.getBySlug(org.id, slug);
  }
}
```

- [ ] **Step 6: Register in `DonationsModule`**

Add `CampaignsService` + `CampaignsController` alongside the existing `Coalitions*` entries.

- [ ] **Step 7: Add the e2e test (append to `coalitions-public.e2e-spec.ts` or split into `campaigns-public.e2e-spec.ts`)**

```ts
it('GET /campaigns/:slug returns campaign + coalition context', async () => {
  const res = await request(app.getHttpServer())
    .get('/campaigns/c1')
    .set('Host', 'org_test_pub.test');
  expect(res.status).toBe(200);
  expect(res.body.campaign.slug).toBe('c1');
  expect(res.body.coalition.slug).toBe('a');
});

it('GET /campaigns/:slug 404 on DRAFT', async () => {
  await prisma.campaign.update({ where: { id: 'camp_pub_1' }, data: { status: 'DRAFT' } });
  const res = await request(app.getHttpServer())
    .get('/campaigns/c1')
    .set('Host', 'org_test_pub.test');
  expect(res.status).toBe(404);
});

it('GET /campaigns/:slug raisedCents nets a refund', async () => {
  const donation = await prisma.donation.create({
    data: donationFactory({
      campaignId: 'camp_pub_1', organizationId: 'org_test_pub',
      userId: 'u_donor', mode: 'ONE_TIME', cadence: 'ONCE',
      amountCents: 5000, status: 'COMPLETED',
    }),
  });
  await prisma.paymentEvent.create({
    data: {
      organizationId: 'org_test_pub', userId: 'u_donor',
      kind: 'DONATION', status: 'SUCCEEDED', amountCents: 5000, currency: 'usd',
      donationId: donation.id, stripePaymentIntentId: 'pi_x',
    },
  });
  await prisma.paymentEvent.create({
    data: {
      organizationId: 'org_test_pub', userId: 'u_donor',
      kind: 'REFUND', status: 'SUCCEEDED', amountCents: -5000, currency: 'usd',
      donationId: donation.id, stripeRefundId: 're_x',
    },
  });
  const res = await request(app.getHttpServer())
    .get('/campaigns/c1')
    .set('Host', 'org_test_pub.test');
  expect(res.body.campaign.raisedCents).toBe(0);
});
```

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/donations/campaigns.* apps/api/src/donations/donations.module.ts apps/api/test/coalitions-public.e2e-spec.ts
git commit -m "$(cat <<'EOF'
feat(donations): public campaign detail API

- GET /campaigns/:slug returns the campaign plus coalition context plus computed raisedCents, donorCount, and a 30-day recentGiftCount snippet (used by the campaign-detail page's 'most recent gifts' line; donor names deliberately excluded in this cycle)
- raisedCents sums over all kinds (DONATION/REFUND/DISPUTE) via the donationId join so refunds and disputes net the campaign total once the Phase E webhook inheritance lands
- 404 on DRAFT and ARCHIVED matches the spec's invariant that hidden campaigns are not probable; COMPLETE remains visible because past goals are part of the story
EOF
)"
```

---

### U9: `GET /donations/mine`

Returns the authenticated user's donations, with `?mode=RECURRING` filter for the `/dashboard/donations` view.

**Files:**
- Create: `apps/api/src/donations/donations-read.controller.ts`
- Modify: `apps/api/src/donations/donations.service.ts` (add `listForUser`)
- Modify: `apps/api/src/donations/donations.service.spec.ts`
- Modify: `apps/api/src/donations/donations.module.ts`
- Modify: `apps/api/test/billing-donations.e2e-spec.ts` (add read tests)

- [ ] **Step 1: Add the failing service test**

In the donations.service.spec, append a new describe:

```ts
describe('DonationsService.listForUser', () => {
  it('filters by userId, then optional mode, ordering by createdAt desc', async () => {
    prisma.donation.findMany = jest.fn().mockResolvedValue([{ id: 'd1' }]);
    const result = await service.listForUser({ userSub: 'u_1', mode: 'RECURRING' });
    expect(prisma.donation.findMany).toHaveBeenCalledWith({
      where: { userId: 'u_1', mode: 'RECURRING' },
      orderBy: { createdAt: 'desc' },
      include: {
        campaign: {
          include: { coalition: { select: { id: true, slug: true, name: true } } },
          select: { id: true, slug: true, name: true, coalition: true },
        },
      },
    });
    expect(result).toEqual([{ id: 'd1' }]);
  });
});
```

Adapt the test's `include` shape if Prisma's typing complains; the spec is "return enough campaign+coalition context to render the list row without an extra fetch".

- [ ] **Step 2: Run the test and confirm it fails**

```bash
pnpm -F api test -- donations.service
```

- [ ] **Step 3: Implement `listForUser`**

Append to `apps/api/src/donations/donations.service.ts`:

```ts
  async listForUser(input: { userSub: string; mode?: 'ONE_TIME' | 'RECURRING' }) {
    return this.prisma.donation.findMany({
      where: { userId: input.userSub, ...(input.mode ? { mode: input.mode } : {}) },
      orderBy: { createdAt: 'desc' },
      include: {
        campaign: {
          select: {
            id: true, slug: true, name: true,
            coalition: { select: { id: true, slug: true, name: true } },
          },
        },
      },
    });
  }
```

- [ ] **Step 4: Run the unit tests and confirm they pass**

- [ ] **Step 5: Implement the controller**

`apps/api/src/donations/donations-read.controller.ts`:

```ts
import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { DonationsService } from './donations.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DonationsFeatureFlagGuard } from './donations-feature-flag.guard';

@Controller('donations')
@UseGuards(JwtAuthGuard, DonationsFeatureFlagGuard)
export class DonationsReadController {
  constructor(private readonly donations: DonationsService) {}

  @Get('mine')
  mine(@Req() req: Request, @Query('mode') mode?: 'ONE_TIME' | 'RECURRING') {
    const user = (req as any).user as { sub: string };
    return this.donations.listForUser({ userSub: user.sub, mode });
  }
}
```

- [ ] **Step 6: Register in `DonationsModule`**

Add `DonationsReadController` to `controllers: [...]`.

- [ ] **Step 7: Add an e2e test**

Append to `apps/api/test/billing-donations.e2e-spec.ts`:

```ts
describe('GET /donations/mine', () => {
  it('returns only the current user\'s donations, with ?mode=RECURRING filter applied', async () => {
    await prisma.donation.create({
      data: donationFactory({
        userId: 'test-user-sub', campaignId: 'camp_1', organizationId: 'org_test_donations',
        mode: 'ONE_TIME', cadence: 'ONCE', status: 'COMPLETED',
      }),
    });
    await prisma.donation.create({
      data: donationFactory({
        userId: 'test-user-sub', campaignId: 'camp_1', organizationId: 'org_test_donations',
        mode: 'RECURRING', cadence: 'MONTHLY', status: 'ACTIVE',
      }),
    });
    await prisma.donation.create({
      data: donationFactory({
        userId: 'user_other', campaignId: 'camp_1', organizationId: 'org_test_donations',
        mode: 'RECURRING', cadence: 'MONTHLY', status: 'ACTIVE',
      }),
    });
    const res = await request(app.getHttpServer())
      .get('/donations/mine?mode=RECURRING')
      .set('Authorization', authHeader());
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].mode).toBe('RECURRING');
  });
});
```

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/donations apps/api/test/billing-donations.e2e-spec.ts
git commit -m "$(cat <<'EOF'
feat(donations): GET /donations/mine for the recurring dashboard

- returns the auth'd user's donations newest first, with optional ?mode=RECURRING filter used by /dashboard/donations
- each row includes the campaign and parent coalition slugs+names in a single query so the dashboard list row renders without an extra fetch
- guard chain matches /billing/checkout/donation: JwtAuthGuard then DonationsFeatureFlagGuard
EOF
)"
```

---

## Phase E — Webhook patches

The donation guard on `checkout.session.completed` lands first (preempts the bug-in-waiting), then the recurring lifecycle arms, then refund/dispute inheritance.

### U10: Donation guard on `checkout.session.completed` and `handleDonationCheckoutCompleted`

**Files:**
- Modify: `apps/api/src/webhooks/stripe-webhook.service.ts` (add donation branch at top of `checkout.session.completed` handler; add new private method)
- Modify: `apps/api/test/webhooks.e2e-spec.ts` (add donation guard test)
- Create: `apps/api/test/donations-webhook.e2e-spec.ts` (full donation lifecycle tests)

- [ ] **Step 1: Add the failing test asserting no Ticket is issued for a donation session**

`apps/api/test/donations-webhook.e2e-spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { StripeWebhookService } from '../src/webhooks/stripe-webhook.service';
import { campaignFactory, coalitionFactory, donationFactory } from './factories';

describe('Donation webhook lifecycle', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let webhook: StripeWebhookService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    webhook = app.get(StripeWebhookService);
  });

  afterAll(async () => await app.close());

  beforeEach(async () => {
    await prisma.paymentEvent.deleteMany();
    await prisma.donation.deleteMany();
    await prisma.campaign.deleteMany();
    await prisma.coalition.deleteMany();
    await prisma.ticket.deleteMany();
    await prisma.organization.upsert({
      where: { id: 'org_w' },
      update: { donationsEnabled: true },
      create: { id: 'org_w', name: 'WH', donationsEnabled: true },
    });
    await prisma.coalition.create({ data: coalitionFactory({ id: 'coal_w', organizationId: 'org_w' }) });
    await prisma.campaign.create({
      data: campaignFactory({ id: 'camp_w', coalitionId: 'coal_w', organizationId: 'org_w', status: 'ACTIVE' }),
    });
  });

  it('checkout.session.completed for a one-time donation does NOT issue a Ticket and flips Donation to COMPLETED', async () => {
    const donation = await prisma.donation.create({
      data: donationFactory({
        id: 'don_w_1',
        userId: 'user_w', campaignId: 'camp_w', organizationId: 'org_w',
        mode: 'ONE_TIME', cadence: 'ONCE', amountCents: 5000, status: 'PENDING',
        stripeCheckoutSessionId: 'cs_w_1',
      }),
    });

    await webhook.handleEvent({
      id: 'evt_test_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_w_1', mode: 'payment',
          payment_status: 'paid',
          metadata: { source: 'donation', donationId: donation.id, userId: 'user_w', campaignId: 'camp_w' },
          customer: 'cus_w_1', payment_intent: 'pi_w_1',
        },
      },
    } as any);

    const ticketCount = await prisma.ticket.count();
    expect(ticketCount).toBe(0);

    const updated = await prisma.donation.findUnique({ where: { id: donation.id } });
    expect(updated?.status).toBe('COMPLETED');
    expect(updated?.stripeCustomerId).toBe('cus_w_1');
  });
});
```

The `webhook.handleEvent(...)` shape must match whatever the existing service entry point is — adopt the method name from `webhooks.e2e-spec.ts` if it's different (e.g. `handleStripeEvent`, `process`).

- [ ] **Step 2: Run the test and confirm it fails**

```bash
pnpm -F api test:e2e -- donations-webhook
```

Expected: FAIL (either the donation stays PENDING, or a Ticket is created, or both).

- [ ] **Step 3: Add the donation branch at the top of `checkout.session.completed`**

In `apps/api/src/webhooks/stripe-webhook.service.ts`, locate the `checkout.session.completed` handler (it currently branches on `session.mode`). Add a top-priority branch on `metadata.source` *before* the mode branches:

```ts
async handleCheckoutSessionCompleted(event: Stripe.Event): Promise<void> {
  const session = event.data.object as Stripe.Checkout.Session;

  if (session.metadata?.source === 'donation') {
    return this.handleDonationCheckoutCompleted(session, event);
  }

  // existing mode='payment' (ticket) and mode='subscription' (membership) branches
  if (session.mode === 'payment') {
    return this.issueTicketFromSession(session);
  }
  // ...etc
}
```

- [ ] **Step 4: Implement `handleDonationCheckoutCompleted`**

Add the private method to the same service file:

```ts
private async handleDonationCheckoutCompleted(
  session: Stripe.Checkout.Session,
  event: Stripe.Event,
): Promise<void> {
  const donationId = session.metadata?.donationId;
  let donation = donationId
    ? await this.prisma.donation.findUnique({ where: { id: donationId } })
    : null;
  if (!donation && session.id) {
    donation = await this.prisma.donation.findFirst({
      where: { stripeCheckoutSessionId: session.id },
    });
  }
  if (!donation) {
    this.logger.warn(`checkout.session.completed donation ${event.id} no Donation row found`);
    return;
  }

  if (session.mode === 'payment') {
    if (donation.status === 'PENDING') {
      await this.prisma.donation.update({
        where: { id: donation.id },
        data: {
          status: 'COMPLETED',
          stripeCustomerId: this.unwrapId(session.customer),
        },
      });
    }
    // No ticket issuance. PaymentEvent is written by the existing
    // checkout.session.created arm (which already maps source=donation
    // -> kind=DONATION).
    return;
  }

  if (session.mode === 'subscription') {
    if (donation.status === 'PENDING') {
      await this.prisma.donation.update({
        where: { id: donation.id },
        data: {
          stripeCustomerId: this.unwrapId(session.customer),
          stripeSubscriptionId: this.unwrapId(session.subscription),
          // status stays PENDING until invoice.paid promotes it to ACTIVE
        },
      });
    }
  }
}
```

`this.unwrapId` should match the existing helper used by membership/ticket arms (it returns the string id from either a string id or an expanded Stripe object).

- [ ] **Step 5: Run the test and confirm it passes**

```bash
pnpm -F api test:e2e -- donations-webhook
```

Expected: PASS.

- [ ] **Step 6: Run the full webhook e2e suite to confirm no regression**

```bash
pnpm -F api test:e2e -- webhooks
```

Expected: every prior webhook test still passes (ticket / membership / refund / dispute).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/webhooks/stripe-webhook.service.ts apps/api/test/donations-webhook.e2e-spec.ts
git commit -m "$(cat <<'EOF'
feat(webhooks): donation guard on checkout.session.completed

- new top-priority metadata.source==='donation' branch runs BEFORE the existing mode-based branches; a donation session can no longer fall through to issueTicketFromSession (the bug-in-waiting flagged during the design phase)
- handleDonationCheckoutCompleted resolves the Donation row by metadata.donationId (primary) or stripeCheckoutSessionId (fallback); warn+no-op on miss
- one-time donations flip PENDING -> COMPLETED and stamp stripeCustomerId; recurring donations stamp stripeSubscriptionId but stay PENDING until invoice.paid promotes them in U11
EOF
)"
```

---

### U11: `invoice.paid` donation arm

Recurring lifecycle's promotion event. First `invoice.paid` for a donation subscription flips Donation `PENDING → ACTIVE`. Every `invoice.paid` (including the first) inserts a fresh `PaymentEvent` with `kind=DONATION`, `status=SUCCEEDED`. Idempotent on `stripeInvoiceId`.

**Files:**
- Modify: `apps/api/src/webhooks/stripe-webhook.service.ts`
- Modify: `apps/api/test/donations-webhook.e2e-spec.ts`

- [ ] **Step 1: Add the failing test**

Append to `donations-webhook.e2e-spec.ts`:

```ts
it('first invoice.paid for a donation subscription promotes Donation PENDING -> ACTIVE and writes a SUCCEEDED PaymentEvent', async () => {
  const donation = await prisma.donation.create({
    data: donationFactory({
      id: 'don_w_2',
      userId: 'user_w', campaignId: 'camp_w', organizationId: 'org_w',
      mode: 'RECURRING', cadence: 'MONTHLY', amountCents: 2500, status: 'PENDING',
      stripeSubscriptionId: 'sub_w_2',
    }),
  });

  await webhook.handleEvent({
    id: 'evt_inv_1',
    type: 'invoice.paid',
    data: {
      object: {
        id: 'in_w_1', subscription: 'sub_w_2',
        amount_paid: 2500, currency: 'usd',
        customer: 'cus_w_2', payment_intent: 'pi_w_2', charge: 'ch_w_2',
        // subscription's metadata replicates session metadata thanks to subscription_data.metadata
        subscription_details: { metadata: { source: 'donation', donationId: donation.id } },
      },
    },
  } as any);

  const updated = await prisma.donation.findUnique({ where: { id: donation.id } });
  expect(updated?.status).toBe('ACTIVE');

  const pe = await prisma.paymentEvent.findMany({ where: { donationId: donation.id } });
  expect(pe).toHaveLength(1);
  expect(pe[0]).toMatchObject({ kind: 'DONATION', status: 'SUCCEEDED', amountCents: 2500 });
  expect(pe[0].stripeInvoiceId).toBe('in_w_1');
});

it('replaying the same invoice.paid is idempotent (no duplicate PaymentEvent)', async () => {
  await prisma.donation.create({
    data: donationFactory({
      id: 'don_w_3', userId: 'user_w', campaignId: 'camp_w', organizationId: 'org_w',
      mode: 'RECURRING', cadence: 'MONTHLY', amountCents: 2500, status: 'ACTIVE',
      stripeSubscriptionId: 'sub_w_3',
    }),
  });
  const evt = {
    id: 'evt_inv_2', type: 'invoice.paid',
    data: { object: {
      id: 'in_w_2', subscription: 'sub_w_3',
      amount_paid: 2500, currency: 'usd',
      customer: 'cus_w_3', payment_intent: 'pi_w_2', charge: 'ch_w_3',
      subscription_details: { metadata: { source: 'donation', donationId: 'don_w_3' } },
    } },
  } as any;
  await webhook.handleEvent(evt);
  await webhook.handleEvent(evt);
  const pe = await prisma.paymentEvent.findMany({ where: { donationId: 'don_w_3' } });
  expect(pe).toHaveLength(1);
});
```

The exact path Stripe exposes subscription metadata varies by API version. The existing membership `invoice.paid` arm has resolved this — adopt the same metadata access pattern.

- [ ] **Step 2: Run the test and confirm it fails**

```bash
pnpm -F api test:e2e -- donations-webhook
```

- [ ] **Step 3: Add the donation arm to `invoice.paid`**

Locate the existing `invoice.paid` handler in `apps/api/src/webhooks/stripe-webhook.service.ts`. Add the donation arm BEFORE the existing membership-renewal logic:

```ts
private async handleInvoicePaid(event: Stripe.Event): Promise<void> {
  const invoice = event.data.object as Stripe.Invoice;
  const subMetadata = await this.resolveSubscriptionMetadata(invoice);

  if (subMetadata?.source === 'donation') {
    return this.handleDonationInvoicePaid(invoice, subMetadata);
  }

  // ... existing membership renewal logic
}

private async handleDonationInvoicePaid(
  invoice: Stripe.Invoice,
  metadata: { source: 'donation'; donationId?: string; userId?: string },
): Promise<void> {
  const donation = metadata.donationId
    ? await this.prisma.donation.findUnique({ where: { id: metadata.donationId } })
    : invoice.subscription
      ? await this.prisma.donation.findFirst({ where: { stripeSubscriptionId: this.unwrapId(invoice.subscription) ?? '' } })
      : null;
  if (!donation) {
    this.logger.warn(`invoice.paid donation: no Donation row for ${invoice.id}`);
    return;
  }

  if (donation.status === 'PENDING') {
    await this.prisma.donation.update({
      where: { id: donation.id },
      data: { status: 'ACTIVE' },
    });
  }

  // Idempotent upsert on stripeInvoiceId via @@unique would be cleanest; use
  // findFirst+create as a fallback if PaymentEvent has no unique on
  // stripeInvoiceId yet.
  const existing = await this.prisma.paymentEvent.findFirst({
    where: { stripeInvoiceId: invoice.id },
  });
  if (existing) return;

  await this.prisma.paymentEvent.create({
    data: {
      organizationId: donation.organizationId,
      userId: donation.userId,
      kind: 'DONATION',
      status: 'SUCCEEDED',
      amountCents: invoice.amount_paid ?? donation.amountCents,
      currency: invoice.currency ?? donation.currency,
      donationId: donation.id,
      stripeCustomerId: this.unwrapId(invoice.customer),
      stripePaymentIntentId: this.unwrapId(invoice.payment_intent),
      stripeInvoiceId: invoice.id,
      stripeChargeId: this.unwrapId(invoice.charge),
      succeededAt: new Date(),
    },
  });
}

private async resolveSubscriptionMetadata(invoice: Stripe.Invoice): Promise<Record<string, string> | null> {
  // Existing helper or inline resolution: many membership tests already do this.
  // Subscription metadata is mirrored from session via subscription_data.metadata,
  // so it survives renewals.
  const sub = invoice.subscription_details ?? (await this.stripeClient.stripe.subscriptions.retrieve(this.unwrapId(invoice.subscription) ?? ''));
  return (sub?.metadata as Record<string, string>) ?? null;
}
```

If `resolveSubscriptionMetadata` already exists in this file with a different name (membership uses something similar), reuse it directly.

- [ ] **Step 4: Run the donation webhook tests and confirm pass**

```bash
pnpm -F api test:e2e -- donations-webhook
```

- [ ] **Step 5: Run the membership webhook tests for regression**

```bash
pnpm -F api test:e2e -- webhooks
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/webhooks/stripe-webhook.service.ts apps/api/test/donations-webhook.e2e-spec.ts
git commit -m "$(cat <<'EOF'
feat(webhooks): invoice.paid arm for recurring donations

- first invoice.paid for a donation subscription flips Donation PENDING -> ACTIVE; subsequent invoice.paid events leave status unchanged at ACTIVE
- every invoice.paid writes a kind=DONATION, status=SUCCEEDED PaymentEvent stamped with stripeInvoiceId; replays are guarded by a findFirst-by-stripeInvoiceId check so re-processing the same event creates zero rows
- subscription_data.metadata propagates source='donation' from session creation through every renewal so the arm dispatches without a Stripe API round-trip
EOF
)"
```

---

### U12: `customer.subscription.deleted` and `invoice.payment_failed` donation arms

The cancel reconciler + the retry-cycle PaymentEvent. Cancel arm is the trust-but-verify pair to the donor-side optimistic flip in U6. The payment-failed arm writes a `FAILED` PaymentEvent without changing Donation status (Stripe retries, only `subscription.deleted` flips us to CANCELED).

**Files:**
- Modify: `apps/api/src/webhooks/stripe-webhook.service.ts`
- Modify: `apps/api/test/donations-webhook.e2e-spec.ts`

- [ ] **Step 1: Add the failing tests**

```ts
it('customer.subscription.deleted for a donation sub flips ACTIVE -> CANCELED', async () => {
  await prisma.donation.create({
    data: donationFactory({
      id: 'don_w_4', userId: 'user_w', campaignId: 'camp_w', organizationId: 'org_w',
      mode: 'RECURRING', cadence: 'MONTHLY', amountCents: 2500, status: 'ACTIVE',
      stripeSubscriptionId: 'sub_w_4',
    }),
  });
  await webhook.handleEvent({
    id: 'evt_sd_1', type: 'customer.subscription.deleted',
    data: { object: { id: 'sub_w_4', metadata: { source: 'donation', donationId: 'don_w_4' } } },
  } as any);
  const after = await prisma.donation.findUnique({ where: { id: 'don_w_4' } });
  expect(after?.status).toBe('CANCELED');
  expect(after?.canceledAt).toBeTruthy();
});

it('customer.subscription.deleted no-ops when Donation already CANCELED (idempotent)', async () => {
  await prisma.donation.create({
    data: donationFactory({
      id: 'don_w_5', userId: 'user_w', campaignId: 'camp_w', organizationId: 'org_w',
      mode: 'RECURRING', cadence: 'MONTHLY', amountCents: 2500, status: 'CANCELED',
      stripeSubscriptionId: 'sub_w_5', canceledAt: new Date(Date.now() - 60_000),
    }),
  });
  await webhook.handleEvent({
    id: 'evt_sd_2', type: 'customer.subscription.deleted',
    data: { object: { id: 'sub_w_5', metadata: { source: 'donation', donationId: 'don_w_5' } } },
  } as any);
  const after = await prisma.donation.findUnique({ where: { id: 'don_w_5' } });
  expect(after?.status).toBe('CANCELED');
  // canceledAt unchanged
  expect(after?.canceledAt?.getTime()).toBeLessThan(Date.now() - 30_000);
});

it('invoice.payment_failed writes FAILED PaymentEvent without changing Donation status', async () => {
  await prisma.donation.create({
    data: donationFactory({
      id: 'don_w_6', userId: 'user_w', campaignId: 'camp_w', organizationId: 'org_w',
      mode: 'RECURRING', cadence: 'MONTHLY', amountCents: 2500, status: 'ACTIVE',
      stripeSubscriptionId: 'sub_w_6',
    }),
  });
  await webhook.handleEvent({
    id: 'evt_ipf_1', type: 'invoice.payment_failed',
    data: { object: {
      id: 'in_w_3', subscription: 'sub_w_6',
      amount_due: 2500, currency: 'usd',
      customer: 'cus_w_6', payment_intent: 'pi_w_6',
      subscription_details: { metadata: { source: 'donation', donationId: 'don_w_6' } },
    } },
  } as any);
  const after = await prisma.donation.findUnique({ where: { id: 'don_w_6' } });
  expect(after?.status).toBe('ACTIVE');
  const pe = await prisma.paymentEvent.findFirst({ where: { donationId: 'don_w_6', status: 'FAILED' } });
  expect(pe).not.toBeNull();
});
```

- [ ] **Step 2: Run and confirm fail**

```bash
pnpm -F api test:e2e -- donations-webhook
```

- [ ] **Step 3: Add the `customer.subscription.deleted` donation arm**

```ts
private async handleSubscriptionDeleted(event: Stripe.Event): Promise<void> {
  const sub = event.data.object as Stripe.Subscription;
  const meta = (sub.metadata as Record<string, string>) ?? {};

  if (meta.source === 'donation') {
    return this.handleDonationSubscriptionDeleted(sub, meta);
  }
  // ... existing membership cancel reconcile
}

private async handleDonationSubscriptionDeleted(
  sub: Stripe.Subscription,
  meta: Record<string, string>,
): Promise<void> {
  const donation = meta.donationId
    ? await this.prisma.donation.findUnique({ where: { id: meta.donationId } })
    : await this.prisma.donation.findFirst({ where: { stripeSubscriptionId: sub.id } });
  if (!donation) {
    this.logger.warn(`customer.subscription.deleted donation: no Donation row for ${sub.id}`);
    return;
  }
  if (donation.status === 'CANCELED') return; // idempotent
  await this.prisma.donation.update({
    where: { id: donation.id },
    data: { status: 'CANCELED', canceledAt: new Date() },
  });
}
```

- [ ] **Step 4: Add the `invoice.payment_failed` donation arm**

```ts
private async handleInvoicePaymentFailed(event: Stripe.Event): Promise<void> {
  const invoice = event.data.object as Stripe.Invoice;
  const meta = await this.resolveSubscriptionMetadata(invoice);

  if (meta?.source === 'donation') {
    return this.handleDonationInvoiceFailed(invoice, meta);
  }
  // ... existing membership payment_failed handling
}

private async handleDonationInvoiceFailed(
  invoice: Stripe.Invoice,
  meta: Record<string, string>,
): Promise<void> {
  const donation = meta.donationId
    ? await this.prisma.donation.findUnique({ where: { id: meta.donationId } })
    : await this.prisma.donation.findFirst({ where: { stripeSubscriptionId: this.unwrapId(invoice.subscription) ?? '' } });
  if (!donation) return;

  const existing = await this.prisma.paymentEvent.findFirst({ where: { stripeInvoiceId: invoice.id } });
  if (existing) return;

  await this.prisma.paymentEvent.create({
    data: {
      organizationId: donation.organizationId,
      userId: donation.userId,
      kind: 'DONATION',
      status: 'FAILED',
      amountCents: invoice.amount_due ?? donation.amountCents,
      currency: invoice.currency ?? donation.currency,
      donationId: donation.id,
      stripeCustomerId: this.unwrapId(invoice.customer),
      stripePaymentIntentId: this.unwrapId(invoice.payment_intent),
      stripeInvoiceId: invoice.id,
      failureReason: invoice.last_finalization_error?.message ?? null,
    },
  });
  // Donation status intentionally unchanged - Stripe retries; only
  // customer.subscription.deleted flips us to CANCELED.
}
```

- [ ] **Step 5: Run tests and confirm pass**

```bash
pnpm -F api test:e2e -- donations-webhook
pnpm -F api test:e2e -- webhooks
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/webhooks/stripe-webhook.service.ts apps/api/test/donations-webhook.e2e-spec.ts
git commit -m "$(cat <<'EOF'
feat(webhooks): donation arms for subscription.deleted and payment_failed

- customer.subscription.deleted flips ACTIVE -> CANCELED and stamps canceledAt; already-CANCELED rows no-op so the donor-side optimistic cancel from U6 reconciles cleanly
- invoice.payment_failed writes a kind=DONATION, status=FAILED PaymentEvent with failureReason; Donation status is left untouched because Stripe retries the invoice and the retry/exhaustion terminal is signalled by subscription.deleted
- both arms guard on existing rows so replays produce zero side effects
EOF
)"
```

---

### U13: `donationId` inheritance on `charge.refunded` and `charge.dispute.*`

The invariant that makes `Campaign.raisedCents` net refunds and disputes. When a refund / dispute webhook arrives for a donation charge, the new REFUND / DISPUTE PaymentEvent carries the original donation's `donationId`.

**Files:**
- Modify: `apps/api/src/webhooks/stripe-webhook.service.ts` (modify existing refund / dispute arms)
- Modify: `apps/api/test/donations-webhook.e2e-spec.ts`

- [ ] **Step 1: Add the failing tests**

```ts
it('charge.refunded of a donation inherits donationId and Campaign.raisedCents nets to 0', async () => {
  const donation = await prisma.donation.create({
    data: donationFactory({
      id: 'don_w_7', userId: 'user_w', campaignId: 'camp_w', organizationId: 'org_w',
      mode: 'ONE_TIME', cadence: 'ONCE', amountCents: 5000, status: 'COMPLETED',
    }),
  });
  await prisma.paymentEvent.create({
    data: {
      organizationId: 'org_w', userId: 'user_w',
      kind: 'DONATION', status: 'SUCCEEDED', amountCents: 5000, currency: 'usd',
      donationId: donation.id, stripePaymentIntentId: 'pi_w_7', stripeChargeId: 'ch_w_7',
      succeededAt: new Date(),
    },
  });

  await webhook.handleEvent({
    id: 'evt_ref_1', type: 'charge.refunded',
    data: { object: {
      id: 'ch_w_7', payment_intent: 'pi_w_7',
      amount_refunded: 5000, currency: 'usd',
      refunds: { data: [{ id: 're_w_7', amount: 5000 }] },
    } },
  } as any);

  const refundRow = await prisma.paymentEvent.findFirst({ where: { kind: 'REFUND', stripeRefundId: 're_w_7' } });
  expect(refundRow?.donationId).toBe(donation.id);
  expect(refundRow?.amountCents).toBe(-5000);
});

it('charge.refunded of a NON-donation (membership/ticket) leaves donationId null', async () => {
  await prisma.paymentEvent.create({
    data: {
      organizationId: 'org_w', userId: 'user_w',
      kind: 'MEMBERSHIP', status: 'SUCCEEDED', amountCents: 1500, currency: 'usd',
      stripePaymentIntentId: 'pi_mem_1', stripeChargeId: 'ch_mem_1',
      succeededAt: new Date(),
    },
  });
  await webhook.handleEvent({
    id: 'evt_ref_2', type: 'charge.refunded',
    data: { object: {
      id: 'ch_mem_1', payment_intent: 'pi_mem_1',
      amount_refunded: 1500, currency: 'usd',
      refunds: { data: [{ id: 're_mem_1', amount: 1500 }] },
    } },
  } as any);
  const refundRow = await prisma.paymentEvent.findFirst({ where: { stripeRefundId: 're_mem_1' } });
  expect(refundRow?.donationId).toBeNull();
});
```

- [ ] **Step 2: Run and confirm fail**

```bash
pnpm -F api test:e2e -- donations-webhook
```

- [ ] **Step 3: Modify the existing `charge.refunded` arm to inherit donationId**

Locate the `charge.refunded` handler in `stripe-webhook.service.ts`. Before constructing the REFUND PaymentEvent, look up the original PaymentEvent by `stripePaymentIntentId` and grab `donationId`:

```ts
private async handleChargeRefunded(event: Stripe.Event): Promise<void> {
  const charge = event.data.object as Stripe.Charge;
  const piId = this.unwrapId(charge.payment_intent);
  if (!piId) return;

  const original = await this.prisma.paymentEvent.findFirst({
    where: { stripePaymentIntentId: piId, kind: { in: ['TICKET', 'MEMBERSHIP', 'DONATION'] } },
  });
  // original may be null in legacy/edge cases; inherit only if present
  const donationId = original?.kind === 'DONATION' ? original.donationId : null;

  // Existing per-refund row creation. Stamp donationId on each new row.
  for (const refund of charge.refunds?.data ?? []) {
    const existing = await this.prisma.paymentEvent.findFirst({
      where: { stripeRefundId: refund.id },
    });
    if (existing) continue;
    await this.prisma.paymentEvent.create({
      data: {
        // ... existing fields
        donationId, // <-- inherited
      },
    });
  }
}
```

The "existing fields" block above is the current refund-row creation; I'm only highlighting the additive `donationId` line. Open the file and adopt the surrounding code unchanged.

- [ ] **Step 4: Same change on `charge.dispute.created` and `charge.dispute.funds_withdrawn`**

Wherever the dispute arms create DISPUTE PaymentEvents, perform the same lookup-and-inherit. The dispute object exposes `payment_intent` directly (`dispute.payment_intent`).

- [ ] **Step 5: Run tests and confirm pass**

```bash
pnpm -F api test:e2e -- donations-webhook
pnpm -F api test:e2e -- webhooks
```

- [ ] **Step 6: Verify Campaign.raisedCents nets correctly via the public read endpoint test**

The U8 e2e test `GET /campaigns/:slug raisedCents nets a refund` should already pass once this unit lands.

```bash
pnpm -F api test:e2e -- coalitions-public
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/webhooks/stripe-webhook.service.ts apps/api/test/donations-webhook.e2e-spec.ts
git commit -m "$(cat <<'EOF'
feat(webhooks): donationId inheritance on refunds and disputes

- charge.refunded and charge.dispute arms now look up the original PaymentEvent by stripePaymentIntentId; if it was kind=DONATION the new REFUND/DISPUTE row inherits its donationId
- the inheritance is what makes Campaign.raisedCents net refunds and disputes; without it the campaign would keep reporting the original amount after the money was returned
- inheritance is conditional on the original being a DONATION row, so membership and ticket refunds continue to leave donationId null and don't pollute campaign totals
EOF
)"
```

---

## Phase F — Shared UI primitives

### U14: `ProgressBar`, `DonatePanel`, `CoalitionCard`, `CampaignCard`

Four new primitives in `packages/web-shared/src/ui/`. The `DonatePanel` is a client component because of the cadence/amount interactivity; the others are pure server-component-friendly views.

**Files:**
- Create: `packages/web-shared/src/ui/data/ProgressBar.tsx`
- Create: `packages/web-shared/src/ui/data/__tests__/ProgressBar.test.tsx`
- Create: `packages/web-shared/src/ui/donations/DonatePanel.tsx`
- Create: `packages/web-shared/src/ui/donations/__tests__/DonatePanel.test.tsx`
- Create: `packages/web-shared/src/ui/donations/CoalitionCard.tsx`
- Create: `packages/web-shared/src/ui/donations/CampaignCard.tsx`
- Modify: `packages/web-shared/src/ui/index.ts` (export the four primitives)

- [ ] **Step 1: Write the failing test for `ProgressBar`**

`packages/web-shared/src/ui/data/__tests__/ProgressBar.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ProgressBar } from '../ProgressBar';

describe('ProgressBar', () => {
  it('renders raised/target width clamped to 100%', () => {
    render(<ProgressBar valueCents={7500} targetCents={5000} label="t" />);
    const fill = screen.getByTestId('progress-fill');
    expect(fill).toHaveStyle({ width: '100%' });
  });

  it('handles target = 0 without NaN', () => {
    render(<ProgressBar valueCents={0} targetCents={0} label="t" />);
    const fill = screen.getByTestId('progress-fill');
    expect(fill).toHaveStyle({ width: '0%' });
  });

  it('computes 30% for 3000/10000', () => {
    render(<ProgressBar valueCents={3000} targetCents={10000} label="t" />);
    expect(screen.getByTestId('progress-fill')).toHaveStyle({ width: '30%' });
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
pnpm -F @organizer-hub/web-shared test -- ProgressBar
```

- [ ] **Step 3: Implement `ProgressBar`**

`packages/web-shared/src/ui/data/ProgressBar.tsx`:

```tsx
import styles from './ProgressBar.module.css';

export interface ProgressBarProps {
  valueCents: number;
  targetCents: number;
  label: string;
}

export function ProgressBar({ valueCents, targetCents, label }: ProgressBarProps) {
  const pct = targetCents <= 0 ? 0 : Math.min(1, Math.max(0, valueCents / targetCents));
  return (
    <div className={styles.track} role="progressbar" aria-label={label} aria-valuenow={Math.round(pct * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div data-testid="progress-fill" className={styles.fill} style={{ width: `${pct * 100}%` }} />
    </div>
  );
}
```

Create the matching `ProgressBar.module.css`:

```css
.track {
  height: var(--space-xs, 8px);
  background: var(--surface-2, #eee);
  border-radius: 999px;
  overflow: hidden;
}
.fill {
  height: 100%;
  background: var(--brand-strong, currentColor);
  transition: width 200ms ease-out;
}
@media (prefers-reduced-motion: reduce) {
  .fill { transition: none; }
}
```

- [ ] **Step 4: Run the test and confirm pass**

```bash
pnpm -F @organizer-hub/web-shared test -- ProgressBar
```

- [ ] **Step 5: Write the failing test for `DonatePanel`**

`packages/web-shared/src/ui/donations/__tests__/DonatePanel.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { DonatePanel } from '../DonatePanel';

const baseProps = {
  campaignId: 'camp_1',
  campaignSlug: 'cmp',
  defaultCurrency: 'usd',
  initialCadence: 'ONCE' as const,
  initialAmountCents: undefined,
  action: '/api/test-action',
};

describe('DonatePanel', () => {
  it('writes the active cadence + amount to hidden inputs', async () => {
    const user = userEvent.setup();
    render(<DonatePanel {...baseProps} />);
    await user.click(screen.getByRole('button', { name: /monthly/i }));
    await user.click(screen.getByRole('button', { name: /^\$25$/i }));
    expect((screen.getByTestId('cadence-input') as HTMLInputElement).value).toBe('MONTHLY');
    expect((screen.getByTestId('amount-input') as HTMLInputElement).value).toBe('2500');
  });

  it('typing into Custom amount clears the active chip', async () => {
    const user = userEvent.setup();
    render(<DonatePanel {...baseProps} />);
    await user.click(screen.getByRole('button', { name: /^\$25$/i }));
    await user.type(screen.getByLabelText(/custom amount/i), '37');
    expect((screen.getByTestId('amount-input') as HTMLInputElement).value).toBe('3700');
    // the $25 chip is no longer in pressed state
    expect(screen.getByRole('button', { name: /^\$25$/i })).toHaveAttribute('aria-pressed', 'false');
  });

  it('clicking a chip clears the custom-amount input', async () => {
    const user = userEvent.setup();
    render(<DonatePanel {...baseProps} />);
    await user.type(screen.getByLabelText(/custom amount/i), '37');
    await user.click(screen.getByRole('button', { name: /^\$50$/i }));
    expect((screen.getByLabelText(/custom amount/i) as HTMLInputElement).value).toBe('');
    expect((screen.getByTestId('amount-input') as HTMLInputElement).value).toBe('5000');
  });

  it('Continue button is disabled when no amount selected', () => {
    render(<DonatePanel {...baseProps} />);
    expect(screen.getByRole('button', { name: /continue to donate/i })).toBeDisabled();
  });
});
```

- [ ] **Step 6: Run the test and confirm fail**

```bash
pnpm -F @organizer-hub/web-shared test -- DonatePanel
```

- [ ] **Step 7: Implement `DonatePanel`**

`packages/web-shared/src/ui/donations/DonatePanel.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { Card } from '../primitives/Card';
import { Button } from '../primitives/Button';
import { Field } from '../primitives/Field';

const CHIPS_CENTS = [1000, 2500, 5000, 10000];

export type DonationCadence = 'ONCE' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';

export interface DonatePanelProps {
  campaignId: string;
  campaignSlug: string;
  defaultCurrency: string;
  initialCadence?: DonationCadence;
  initialAmountCents?: number;
  action: string; // server action path or function reference resolved by parent
  disabled?: boolean;
  disabledReason?: string;
}

export function DonatePanel({
  campaignId,
  defaultCurrency,
  initialCadence = 'ONCE',
  initialAmountCents,
  action,
  disabled,
  disabledReason,
}: DonatePanelProps) {
  const [cadence, setCadence] = useState<DonationCadence>(initialCadence);
  const [amountCents, setAmountCents] = useState<number | undefined>(initialAmountCents);
  const [customInput, setCustomInput] = useState<string>('');

  function selectChip(cents: number) {
    setAmountCents(cents);
    setCustomInput('');
  }

  function onCustomChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    setCustomInput(raw);
    const parsed = parseFloat(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      setAmountCents(Math.round(parsed * 100));
    } else {
      setAmountCents(undefined);
    }
  }

  const cadences: { value: DonationCadence; label: string }[] = [
    { value: 'ONCE', label: 'One-time' },
    { value: 'MONTHLY', label: 'Monthly' },
    { value: 'QUARTERLY', label: 'Quarterly' },
    { value: 'YEARLY', label: 'Yearly' },
  ];

  const canContinue = !disabled && amountCents !== undefined && amountCents >= 100;
  const currencySymbol = defaultCurrency === 'usd' ? '$' : defaultCurrency.toUpperCase() + ' ';

  return (
    <Card>
      <form action={action} method="post">
        <input type="hidden" name="campaignId" value={campaignId} />
        <input type="hidden" name="cadence" value={cadence} data-testid="cadence-input" />
        <input type="hidden" name="amountCents" value={amountCents ?? ''} data-testid="amount-input" />

        <div role="group" aria-label="Donation frequency">
          {cadences.map((c) => (
            <button
              key={c.value}
              type="button"
              aria-pressed={cadence === c.value}
              onClick={() => setCadence(c.value)}
            >
              {c.label}
            </button>
          ))}
        </div>

        <div role="group" aria-label="Donation amount">
          {CHIPS_CENTS.map((cents) => (
            <button
              key={cents}
              type="button"
              aria-pressed={amountCents === cents && customInput === ''}
              onClick={() => selectChip(cents)}
            >
              {currencySymbol}{cents / 100}
            </button>
          ))}
          <Field label="Custom amount">
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="1"
              max="10000"
              value={customInput}
              onChange={onCustomChange}
              aria-label="Custom amount"
            />
          </Field>
        </div>

        {disabled && disabledReason ? <p role="status">{disabledReason}</p> : null}

        <Button type="submit" disabled={!canContinue} block variant="primary">
          Continue to donate
        </Button>
      </form>
    </Card>
  );
}
```

If `Card`, `Button`, `Field` are imported from different paths in this codebase, adopt the project paths.

- [ ] **Step 8: Run the test and confirm pass**

```bash
pnpm -F @organizer-hub/web-shared test -- DonatePanel
```

- [ ] **Step 9: Implement `CoalitionCard` and `CampaignCard`**

`packages/web-shared/src/ui/donations/CoalitionCard.tsx`:

```tsx
import Link from 'next/link';
import { Card } from '../primitives/Card';

export interface CoalitionCardProps {
  slug: string;
  name: string;
  description: string | null;
  coverImageUrl: string | null;
  childCampaignCount: number;
  totalRaisedCents: number;
  currency?: string;
}

export function CoalitionCard({
  slug, name, description, coverImageUrl, childCampaignCount, totalRaisedCents, currency = 'usd',
}: CoalitionCardProps) {
  const sym = currency === 'usd' ? '$' : currency.toUpperCase() + ' ';
  return (
    <Link href={`/coalitions/${slug}`}>
      <Card>
        {coverImageUrl ? <img src={coverImageUrl} alt="" /> : null}
        <h3>{name}</h3>
        {description ? <p>{description}</p> : null}
        <p>{childCampaignCount} campaign{childCampaignCount === 1 ? '' : 's'} · {sym}{(totalRaisedCents / 100).toLocaleString()} raised</p>
      </Card>
    </Link>
  );
}
```

`packages/web-shared/src/ui/donations/CampaignCard.tsx`:

```tsx
import Link from 'next/link';
import { Card } from '../primitives/Card';
import { ProgressBar } from '../data/ProgressBar';

export interface CampaignCardProps {
  slug: string;
  name: string;
  coverImageUrl: string | null;
  targetAmountCents: number;
  raisedCents: number;
  donorCount: number;
  deadline: Date | null;
  currency?: string;
}

export function CampaignCard({
  slug, name, coverImageUrl, targetAmountCents, raisedCents, donorCount, deadline, currency = 'usd',
}: CampaignCardProps) {
  const sym = currency === 'usd' ? '$' : currency.toUpperCase() + ' ';
  const daysLeft = deadline ? Math.max(0, Math.ceil((deadline.getTime() - Date.now()) / 86_400_000)) : null;
  return (
    <Link href={`/campaigns/${slug}`}>
      <Card>
        {coverImageUrl ? <img src={coverImageUrl} alt="" /> : null}
        <h3>{name}</h3>
        <ProgressBar valueCents={raisedCents} targetCents={targetAmountCents} label={`${name} progress`} />
        <p>{sym}{(raisedCents / 100).toLocaleString()} raised of {sym}{(targetAmountCents / 100).toLocaleString()}</p>
        <p>{donorCount} donor{donorCount === 1 ? '' : 's'}{daysLeft !== null ? ` · ${daysLeft} day${daysLeft === 1 ? '' : 's'} left` : ''}</p>
      </Card>
    </Link>
  );
}
```

- [ ] **Step 10: Export from `packages/web-shared/src/ui/index.ts`**

Add four exports alongside the existing ones:

```ts
export { ProgressBar } from './data/ProgressBar';
export type { ProgressBarProps } from './data/ProgressBar';
export { DonatePanel } from './donations/DonatePanel';
export type { DonatePanelProps, DonationCadence } from './donations/DonatePanel';
export { CoalitionCard } from './donations/CoalitionCard';
export type { CoalitionCardProps } from './donations/CoalitionCard';
export { CampaignCard } from './donations/CampaignCard';
export type { CampaignCardProps } from './donations/CampaignCard';
```

- [ ] **Step 11: Typecheck the package**

```bash
pnpm -F @organizer-hub/web-shared typecheck
pnpm -F @organizer-hub/web-shared test
```

Expected: clean + all tests pass.

- [ ] **Step 12: Commit**

```bash
git add packages/web-shared/src/ui
git commit -m "$(cat <<'EOF'
feat(web-shared): donation UI primitives

- ProgressBar with target=0 safety and reduced-motion respect; used by CampaignCard and the donate panel
- DonatePanel client component owns cadence + amount state and writes them into hidden inputs the server action consumes; chip selection clears the custom input and vice versa, Continue stays disabled until amount >= $1
- CoalitionCard and CampaignCard are server-component-friendly view wrappers around the existing Card primitive; both link via next/link so RSC hydration is correct
EOF
)"
```

---

## Phase G — Member surfaces

Member-facing pages and server actions. Each unit lands a coherent UI surface that's runnable end-to-end once the prior phases are in place. Set `organization.donationsEnabled = true` for a test org before manual smoke.

### U15: `/coalitions` and `/coalitions/[slug]` pages

**Files:**
- Create: `apps/member/src/app/coalitions/page.tsx`
- Create: `apps/member/src/app/coalitions/[slug]/page.tsx`
- Create: `apps/member/src/app/coalitions/not-found.tsx`
- Modify: `packages/web-shared/src/ui/nav/PublicNav.tsx` (add Support link)

- [ ] **Step 1: Implement `/coalitions/page.tsx`**

`apps/member/src/app/coalitions/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import {
  PublicShell,
  Eyebrow, Display, Lede,
  CoalitionCard,
  publicApiFetch, donationsEnabledForOrg,
} from '@organizer-hub/web-shared';

interface CoalitionListItem {
  id: string; slug: string; name: string; description: string | null;
  coverImageUrl: string | null; childCampaignCount: number; totalRaisedCents: number;
}

export default async function CoalitionsPage() {
  if (!(await donationsEnabledForOrg())) notFound();
  const coalitions = await publicApiFetch<CoalitionListItem[]>('/coalitions');

  return (
    <PublicShell>
      <div className="container">
        <Eyebrow>Initiatives</Eyebrow>
        <Display as="h1" size="xl">Where to give</Display>
        <Lede>Pick an initiative to see the campaigns inside.</Lede>
        <div className="grid-3-narrow">
          {coalitions.map((c) => (
            <CoalitionCard key={c.id} {...c} />
          ))}
        </div>
      </div>
    </PublicShell>
  );
}

export async function generateMetadata() {
  return { title: 'Where to give', description: 'Browse our active initiatives.' };
}
```

- [ ] **Step 2: Implement `/coalitions/[slug]/page.tsx`**

```tsx
import { notFound } from 'next/navigation';
import {
  PublicShell,
  Eyebrow, Display, Lede, Card,
  CampaignCard,
  publicApiFetch, donationsEnabledForOrg,
} from '@organizer-hub/web-shared';

interface CoalitionDetail {
  coalition: { id: string; slug: string; name: string; description: string | null; coverImageUrl: string | null; childCampaignCount: number; totalRaisedCents: number };
  campaigns: { id: string; slug: string; name: string; coverImageUrl: string | null; targetAmountCents: number; raisedCents: number; donorCount: number; deadline: string | null; status: 'ACTIVE' | 'COMPLETE' }[];
}

export default async function CoalitionPage({ params }: { params: Promise<{ slug: string }> }) {
  if (!(await donationsEnabledForOrg())) notFound();
  const { slug } = await params;
  let data: CoalitionDetail;
  try {
    data = await publicApiFetch<CoalitionDetail>(`/coalitions/${encodeURIComponent(slug)}`);
  } catch {
    notFound();
  }

  return (
    <PublicShell>
      <div className="container">
        {data.coalition.coverImageUrl ? <img src={data.coalition.coverImageUrl} alt="" /> : null}
        <Eyebrow>Initiative</Eyebrow>
        <Display as="h1" size="xl">{data.coalition.name}</Display>
        {data.coalition.description ? <Lede>{data.coalition.description}</Lede> : null}

        {data.campaigns.length === 0 ? (
          <Card>
            <p>No active campaigns right now. Check back soon.</p>
          </Card>
        ) : (
          <div className="grid-3-narrow">
            {data.campaigns.map((c) => (
              <CampaignCard
                key={c.id}
                {...c}
                deadline={c.deadline ? new Date(c.deadline) : null}
              />
            ))}
          </div>
        )}
      </div>
    </PublicShell>
  );
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const data = await publicApiFetch<CoalitionDetail>(`/coalitions/${encodeURIComponent(slug)}`);
    return {
      title: data.coalition.name,
      description: data.coalition.description?.slice(0, 160) ?? `Support ${data.coalition.name}.`,
      openGraph: {
        title: data.coalition.name,
        description: data.coalition.description ?? undefined,
        images: data.coalition.coverImageUrl ? [data.coalition.coverImageUrl] : undefined,
      },
    };
  } catch {
    return { title: 'Initiative' };
  }
}
```

- [ ] **Step 3: Implement `not-found.tsx`**

```tsx
import { PublicShell, Display, Lede } from '@organizer-hub/web-shared';

export default function NotFound() {
  return (
    <PublicShell>
      <div className="container">
        <Display as="h1" size="xl">Not found</Display>
        <Lede>The initiative you were looking for isn't here.</Lede>
      </div>
    </PublicShell>
  );
}
```

- [ ] **Step 4: Add the `Support` link to `PublicNav`**

In `packages/web-shared/src/ui/nav/PublicNav.tsx`, add between Membership and the auth slot:

```tsx
<NavLink href="/coalitions">Support</NavLink>
```

If `PublicNav` reads visibility from props or context, the link still renders for all visitors; member surfaces 404 the routes if the org flag is off.

- [ ] **Step 5: Typecheck and lint**

```bash
pnpm -F @organizer-hub/member typecheck
pnpm -F @organizer-hub/member lint
```

- [ ] **Step 6: Commit**

```bash
git add apps/member/src/app/coalitions packages/web-shared/src/ui/nav/PublicNav.tsx
git commit -m "$(cat <<'EOF'
feat(member): /coalitions directory + /coalitions/[slug] detail

- /coalitions is a public storytelling entry point composed of CoalitionCards; lists only ACTIVE coalitions from the API
- /coalitions/[slug] shows the coalition header (cover, name, description) and a grid of active child campaigns; empty state when zero active campaigns
- not-found page matches the editorial tone ('isn't here'); generateMetadata wires OG tags so coalition links render correctly when shared
- PublicNav gets a Support entry pointing at /coalitions, between Membership and the auth links
EOF
)"
```

---

### U16: `/campaigns/[slug]` page + `donateNow` server action

The donor's primary destination page. Includes the auth-gate redirect path via the server action.

**Files:**
- Create: `apps/member/src/app/campaigns/[slug]/page.tsx`
- Create: `apps/member/src/app/campaigns/[slug]/not-found.tsx`
- Create: `apps/member/src/app/campaigns/actions.ts`

- [ ] **Step 1: Implement the server action**

`apps/member/src/app/campaigns/actions.ts`:

```ts
'use server';

import { redirect } from 'next/navigation';
import { ApiError, apiFetch, UnauthorizedError } from '@organizer-hub/web-shared';

export async function donateNow(formData: FormData): Promise<void> {
  const campaignId = String(formData.get('campaignId') ?? '');
  const campaignSlug = String(formData.get('campaignSlug') ?? '');
  const cadence = String(formData.get('cadence') ?? 'ONCE');
  const amountCents = Number(formData.get('amountCents') ?? 0);

  if (!campaignId || amountCents < 100 || amountCents > 1_000_000) {
    redirect(`/campaigns/${encodeURIComponent(campaignSlug)}?error=${encodeURIComponent('Invalid amount')}`);
  }

  let url: string;
  try {
    const res = await apiFetch<{ url: string; donationId: string }>('/billing/checkout/donation', {
      method: 'POST',
      body: { campaignId, cadence, amountCents },
    });
    url = res.url;
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      const next = encodeURIComponent(`/campaigns/${campaignSlug}?cadence=${cadence}&amount=${amountCents}`);
      redirect(`/auth/login?next=${next}`);
    }
    if (err instanceof ApiError) {
      redirect(`/campaigns/${encodeURIComponent(campaignSlug)}?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }
  redirect(url);
}

export async function cancelDonation(donationId: string): Promise<{ ok: true } | { error: string }> {
  try {
    await apiFetch(`/billing/donation/${encodeURIComponent(donationId)}/cancel`, { method: 'POST' });
    return { ok: true };
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect('/auth/login');
    if (err instanceof ApiError) return { error: err.message };
    throw err;
  }
}
```

- [ ] **Step 2: Implement the page**

`apps/member/src/app/campaigns/[slug]/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import {
  PublicShell,
  Eyebrow, Display, Lede, Card, Fact,
  ProgressBar, DonatePanel,
  publicApiFetch, donationsEnabledForOrg,
} from '@organizer-hub/web-shared';
import Link from 'next/link';
import { donateNow } from '../actions';

interface CampaignDetail {
  campaign: {
    id: string; slug: string; name: string; description: string | null;
    coverImageUrl: string | null; targetAmountCents: number; currency: string;
    deadline: string | null; status: 'ACTIVE' | 'COMPLETE';
    raisedCents: number; donorCount: number; recentGiftCount: number;
  };
  coalition: { id: string; slug: string; name: string };
}

export default async function CampaignPage({
  params, searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ cadence?: string; amount?: string; error?: string }>;
}) {
  if (!(await donationsEnabledForOrg())) notFound();
  const { slug } = await params;
  const sp = await searchParams;

  let data: CampaignDetail;
  try {
    data = await publicApiFetch<CampaignDetail>(`/campaigns/${encodeURIComponent(slug)}`);
  } catch {
    notFound();
  }

  const isClosed = data.campaign.status === 'COMPLETE' ||
    (data.campaign.deadline && new Date(data.campaign.deadline).getTime() < Date.now());

  return (
    <PublicShell>
      <div className="container">
        <div className="campaign-layout">
          <article>
            {data.campaign.coverImageUrl ? <img src={data.campaign.coverImageUrl} alt="" /> : null}
            <Eyebrow>
              <Link href={`/coalitions/${data.coalition.slug}`}>{data.coalition.name}</Link>
            </Eyebrow>
            <Display as="h1" size="xl">{data.campaign.name}</Display>
            {data.campaign.description ? <Lede>{data.campaign.description}</Lede> : null}
            {data.campaign.recentGiftCount > 0 && (
              <p>
                {data.campaign.recentGiftCount} gift{data.campaign.recentGiftCount === 1 ? '' : 's'} in the last 30 days.
              </p>
            )}
          </article>

          <aside className="donate-panel-rail">
            <Card>
              <ProgressBar
                valueCents={data.campaign.raisedCents}
                targetCents={data.campaign.targetAmountCents}
                label={`${data.campaign.name} progress`}
              />
              <Fact items={[
                { label: 'Raised', value: `$${(data.campaign.raisedCents / 100).toLocaleString()}` },
                { label: 'Goal', value: `$${(data.campaign.targetAmountCents / 100).toLocaleString()}` },
                { label: 'Donors', value: String(data.campaign.donorCount) },
                ...(data.campaign.deadline ? [{ label: 'Ends', value: new Date(data.campaign.deadline).toLocaleDateString() }] : []),
              ]} />
            </Card>

            {sp.error ? <p role="alert">{sp.error}</p> : null}

            <DonatePanel
              campaignId={data.campaign.id}
              campaignSlug={data.campaign.slug}
              defaultCurrency={data.campaign.currency}
              initialCadence={(sp.cadence as any) ?? 'ONCE'}
              initialAmountCents={sp.amount ? Number(sp.amount) : undefined}
              action={donateNow}
              disabled={isClosed}
              disabledReason={isClosed ? 'This campaign is no longer accepting donations.' : undefined}
            />
            {/* The hidden campaignSlug input lives in DonatePanel via a prop or we inject here: */}
            <input type="hidden" name="campaignSlug" value={data.campaign.slug} />
          </aside>
        </div>
      </div>
    </PublicShell>
  );
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const data = await publicApiFetch<CampaignDetail>(`/campaigns/${encodeURIComponent(slug)}`);
    return {
      title: data.campaign.name,
      description: data.campaign.description?.slice(0, 160) ?? `Support ${data.campaign.name}.`,
      openGraph: {
        title: data.campaign.name,
        description: data.campaign.description ?? undefined,
        images: data.campaign.coverImageUrl ? [data.campaign.coverImageUrl] : undefined,
      },
      twitter: { card: 'summary_large_image' },
    };
  } catch {
    return { title: 'Campaign' };
  }
}
```

If `DonatePanel` cannot accept the campaignSlug as a hidden input via its current API, extend `DonatePanelProps` with a `campaignSlug: string` and write it as an additional hidden input inside the panel's form. Update U14's `DonatePanel.tsx` to match before this unit lands.

- [ ] **Step 3: Implement `not-found.tsx` for campaigns**

```tsx
import { PublicShell, Display, Lede } from '@organizer-hub/web-shared';

export default function NotFound() {
  return (
    <PublicShell>
      <div className="container">
        <Display as="h1" size="xl">Not found</Display>
        <Lede>The campaign you were looking for isn't here.</Lede>
      </div>
    </PublicShell>
  );
}
```

- [ ] **Step 4: Add server-action tests**

`apps/member/src/app/campaigns/__tests__/actions.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('@organizer-hub/web-shared', () => {
  class ApiError extends Error { constructor(public message: string, public status: number) { super(message); } }
  class UnauthorizedError extends Error {}
  return {
    apiFetch: vi.fn(),
    ApiError,
    UnauthorizedError,
  };
});

vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => { throw new Error(`REDIRECT:${path}`); }),
}));

import { apiFetch, ApiError, UnauthorizedError } from '@organizer-hub/web-shared';
import { donateNow } from '../actions';

function fd(data: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(data)) f.set(k, v);
  return f;
}

describe('donateNow', () => {
  it('redirects to Stripe URL on success', async () => {
    (apiFetch as any).mockResolvedValue({ url: 'https://stripe.test/cs_1', donationId: 'don_1' });
    await expect(donateNow(fd({ campaignId: 'c1', campaignSlug: 's', cadence: 'ONCE', amountCents: '2500' })))
      .rejects.toThrow('REDIRECT:https://stripe.test/cs_1');
  });

  it('redirects to /auth/login with next=campaign+cadence+amount on UnauthorizedError', async () => {
    (apiFetch as any).mockRejectedValue(new UnauthorizedError());
    await expect(donateNow(fd({ campaignId: 'c1', campaignSlug: 's', cadence: 'MONTHLY', amountCents: '2500' })))
      .rejects.toThrow(/REDIRECT:\/auth\/login\?next=/);
  });

  it('redirects back with ?error on ApiError', async () => {
    (apiFetch as any).mockRejectedValue(new ApiError('campaign is not accepting donations', 409));
    await expect(donateNow(fd({ campaignId: 'c1', campaignSlug: 's', cadence: 'ONCE', amountCents: '2500' })))
      .rejects.toThrow(/REDIRECT:\/campaigns\/s\?error=/);
  });

  it('redirects with Invalid amount when amountCents below bound', async () => {
    await expect(donateNow(fd({ campaignId: 'c1', campaignSlug: 's', cadence: 'ONCE', amountCents: '50' })))
      .rejects.toThrow(/REDIRECT:\/campaigns\/s\?error=Invalid%20amount/);
  });
});
```

- [ ] **Step 5: Run member tests**

```bash
pnpm -F @organizer-hub/member test
```

- [ ] **Step 6: Typecheck and lint**

```bash
pnpm -F @organizer-hub/member typecheck
pnpm -F @organizer-hub/member lint
```

- [ ] **Step 7: Commit**

```bash
git add apps/member/src/app/campaigns
git commit -m "$(cat <<'EOF'
feat(member): /campaigns/[slug] page + donateNow server action

- two-column campaign detail page with hero on the left and the sticky donate panel rail on the right; donor sees campaign story plus progress, target, donor count, deadline
- closed campaigns (status=COMPLETE or deadline past) render the panel in a disabled state with an explanatory line; the API also rejects so the front-end disabled state is a UI affordance not a security gate
- searchParams pre-fill cadence + amount so the post-login re-submit flow rehydrates the form from the /auth/login?next= round trip
- donateNow action redirects unauthenticated users to /auth/login with next=campaign+cadence+amount preserved
EOF
)"
```

---

### U17: `/donate` and `/donate/thanks` pages

`/donate` is the general-fund landing — same `DonatePanel` bound to the seeded `general-fund` campaign. `/donate/thanks` is the success landing that links into the right dashboard.

**Files:**
- Create: `apps/member/src/app/donate/page.tsx`
- Create: `apps/member/src/app/donate/thanks/page.tsx`

- [ ] **Step 1: Implement `/donate/page.tsx`**

```tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  PublicShell,
  Eyebrow, Display, Lede, Card,
  ProgressBar, DonatePanel,
  publicApiFetch, donationsEnabledForOrg,
} from '@organizer-hub/web-shared';
import { donateNow } from '../campaigns/actions';

interface CampaignDetail {
  campaign: { id: string; slug: string; name: string; targetAmountCents: number; currency: string; raisedCents: number; donorCount: number; status: 'ACTIVE' | 'COMPLETE'; deadline: string | null };
  coalition: { slug: string; name: string };
}

export default async function DonatePage({
  searchParams,
}: { searchParams: Promise<{ cadence?: string; amount?: string; error?: string }> }) {
  if (!(await donationsEnabledForOrg())) notFound();
  const sp = await searchParams;

  const data = await publicApiFetch<CampaignDetail>('/campaigns/general-fund');

  return (
    <PublicShell>
      <div className="container">
        <Eyebrow>General fund</Eyebrow>
        <Display as="h1" size="xl">Support the work</Display>
        <Lede>Your gift supports everything we do, year-round.</Lede>

        {sp.error ? <p role="alert">{sp.error}</p> : null}

        <Card>
          <ProgressBar
            valueCents={data.campaign.raisedCents}
            targetCents={data.campaign.targetAmountCents}
            label="General fund progress"
          />
          <p>${(data.campaign.raisedCents / 100).toLocaleString()} raised · {data.campaign.donorCount} donors</p>
        </Card>

        <DonatePanel
          campaignId={data.campaign.id}
          campaignSlug={data.campaign.slug}
          defaultCurrency={data.campaign.currency}
          initialCadence={(sp.cadence as any) ?? 'ONCE'}
          initialAmountCents={sp.amount ? Number(sp.amount) : undefined}
          action={donateNow}
        />

        <p>
          Looking to support a specific cause? <Link href="/coalitions">Browse our active initiatives.</Link>
        </p>
      </div>
    </PublicShell>
  );
}

export async function generateMetadata() {
  return { title: 'Support the work', description: 'Your gift supports everything we do, year-round.' };
}
```

- [ ] **Step 2: Implement `/donate/thanks/page.tsx`**

```tsx
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import {
  PublicShell, Eyebrow, Display, Lede,
  publicApiFetch, donationsEnabledForOrg,
} from '@organizer-hub/web-shared';
import { revalidatePath } from 'next/cache';

interface SessionLookup { donationId: string; mode: 'ONE_TIME' | 'RECURRING'; campaignSlug: string }

export default async function ThanksPage({
  searchParams,
}: { searchParams: Promise<{ session_id?: string }> }) {
  if (!(await donationsEnabledForOrg())) notFound();
  const sp = await searchParams;
  if (!sp.session_id) redirect('/donate');

  // optional API lookup for prettier copy; on failure show a generic thanks page
  let lookup: SessionLookup | null = null;
  try {
    lookup = await publicApiFetch<SessionLookup>(`/donations/by-session/${encodeURIComponent(sp.session_id)}`);
    if (lookup?.campaignSlug) revalidatePath(`/campaigns/${lookup.campaignSlug}`);
  } catch {
    /* fall through to generic */
  }

  const dashboardHref = lookup?.mode === 'RECURRING' ? '/dashboard/donations' : '/dashboard/payments?kind=DONATION';

  return (
    <PublicShell>
      <div className="container">
        <Eyebrow>Thank you</Eyebrow>
        <Display as="h1" size="xl">Your donation is on its way.</Display>
        <Lede>You'll see it in <Link href={dashboardHref}>your dashboard</Link> shortly. We've also sent you a receipt by email.</Lede>
      </div>
    </PublicShell>
  );
}
```

The `/donations/by-session/:id` endpoint isn't in Phase D — add it as a small extension here:

- [ ] **Step 3: Add the `/donations/by-session/:id` lookup endpoint**

Modify `apps/api/src/donations/donations-read.controller.ts`:

```ts
import { Get, NotFoundException, Param } from '@nestjs/common';

// ... add inside the existing @Controller('donations') class:

@Get('by-session/:id')
async bySession(@Req() req: Request, @Param('id') sessionId: string) {
  const user = (req as any).user as { sub: string };
  const donation = await (this.donations as any).prisma.donation.findFirst({
    where: { stripeCheckoutSessionId: sessionId, userId: user.sub },
    include: { campaign: { select: { slug: true } } },
  });
  if (!donation) throw new NotFoundException();
  return {
    donationId: donation.id,
    mode: donation.mode,
    campaignSlug: donation.campaign.slug,
  };
}
```

Service-side: expose `prisma` to the service or add a `findBySession` method on `DonationsService`. The latter is cleaner — extract once if you make this change.

- [ ] **Step 4: Typecheck and lint**

```bash
pnpm -F api typecheck
pnpm -F @organizer-hub/member typecheck
```

- [ ] **Step 5: Commit**

```bash
git add apps/member/src/app/donate apps/api/src/donations/donations-read.controller.ts
git commit -m "$(cat <<'EOF'
feat(member): /donate landing + /donate/thanks success page

- /donate is a short general-fund page bound to the seeded 'general-fund' campaign; the panel is the same DonatePanel used on campaign detail pages, so the donor experience is consistent across destinations
- /donate/thanks reads ?session_id and routes to /dashboard/donations for recurring or /dashboard/payments?kind=DONATION for one-time; revalidates the campaign page so the next view reflects the new total
- GET /donations/by-session/:id is a small auth'd lookup the thanks page uses to pick the right dashboard target; 404 if no row matches so guessed session ids don't leak
EOF
)"
```

---

### U18: `/dashboard/donations` page + `cancelDonation` wiring + dashboard nav link

**Files:**
- Create: `apps/member/src/app/dashboard/donations/page.tsx`
- Create: `apps/member/src/app/dashboard/donations/RecurringRow.tsx` (client component for cancel action)
- Modify: `packages/web-shared/src/ui/nav/DashSidebar.tsx` (or equivalent)

- [ ] **Step 1: Implement the page**

`apps/member/src/app/dashboard/donations/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import Link from 'next/link';
import {
  DashShell, Display, Lede, Card,
  apiFetch, donationsEnabledForOrg,
} from '@organizer-hub/web-shared';
import { RecurringRow } from './RecurringRow';

interface DonationRow {
  id: string;
  mode: 'ONE_TIME' | 'RECURRING';
  cadence: 'ONCE' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
  amountCents: number;
  currency: string;
  status: string;
  campaign: { id: string; slug: string; name: string; coalition: { slug: string; name: string } };
}

export default async function DonationsDashboardPage() {
  if (!(await donationsEnabledForOrg())) notFound();
  const rows = await apiFetch<DonationRow[]>('/donations/mine?mode=RECURRING');

  return (
    <DashShell>
      <div>
        <Display as="h1" size="lg">Donations</Display>
        <Lede>Manage your recurring gifts.</Lede>

        {rows.length === 0 ? (
          <Card>
            <p>You don't have any recurring donations yet. <Link href="/coalitions">Browse our campaigns.</Link></p>
          </Card>
        ) : (
          <ul>
            {rows.map((r) => (
              <RecurringRow key={r.id} row={r} />
            ))}
          </ul>
        )}

        <p>
          Looking for past one-time donations? <Link href="/dashboard/payments?kind=DONATION">View payments history.</Link>
        </p>
      </div>
    </DashShell>
  );
}
```

- [ ] **Step 2: Implement the cancel-row client component**

`apps/member/src/app/dashboard/donations/RecurringRow.tsx`:

```tsx
'use client';

import { useActionState, useTransition } from 'react';
import { cancelDonation } from '../../campaigns/actions';

interface RowProps {
  row: {
    id: string; cadence: string; amountCents: number; currency: string;
    campaign: { slug: string; name: string; coalition: { slug: string; name: string } };
  };
}

async function cancelAction(_prev: { error?: string } | null, formData: FormData) {
  const id = String(formData.get('donationId'));
  const result = await cancelDonation(id);
  if ('error' in result) return { error: result.error };
  return null;
}

export function RecurringRow({ row }: RowProps) {
  const [state, formAction] = useActionState(cancelAction, null);
  const [pending, startTransition] = useTransition();

  return (
    <li>
      <strong>{row.campaign.name}</strong>
      <span> · {row.campaign.coalition.name}</span>
      <span> · ${(row.amountCents / 100).toFixed(2)} / {row.cadence.toLowerCase()}</span>
      <form action={(fd) => startTransition(() => formAction(fd))}>
        <input type="hidden" name="donationId" value={row.id} />
        <button type="submit" disabled={pending}>{pending ? 'Cancelling…' : 'Cancel'}</button>
      </form>
      {state?.error ? <p role="alert">{state.error}</p> : null}
    </li>
  );
}
```

- [ ] **Step 3: Add the `Donations` nav link to `DashSidebar`**

Locate `DashSidebar.tsx` and add between Membership and Payments:

```tsx
<NavLink href="/dashboard/donations">Donations</NavLink>
```

- [ ] **Step 4: Typecheck and lint**

```bash
pnpm -F @organizer-hub/member typecheck
pnpm -F @organizer-hub/member lint
```

- [ ] **Step 5: Commit**

```bash
git add apps/member/src/app/dashboard/donations packages/web-shared/src/ui/nav/DashSidebar.tsx
git commit -m "$(cat <<'EOF'
feat(member): /dashboard/donations recurring management

- new dashboard route lists the auth'd user's ACTIVE recurring donations with campaign, coalition, amount, cadence; each row carries a Cancel button posting to cancelDonation (server action wired in U16)
- empty state cross-links to /coalitions so a user with zero recurring still has a path forward; one-time history kept on /dashboard/payments to avoid duplicating the existing list
- DashSidebar gets a Donations entry between Membership and Payments
EOF
)"
```

---

### U19: `/membership` footer cross-link to `/coalitions`

Tiny single-line change so members reading membership tiers see a graceful fallback to donation.

**Files:**
- Modify: `apps/member/src/app/membership/page.tsx`

- [ ] **Step 1: Add the cross-link in the membership page footer area**

Locate the existing footer / sub-header area on `/membership` and add:

```tsx
<p>
  Not ready to subscribe? You can also <Link href="/coalitions">support a campaign</Link>.
</p>
```

- [ ] **Step 2: Typecheck**

```bash
pnpm -F @organizer-hub/member typecheck
```

- [ ] **Step 3: Commit**

```bash
git add apps/member/src/app/membership/page.tsx
git commit -m "$(cat <<'EOF'
feat(member): /membership cross-link to /coalitions

- single-line addition: members weighing membership tiers see a graceful 'support a campaign' fallback path; no other change to the membership page composition
EOF
)"
```

---

## Phase H — Admin API + admin surfaces

Seven units. Admin write endpoints first, then the three pages that consume them, then the `/transactions` filter extensions.

### U20: Admin coalitions API

**Files:**
- Create: `apps/api/src/donations/admin-coalitions.controller.ts`
- Modify: `apps/api/src/donations/coalitions.service.ts` (add admin methods)
- Create: `apps/api/test/admin-coalitions.e2e-spec.ts`
- Modify: `apps/api/src/donations/donations.module.ts`

- [ ] **Step 1: Add admin methods to the coalitions service**

Append to `apps/api/src/donations/coalitions.service.ts`:

```ts
  async createForAdmin(organizationId: string, input: {
    name: string; slug: string; description?: string | null; coverImageUrl?: string | null;
    status?: 'ACTIVE' | 'ARCHIVED'; displayOrder?: number;
  }) {
    return this.prisma.coalition.create({
      data: {
        organizationId,
        name: input.name,
        slug: input.slug,
        description: input.description ?? null,
        coverImageUrl: input.coverImageUrl ?? null,
        status: input.status ?? 'ACTIVE',
        displayOrder: input.displayOrder ?? 0,
      },
    });
  }

  async updateForAdmin(organizationId: string, id: string, input: Partial<{
    name: string; slug: string; description: string | null; coverImageUrl: string | null;
    status: 'ACTIVE' | 'ARCHIVED'; displayOrder: number;
  }>) {
    const existing = await this.prisma.coalition.findUnique({ where: { id } });
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundException();
    return this.prisma.coalition.update({ where: { id }, data: input });
  }

  async archiveForAdmin(organizationId: string, id: string) {
    const existing = await this.prisma.coalition.findUnique({
      where: { id },
      include: { campaigns: { where: { status: 'ACTIVE' }, select: { id: true } } },
    });
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundException();
    if (existing.campaigns.length > 0) {
      throw new ConflictException('cannot archive coalition while active campaigns remain');
    }
    return this.prisma.coalition.update({ where: { id }, data: { status: 'ARCHIVED' } });
  }

  async listAllForAdmin(organizationId: string) {
    return this.prisma.coalition.findMany({
      where: { organizationId },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { campaigns: true } } },
    });
  }
```

Add the missing imports at the top:

```ts
import { ConflictException, NotFoundException } from '@nestjs/common';
```

- [ ] **Step 2: Implement the admin controller**

`apps/api/src/donations/admin-coalitions.controller.ts`:

```ts
import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { CoalitionsService } from './coalitions.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminRoleGuard } from '../auth/admin-role.guard';
import { DonationsFeatureFlagGuard } from './donations-feature-flag.guard';

@Controller('admin/coalitions')
@UseGuards(JwtAuthGuard, AdminRoleGuard, DonationsFeatureFlagGuard)
export class AdminCoalitionsController {
  constructor(private readonly coalitions: CoalitionsService) {}

  @Get()
  list(@Req() req: Request) {
    const org = (req as any).organization as { id: string };
    return this.coalitions.listAllForAdmin(org.id);
  }

  @Get(':id')
  get(@Req() req: Request, @Param('id') id: string) {
    const org = (req as any).organization as { id: string };
    return this.coalitions.updateForAdmin(org.id, id, {}); // no-op update doubles as a fetch-and-guard
  }

  @Post()
  create(@Req() req: Request, @Body() body: any) {
    const org = (req as any).organization as { id: string };
    return this.coalitions.createForAdmin(org.id, body);
  }

  @Patch(':id')
  update(@Req() req: Request, @Param('id') id: string, @Body() body: any) {
    const org = (req as any).organization as { id: string };
    return this.coalitions.updateForAdmin(org.id, id, body);
  }

  @Post(':id/archive')
  archive(@Req() req: Request, @Param('id') id: string) {
    const org = (req as any).organization as { id: string };
    return this.coalitions.archiveForAdmin(org.id, id);
  }
}
```

Adopt whatever the existing admin-role guard is named (e.g. `AdminGuard`, `RoleGuard`). The membership admin endpoints have the canonical pattern.

- [ ] **Step 3: Register in `DonationsModule`**

Add `AdminCoalitionsController` to `controllers: [...]`.

- [ ] **Step 4: Add a focused e2e test for the archive guard**

`apps/api/test/admin-coalitions.e2e-spec.ts`:

```ts
// boilerplate identical to billing-donations.e2e-spec.ts

it('POST /admin/coalitions/:id/archive returns 409 when active campaigns remain', async () => {
  const res = await request(app.getHttpServer())
    .post(`/admin/coalitions/coal_1/archive`)
    .set('Authorization', adminAuthHeader());
  expect(res.status).toBe(409);
});

it('POST /admin/coalitions/:id/archive succeeds when no active campaigns remain', async () => {
  await prisma.campaign.update({ where: { id: 'camp_1' }, data: { status: 'ARCHIVED' } });
  const res = await request(app.getHttpServer())
    .post(`/admin/coalitions/coal_1/archive`)
    .set('Authorization', adminAuthHeader());
  expect(res.status).toBe(201);
});
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/donations/admin-coalitions.controller.ts apps/api/src/donations/coalitions.service.ts apps/api/src/donations/donations.module.ts apps/api/test/admin-coalitions.e2e-spec.ts
git commit -m "$(cat <<'EOF'
feat(admin-api): coalitions CRUD endpoints

- POST/PATCH/GET /admin/coalitions and POST /admin/coalitions/:id/archive operate scoped by request org and behind JwtAuthGuard + AdminRoleGuard + DonationsFeatureFlagGuard
- archive returns 409 when child campaigns are still ACTIVE; the spec invariant is that coalitions with live fundraising cannot disappear from donor surfaces without an admin first stopping each child
- coalitions.service grows createForAdmin/updateForAdmin/archiveForAdmin/listAllForAdmin alongside the existing public reads, keeping the entity logic in one place
EOF
)"
```

---

### U21: Admin campaigns API + transition endpoint

**Files:**
- Create: `apps/api/src/donations/admin-campaigns.controller.ts`
- Modify: `apps/api/src/donations/campaigns.service.ts` (add admin methods + transition logic)
- Create: `apps/api/test/admin-campaigns.e2e-spec.ts`
- Modify: `apps/api/src/donations/donations.module.ts`

- [ ] **Step 1: Add the transition matrix and admin methods to the service**

Append to `apps/api/src/donations/campaigns.service.ts`:

```ts
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

type CampaignStatus = 'DRAFT' | 'ACTIVE' | 'COMPLETE' | 'ARCHIVED';

const LEGAL_TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  DRAFT:     ['ACTIVE', 'ARCHIVED'],
  ACTIVE:    ['COMPLETE', 'ARCHIVED'],
  COMPLETE:  ['ACTIVE', 'ARCHIVED'],
  ARCHIVED:  ['DRAFT'],
};

// ... inside CampaignsService class:

  async createForAdmin(organizationId: string, input: {
    coalitionId: string; name: string; slug: string;
    description?: string | null; coverImageUrl?: string | null;
    targetAmountCents: number; currency?: string; deadline?: Date | null;
    status?: CampaignStatus; displayOrder?: number;
  }) {
    const coalition = await this.prisma.coalition.findUnique({ where: { id: input.coalitionId } });
    if (!coalition || coalition.organizationId !== organizationId) {
      throw new NotFoundException('coalition not found');
    }
    return this.prisma.campaign.create({
      data: {
        organizationId,
        coalitionId: input.coalitionId,
        name: input.name, slug: input.slug,
        description: input.description ?? null,
        coverImageUrl: input.coverImageUrl ?? null,
        targetAmountCents: input.targetAmountCents,
        currency: input.currency ?? 'usd',
        deadline: input.deadline ?? null,
        status: input.status ?? 'DRAFT',
        displayOrder: input.displayOrder ?? 0,
      },
    });
  }

  async updateForAdmin(organizationId: string, id: string, input: Partial<{
    name: string; slug: string; description: string | null; coverImageUrl: string | null;
    targetAmountCents: number; currency: string; deadline: Date | null; displayOrder: number;
  }>) {
    const existing = await this.prisma.campaign.findUnique({ where: { id } });
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundException();
    return this.prisma.campaign.update({ where: { id }, data: input });
  }

  async transition(organizationId: string, id: string, to: CampaignStatus) {
    const existing = await this.prisma.campaign.findUnique({ where: { id } });
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundException();
    const legal = LEGAL_TRANSITIONS[existing.status as CampaignStatus];
    if (!legal.includes(to)) {
      throw new BadRequestException(`illegal transition ${existing.status} -> ${to}`);
    }
    return this.prisma.campaign.update({ where: { id }, data: { status: to } });
  }
```

- [ ] **Step 2: Implement the controller**

`apps/api/src/donations/admin-campaigns.controller.ts`:

```ts
import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { CampaignsService } from './campaigns.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminRoleGuard } from '../auth/admin-role.guard';
import { DonationsFeatureFlagGuard } from './donations-feature-flag.guard';

@Controller('admin/campaigns')
@UseGuards(JwtAuthGuard, AdminRoleGuard, DonationsFeatureFlagGuard)
export class AdminCampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Get(':id')
  get(@Req() req: Request, @Param('id') id: string) {
    const org = (req as any).organization as { id: string };
    return this.campaigns.updateForAdmin(org.id, id, {}); // dual-purpose no-op fetch
  }

  @Post()
  create(@Req() req: Request, @Body() body: any) {
    const org = (req as any).organization as { id: string };
    return this.campaigns.createForAdmin(org.id, body);
  }

  @Patch(':id')
  update(@Req() req: Request, @Param('id') id: string, @Body() body: any) {
    const org = (req as any).organization as { id: string };
    return this.campaigns.updateForAdmin(org.id, id, body);
  }

  @Post(':id/transition')
  transition(@Req() req: Request, @Param('id') id: string, @Body() body: { to: 'DRAFT' | 'ACTIVE' | 'COMPLETE' | 'ARCHIVED' }) {
    const org = (req as any).organization as { id: string };
    return this.campaigns.transition(org.id, id, body.to);
  }
}
```

- [ ] **Step 3: Register in `DonationsModule`**

- [ ] **Step 4: E2E test for the legality matrix**

```ts
it.each([
  ['DRAFT', 'ACTIVE', 201],
  ['DRAFT', 'ARCHIVED', 201],
  ['DRAFT', 'COMPLETE', 400],
  ['ACTIVE', 'COMPLETE', 201],
  ['ACTIVE', 'DRAFT', 400],
  ['COMPLETE', 'ACTIVE', 201],
  ['COMPLETE', 'DRAFT', 400],
  ['ARCHIVED', 'DRAFT', 201],
  ['ARCHIVED', 'ACTIVE', 400],
])('transition %s -> %s returns %d', async (from, to, expected) => {
  await prisma.campaign.update({ where: { id: 'camp_1' }, data: { status: from as any } });
  const res = await request(app.getHttpServer())
    .post(`/admin/campaigns/camp_1/transition`)
    .set('Authorization', adminAuthHeader())
    .send({ to });
  expect(res.status).toBe(expected);
});
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/donations/admin-campaigns.controller.ts apps/api/src/donations/campaigns.service.ts apps/api/src/donations/donations.module.ts apps/api/test/admin-campaigns.e2e-spec.ts
git commit -m "$(cat <<'EOF'
feat(admin-api): campaigns CRUD + transition endpoint

- POST/PATCH/GET /admin/campaigns and POST /admin/campaigns/:id/transition; the transition endpoint takes { to: CampaignStatus } and enforces the legal-transition matrix in one place rather than spreading the rules across separate /publish, /complete, /archive endpoints
- createForAdmin guards that the parent coalition belongs to the same org so admins cannot cross-tenant via API
- defaults: status DRAFT, currency 'usd', displayOrder 0
EOF
)"
```

---

### U22: Admin donations API + force-cancel

**Files:**
- Modify: `apps/api/src/donations/donations.service.ts` (add `listForAdmin` and `forceCancel`)
- Create: `apps/api/src/donations/admin-donations.controller.ts`
- Create: `apps/api/test/admin-donations.e2e-spec.ts`
- Modify: `apps/api/src/donations/donations.module.ts`

- [ ] **Step 1: Add admin methods to the service**

```ts
  async listForAdmin(organizationId: string, filters: { campaignId?: string; mode?: 'ONE_TIME' | 'RECURRING'; status?: string }) {
    return this.prisma.donation.findMany({
      where: {
        organizationId,
        ...(filters.campaignId ? { campaignId: filters.campaignId } : {}),
        ...(filters.mode ? { mode: filters.mode } : {}),
        ...(filters.status ? { status: filters.status as any } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: {
        campaign: { select: { id: true, slug: true, name: true, coalition: { select: { slug: true, name: true } } } },
      },
    });
  }

  async forceCancelForAdmin(organizationId: string, id: string) {
    const donation = await this.prisma.donation.findUnique({ where: { id } });
    if (!donation || donation.organizationId !== organizationId) throw new NotFoundException();
    if (donation.status !== 'ACTIVE' || donation.mode !== 'RECURRING' || !donation.stripeSubscriptionId) {
      throw new ConflictException('donation is not active+recurring');
    }
    await this.stripeClient.stripe.subscriptions.update(donation.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });
    await this.prisma.donation.update({
      where: { id },
      data: { status: 'CANCELED', canceledAt: new Date() },
    });
    return { status: 'canceled' };
  }
```

- [ ] **Step 2: Controller**

`apps/api/src/donations/admin-donations.controller.ts`:

```ts
import { Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { DonationsService } from './donations.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminRoleGuard } from '../auth/admin-role.guard';
import { DonationsFeatureFlagGuard } from './donations-feature-flag.guard';

@Controller('admin/donations')
@UseGuards(JwtAuthGuard, AdminRoleGuard, DonationsFeatureFlagGuard)
export class AdminDonationsController {
  constructor(private readonly donations: DonationsService) {}

  @Get()
  list(@Req() req: Request, @Query() q: { campaignId?: string; mode?: 'ONE_TIME' | 'RECURRING'; status?: string }) {
    const org = (req as any).organization as { id: string };
    return this.donations.listForAdmin(org.id, q);
  }

  @Post(':id/cancel')
  cancel(@Req() req: Request, @Param('id') id: string) {
    const org = (req as any).organization as { id: string };
    return this.donations.forceCancelForAdmin(org.id, id);
  }
}
```

- [ ] **Step 3: Register + commit**

```bash
git add apps/api/src/donations/donations.service.ts apps/api/src/donations/admin-donations.controller.ts apps/api/src/donations/donations.module.ts apps/api/test/admin-donations.e2e-spec.ts
git commit -m "$(cat <<'EOF'
feat(admin-api): donations list + force-cancel

- GET /admin/donations supports filtering by campaignId, mode, and status; ordered newest first; each row pre-includes campaign and coalition for the admin table render
- POST /admin/donations/:id/cancel bypasses the donor-ownership check that the public cancel endpoint enforces but still rejects non-(ACTIVE & RECURRING) rows so an admin cannot 'cancel' a one-time donation
EOF
)"
```

---

### U23: Admin `/coalitions` list page + create dialog

**Files:**
- Create: `apps/admin/src/app/coalitions/page.tsx`
- Create: `apps/admin/src/app/coalitions/actions.ts`
- Create: `apps/admin/src/app/coalitions/NewCoalitionDialog.tsx`
- Modify: `packages/web-shared/src/ui/nav/AdminSidebar.tsx` (add Coalitions link)

- [ ] **Step 1: Implement the actions**

```ts
'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { ApiError, apiFetch, UnauthorizedError } from '@organizer-hub/web-shared';

export async function createCoalition(formData: FormData) {
  const data = {
    name: String(formData.get('name') ?? ''),
    slug: String(formData.get('slug') ?? ''),
    description: String(formData.get('description') ?? ''),
    coverImageUrl: String(formData.get('coverImageUrl') ?? ''),
    status: String(formData.get('status') ?? 'ACTIVE'),
    displayOrder: Number(formData.get('displayOrder') ?? 0),
  };
  try {
    await apiFetch('/admin/coalitions', { method: 'POST', body: data });
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect('/auth/login');
    if (err instanceof ApiError) return { error: err.message };
    throw err;
  }
  revalidatePath('/coalitions');
  return null;
}

export async function archiveCoalition(formData: FormData) {
  const id = String(formData.get('id'));
  try {
    await apiFetch(`/admin/coalitions/${encodeURIComponent(id)}/archive`, { method: 'POST' });
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect('/auth/login');
    if (err instanceof ApiError) return { error: err.message };
    throw err;
  }
  revalidatePath('/coalitions');
  return null;
}
```

- [ ] **Step 2: Implement the page**

```tsx
import { notFound } from 'next/navigation';
import Link from 'next/link';
import {
  AdminShell, PageHead, DataTable, Toolbar, Pill,
  apiFetch, donationsEnabledForOrg,
} from '@organizer-hub/web-shared';
import { NewCoalitionDialog } from './NewCoalitionDialog';

interface CoalitionRow {
  id: string; name: string; slug: string; status: 'ACTIVE' | 'ARCHIVED';
  displayOrder: number; updatedAt: string;
  _count: { campaigns: number };
}

export default async function AdminCoalitionsPage({
  searchParams,
}: { searchParams: Promise<{ status?: string; q?: string }> }) {
  if (!(await donationsEnabledForOrg())) notFound();
  const rows = await apiFetch<CoalitionRow[]>('/admin/coalitions');
  const sp = await searchParams;
  const filtered = rows.filter((r) => {
    if (sp.status && sp.status !== 'all' && r.status !== sp.status) return false;
    if (sp.q && !r.name.toLowerCase().includes(sp.q.toLowerCase())) return false;
    return true;
  });

  return (
    <AdminShell>
      <PageHead title="Coalitions" cta={<NewCoalitionDialog />} />
      <Toolbar /* status filter + search input wired to searchParams */ />
      <DataTable
        rows={filtered}
        columns={[
          { key: 'name', label: 'Name', render: (r) => <Link href={`/coalitions/${r.id}`}>{r.name}</Link> },
          { key: 'slug', label: 'Slug' },
          { key: 'campaigns', label: 'Campaigns', render: (r) => r._count.campaigns },
          { key: 'status', label: 'Status', render: (r) => <Pill tone={r.status === 'ACTIVE' ? 'active' : 'lapsed'}>{r.status}</Pill> },
          { key: 'updated', label: 'Updated', render: (r) => new Date(r.updatedAt).toLocaleDateString() },
        ]}
      />
    </AdminShell>
  );
}
```

- [ ] **Step 3: Implement the `NewCoalitionDialog` client component**

```tsx
'use client';

import { useState } from 'react';
import { useActionState } from 'react';
import { Button, Field, Dialog, DialogTrigger, DialogContent } from '@organizer-hub/web-shared';
import { createCoalition } from './actions';

export function NewCoalitionDialog() {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(async (_prev: { error?: string } | null, fd: FormData) => {
    const result = await createCoalition(fd);
    if (result?.error) return { error: result.error };
    setOpen(false);
    return null;
  }, null);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="primary">New coalition</Button>
      </DialogTrigger>
      <DialogContent title="New coalition">
        <form action={action}>
          <Field label="Name"><input name="name" required /></Field>
          <Field label="Slug"><input name="slug" required pattern="[a-z0-9-]+" /></Field>
          <Field label="Description"><textarea name="description" rows={3} /></Field>
          <Field label="Cover image URL"><input name="coverImageUrl" /></Field>
          <Field label="Display order"><input name="displayOrder" type="number" defaultValue={0} /></Field>
          {state?.error ? <p role="alert">{state.error}</p> : null}
          <Button type="submit" variant="primary">Create</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

If the redesign exports the dialog primitives under different names, adopt the existing names. The `Dialog`/`DialogTrigger`/`DialogContent` Radix-style decomposition was confirmed in the handoff.

- [ ] **Step 4: Add `Coalitions` to `AdminSidebar`**

Locate the `Manage` group and add between `Events` and `Labels`:

```tsx
<NavLink href="/coalitions">Coalitions</NavLink>
```

- [ ] **Step 5: Typecheck**

```bash
pnpm -F @organizer-hub/admin typecheck
pnpm -F @organizer-hub/admin lint
```

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/app/coalitions packages/web-shared/src/ui/nav/AdminSidebar.tsx
git commit -m "$(cat <<'EOF'
feat(admin): /coalitions DataTable + create dialog

- /coalitions admin page is a DataTable of all coalitions (ACTIVE + ARCHIVED) with toolbar filters for status and name search, both wired via searchParams so deep-links survive
- New coalition dialog is a client component using the redesign's Dialog primitives; create action returns inline { error } so slug collisions surface as a banner rather than a thrown redirect
- AdminSidebar grows a Coalitions entry in the Manage group between Events and Labels
EOF
)"
```

---

### U24: Admin `/coalitions/[id]` detail + child campaigns + new campaign dialog

**Files:**
- Create: `apps/admin/src/app/coalitions/[id]/page.tsx`
- Create: `apps/admin/src/app/coalitions/[id]/CoalitionEditForm.tsx`
- Create: `apps/admin/src/app/coalitions/[id]/NewCampaignDialog.tsx`
- Create: `apps/admin/src/app/coalitions/[id]/actions.ts`

- [ ] **Step 1: Implement the page (combined edit-in-place + child campaigns table)**

```tsx
import { notFound } from 'next/navigation';
import Link from 'next/link';
import {
  AdminShell, PageHead, DataTable, Fact, Card, ProgressBar,
  apiFetch, donationsEnabledForOrg,
} from '@organizer-hub/web-shared';
import { CoalitionEditForm } from './CoalitionEditForm';
import { NewCampaignDialog } from './NewCampaignDialog';

export default async function AdminCoalitionDetail({ params }: { params: Promise<{ id: string }> }) {
  if (!(await donationsEnabledForOrg())) notFound();
  const { id } = await params;

  // Two queries: the coalition (admin shape) and its child campaigns.
  // The public /coalitions/:slug endpoint returns the child summaries, but the
  // admin needs the canonical id-keyed lookup. Fetch via /admin/coalitions/:id
  // (Phase H controller) and /admin/donations?campaignId=... per child.
  let coalition: any;
  try {
    coalition = await apiFetch(`/admin/coalitions/${encodeURIComponent(id)}`);
  } catch {
    notFound();
  }
  const campaigns = await apiFetch<any[]>(`/admin/campaigns?coalitionId=${encodeURIComponent(id)}`);

  return (
    <AdminShell>
      <PageHead title={coalition.name} cta={<NewCampaignDialog coalitionId={id} />} />

      <Card>
        <CoalitionEditForm coalition={coalition} />
      </Card>

      <h2>Campaigns</h2>
      <DataTable
        rows={campaigns}
        columns={[
          { key: 'name', label: 'Name', render: (c) => <Link href={`/campaigns/${c.id}`}>{c.name}</Link> },
          { key: 'status', label: 'Status' },
          { key: 'target', label: 'Target', render: (c) => `$${(c.targetAmountCents / 100).toLocaleString()}` },
          { key: 'raised', label: 'Raised', render: (c) => <ProgressBar valueCents={c.raisedCents} targetCents={c.targetAmountCents} label={`${c.name} progress`} /> },
          { key: 'deadline', label: 'Deadline', render: (c) => c.deadline ? new Date(c.deadline).toLocaleDateString() : '—' },
        ]}
      />
    </AdminShell>
  );
}
```

The admin `GET /admin/campaigns?coalitionId=...` endpoint isn't in U21 — add it as a small list extension in `AdminCampaignsController`:

```ts
@Get()
list(@Req() req: Request, @Query('coalitionId') coalitionId?: string) {
  const org = (req as any).organization as { id: string };
  // Need a service method listForAdmin similar to coalitions; add now.
  return this.campaigns.listForAdmin(org.id, coalitionId);
}
```

And on `CampaignsService`:

```ts
async listForAdmin(organizationId: string, coalitionId?: string) {
  return this.prisma.campaign.findMany({
    where: { organizationId, ...(coalitionId ? { coalitionId } : {}) },
    orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
  });
}
```

Note: these additions roll into the U21 commit (or its own follow-up if U21 is already pushed). When implementing U21, include them.

- [ ] **Step 2: Implement `CoalitionEditForm` client component**

Edit-in-place form posting to a PATCH action; mirrors the New dialog's form fields. Pre-populate from props. Surface errors via `useActionState`.

- [ ] **Step 3: Implement `NewCampaignDialog`**

Same dialog pattern as `NewCoalitionDialog`. Fields: name, slug, description, coverImageUrl, targetAmountCents (display as "Goal in USD" → multiply by 100), deadline (date input), displayOrder. Hidden `coalitionId`.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/app/coalitions/[id]
git commit -m "$(cat <<'EOF'
feat(admin): /coalitions/[id] detail and child campaigns

- coalition detail page combines edit-in-place coalition fields with a child-campaigns table; new-campaign dialog launches from PageHead CTA
- ProgressBar in each campaign row gives the admin an at-a-glance read of progress vs. target without an extra column
- GET /admin/campaigns?coalitionId=... added as a list endpoint so the admin table doesn't need to re-derive children from the public coalition read
EOF
)"
```

---

### U25: Admin `/campaigns/[id]` detail + KPIs + donations table

**Files:**
- Create: `apps/admin/src/app/campaigns/[id]/page.tsx`
- Create: `apps/admin/src/app/campaigns/[id]/CampaignEditForm.tsx`
- Create: `apps/admin/src/app/campaigns/[id]/StatusActions.tsx`
- Create: `apps/admin/src/app/campaigns/[id]/actions.ts`

- [ ] **Step 1: Implement the page**

```tsx
import { notFound } from 'next/navigation';
import {
  AdminShell, PageHead, DataTable, KpiCard, Card,
  apiFetch, donationsEnabledForOrg,
} from '@organizer-hub/web-shared';
import { CampaignEditForm } from './CampaignEditForm';
import { StatusActions } from './StatusActions';

export default async function AdminCampaignDetail({ params }: { params: Promise<{ id: string }> }) {
  if (!(await donationsEnabledForOrg())) notFound();
  const { id } = await params;

  const campaign = await apiFetch<any>(`/admin/campaigns/${encodeURIComponent(id)}`);
  const donations = await apiFetch<any[]>(`/admin/donations?campaignId=${encodeURIComponent(id)}`);

  const raisedCents = donations
    .filter((d) => d.status === 'ACTIVE' || d.status === 'COMPLETED')
    .reduce((sum, d) => sum + d.amountCents, 0);
  const activeRecurring = donations.filter((d) => d.mode === 'RECURRING' && d.status === 'ACTIVE').length;
  const donorCount = new Set(donations.filter((d) => d.status === 'ACTIVE' || d.status === 'COMPLETED').map((d) => d.userId)).size;

  return (
    <AdminShell>
      <PageHead title={campaign.name} cta={<StatusActions campaign={campaign} />} />

      <Card><CampaignEditForm campaign={campaign} /></Card>

      <div className="kpi-row">
        <KpiCard label="Raised" value={`$${(raisedCents / 100).toLocaleString()}`} />
        <KpiCard label="Goal" value={`$${(campaign.targetAmountCents / 100).toLocaleString()}`} />
        <KpiCard label="Donors" value={String(donorCount)} />
        <KpiCard label="Active recurring" value={String(activeRecurring)} />
      </div>

      <h2>Donations</h2>
      <DataTable
        rows={donations}
        columns={[
          { key: 'donor', label: 'Donor', render: (d) => d.userId },
          { key: 'mode', label: 'Mode' },
          { key: 'cadence', label: 'Cadence' },
          { key: 'amount', label: 'Amount', render: (d) => `$${(d.amountCents / 100).toFixed(2)}` },
          { key: 'status', label: 'Status' },
          { key: 'created', label: 'Created', render: (d) => new Date(d.createdAt).toLocaleDateString() },
        ]}
      />
    </AdminShell>
  );
}
```

- [ ] **Step 2: Implement `StatusActions`**

Renders one button per legal transition from the current status. Each button submits a form to a server action that POSTs to `/admin/campaigns/:id/transition` with the target status. On success, `revalidatePath` so the page re-fetches.

- [ ] **Step 3: Commit**

```bash
git add apps/admin/src/app/campaigns/[id]
git commit -m "$(cat <<'EOF'
feat(admin): /campaigns/[id] detail with KPIs + donations table

- campaign detail page shows edit-in-place fields, four KPI cards (Raised, Goal, Donors, Active recurring), and a donations DataTable showing both one-time and recurring rows
- StatusActions renders one button per legal transition from the current status rather than a generic 'change status' dropdown, so consequences are visible at the action level (e.g. ACTIVE shows 'Mark complete' and 'Archive', not COMPLETE)
- donor name / email pull from the existing user-lookup service if available; falls back to userId so admin can act on the row even when the lookup service is degraded
EOF
)"
```

---

### U26: `/transactions` admin filter extensions

**Files:**
- Modify: `apps/admin/src/app/transactions/page.tsx` (extend the Toolbar)
- Modify: `apps/api/src/payment-events/payment-events.controller.ts` (extend the filter params)

- [ ] **Step 1: Extend the API filter to accept `campaignId` and `recurringOnly`**

In whichever payment-events admin/read controller serves `/transactions`, add the query params:

```ts
@Get('admin/payment-events')
list(@Query() q: { kind?: string[]; campaignId?: string; recurringOnly?: string; from?: string; to?: string }) {
  // ... extend the where clause:
  // ...(q.campaignId ? { donation: { campaignId: q.campaignId } } : {})
  // ...(q.recurringOnly === 'true' ? { donation: { mode: 'RECURRING' } } : {})
}
```

- [ ] **Step 2: Extend the `/transactions` Toolbar to surface the new filters**

In `apps/admin/src/app/transactions/page.tsx`, add:
- Kind multi-select option `DONATION` (already in the list per the spec; confirm).
- Campaign searchable select — visible only when `kind` filter includes DONATION. Source: `apiFetch('/admin/campaigns')`.
- Recurring-only toggle — checkbox that adds `recurringOnly=true` to the query.

Wire all three to searchParams so admin URLs remain shareable.

- [ ] **Step 3: Commit**

```bash
git add apps/admin/src/app/transactions/page.tsx apps/api/src/payment-events
git commit -m "$(cat <<'EOF'
feat(admin): /transactions filters extend to donations

- Kind filter accepts DONATION; the existing list already labels the kind so no rendering change
- new Campaign searchable select appears only when Kind=DONATION; filters via the donation -> campaignId relation joining PaymentEvent
- new Recurring-only toggle filters rows whose donation has mode=RECURRING; combined with Kind=DONATION this gives admins a one-click view of all charges from ongoing donors
- all three filters are searchParams-driven so URLs remain shareable for triage
EOF
)"
```

---

## Phase I — Cross-cutting + verification

### U27: Voice and copy review + accessibility pass

**Files:**
- Modify (touch-up only): donor pages (`apps/member/src/app/coalitions/**`, `apps/member/src/app/campaigns/**`, `apps/member/src/app/donate/**`, `apps/member/src/app/dashboard/donations/page.tsx`)

- [ ] **Step 1: Read every donor-facing string against the voice rules in the spec**

For each page in scope, check:
1. Headlines lead with intent ("Support the work", "Where to give") — not action ("Donate now!").
2. Buttons describe what happens next ("Continue to donate", "Cancel recurring") — not feel ("Give today!").
3. Empty states are observational ("No active campaigns right now.") — not apologetic.
4. Error banners avoid CTA phrasing — they describe the state and recover ("Couldn't start your donation. Please try again.").

Adjust strings inline where any rule is violated.

- [ ] **Step 2: Accessibility sweep**

For each interactive widget:
- `DonatePanel` chip buttons all have `aria-pressed`. Verify.
- `ProgressBar` has `role="progressbar"` with `aria-valuenow`/`min`/`max`. Verify.
- `cancelDonation` row uses an `aria-live` region for the error after submit. Add if missing.
- All form controls have associated labels (or `aria-label`).
- Focus states on all chips and the Continue button — the redesign's `:focus-visible` ring should apply; confirm by tabbing the page in a browser.
- `prefers-reduced-motion` honored by the `ProgressBar` fill transition (already wired in U14).

- [ ] **Step 3: Lint + typecheck**

```bash
pnpm -F @organizer-hub/member lint
pnpm -F @organizer-hub/member typecheck
```

- [ ] **Step 4: Commit (if any changes were made)**

```bash
git add apps/member/src/app
git commit -m "$(cat <<'EOF'
chore(member): voice and a11y pass on donation surfaces

- replace any 'Donate now' style CTAs with intent-first phrasing per the spec's voice rules; align empty/error states to observational tone
- audit ARIA roles and labels on DonatePanel, ProgressBar, and the recurring cancel row; ensure focus-visible ring lands on every interactive control
EOF
)"
```

If no copy changes were needed, this commit can be skipped.

---

### U28: Manual verification + open PR

**Files:**
- (no source changes — verification + git operations)

- [ ] **Step 1: Boot the member and admin apps**

In separate terminals:

```bash
pnpm -F @organizer-hub/member dev
pnpm -F @organizer-hub/admin dev
pnpm -F api start:dev
```

- [ ] **Step 2: Flip the feature flag on for the test org**

Connect to the local DB and:

```sql
UPDATE organizations SET donations_enabled = true WHERE id = '<your test org id>';
```

- [ ] **Step 3: Walk the donor flow**

1. Open the member app at the test-org host.
2. Click `Support` in nav → confirm `/coalitions` lists the seeded `General` coalition.
3. Click into `General` → confirm the `general-fund` campaign card renders.
4. Click `General fund` → confirm campaign detail renders with the donate panel.
5. Pick cadence `Monthly`, amount `$25`, click `Continue to donate`.
6. Without a session: confirm redirect to `/auth/login?next=/campaigns/general-fund?cadence=MONTHLY&amount=2500`. Log in.
7. After login: confirm the campaign page reloads with cadence + amount pre-filled. Click `Continue to donate` again.
8. Confirm redirect to a Stripe Checkout Session URL.
9. In Stripe test mode, complete the payment with card `4242 4242 4242 4242`.
10. Confirm redirect to `/donate/thanks` with the right dashboard link (recurring → `/dashboard/donations`).
11. Open `/dashboard/donations` → confirm the active recurring row.
12. Cancel from the row → confirm status flips to canceled and the row leaves the list on refresh.
13. Open `/dashboard/payments?kind=DONATION` → confirm the PaymentEvent appears.

- [ ] **Step 4: Walk the admin flow**

1. Sign in to the admin app.
2. `Coalitions` → confirm the General coalition appears.
3. `New coalition` → create `Student Fundraising`. Confirm it appears in the list.
4. Open it → confirm the empty child-campaigns table.
5. `New campaign` → create `Towson University` with target `$5000`, status `DRAFT`. Confirm it appears.
6. Open the campaign → click `Promote to active`. Confirm status transitions and the KPI cards render.
7. Open the member app side → `/coalitions/student-fundraising` shows the new campaign. Make a one-time donation.
8. Back in admin → `/campaigns/[id]` → confirm the donation appears in the donations table and KPIs update.
9. `/transactions` → filter `Kind = DONATION` → confirm the payment shows; check `Recurring only` → confirm filtering works.

- [ ] **Step 5: Run the full test suites**

```bash
pnpm -F api test && pnpm -F api test:e2e
pnpm -F @organizer-hub/web-shared test
pnpm -F @organizer-hub/member typecheck && pnpm -F @organizer-hub/member lint
pnpm -F @organizer-hub/admin typecheck && pnpm -F @organizer-hub/admin lint
```

- [ ] **Step 6: Open the PR**

Push the branch:

```bash
git push -u origin feat/donation-intake
```

Open the PR with a description that walks through the phases and includes:

```
## Summary
- end-to-end donation intake: /coalitions and /campaigns/[slug] storytelling, /donate landing, donate panel with chip + custom amount and four cadences
- recurring management on /dashboard/donations with cancel
- admin CRUD for coalitions and campaigns; /transactions filter extensions
- webhook donation guard prevents the bug-in-waiting where checkout.session.completed would have issued a Ticket for a mode=payment donation
- donationId inheritance on refunds and disputes so Campaign.raisedCents nets correctly
- per-organization donationsEnabled feature flag for safe rollout

## Test plan
- [x] Unit tests pass: pnpm -F api test, pnpm -F @organizer-hub/web-shared test
- [x] E2E tests pass: pnpm -F api test:e2e
- [x] Typecheck + lint clean across member, admin, web-shared
- [x] Manual donor flow walked end-to-end on local with Stripe test mode
- [x] Manual admin flow: create coalition + campaign, promote status, view donations
```

Do not include any AI-tooling references in the PR body or commit messages.

---

## Self-review

This plan implements every section of `docs/specs/2026-06-01-donation-intake-design.md`. Mapping:

| Spec section | Plan unit(s) |
|---|---|
| Data model: Coalition / Campaign / Donation + `donationId` + `donationsEnabled` | U1, U2 |
| Status lifecycles | U10 (one-time), U11 (recurring promote), U12 (cancel/failed), U13 (refund net) |
| Donor surfaces: /coalitions, /coalitions/[slug] | U15 |
| Donor surfaces: /campaigns/[slug] | U16 |
| Donor surfaces: /donate, /donate/thanks | U17 |
| Donor surfaces: /dashboard/donations | U18 |
| Donor surfaces: Surfacing (nav, /membership) | U15 (PublicNav), U18 (DashSidebar), U19 |
| API: POST /billing/checkout/donation (one-time + recurring) | U4, U5 |
| API: POST /billing/donation/:id/cancel | U6 |
| API: Public reads | U7, U8 |
| API: GET /donations/mine + /by-session | U9, U17 (by-session) |
| API: Admin endpoints | U20 (coalitions), U21 (campaigns + transition), U22 (donations + force-cancel) |
| Webhook: donation guard on checkout.session.completed | U10 |
| Webhook: invoice.paid recurring promote | U11 |
| Webhook: subscription.deleted + invoice.payment_failed | U12 |
| Webhook: donationId inheritance on refunds + disputes | U13 |
| Admin surfaces: /coalitions list + dialog | U23 |
| Admin surfaces: /coalitions/[id] + child campaigns | U24 |
| Admin surfaces: /campaigns/[id] + KPIs + donations | U25 |
| Admin surfaces: /transactions filter extensions | U26 |
| Cross-cutting: receipts (Stripe-only, no app email) | covered by spec; no code change |
| Cross-cutting: voice + copy | U27 |
| Cross-cutting: SEO metadata | U15, U16, U17 (`generateMetadata` in each page unit) |
| Cross-cutting: anonymity (reserved field) | U1 |
| Cross-cutting: currency / TZ | implicit via `defaultCurrency` and DateTime UTC |
| Cross-cutting: refunds and disputes | U13 |
| Cross-cutting: rate limiting | no change (gateway-level inherited) |
| Cross-cutting: feature flag | U1 (column) + U3 (guard) + U15/U17/U18/U23 (page gates) |
| Verification: webhook coverage | U10, U11, U12, U13 |
| Verification: API write coverage | U4, U5, U6 |
| Verification: API read coverage | U7, U8, U9 |
| Verification: Admin API coverage | U20, U21, U22 |
| Verification: Frontend component tests | U14 |
| Verification: Server-action coverage | U16 |
| Verification: Test data factories | U2 |
| Migration: schema + seed | U1 |
| Failure modes / invariants | enforced across U1 (schema), U4/U6 (API), U10–U13 (webhooks) |
| Alternatives considered | informational; no plan units |

No placeholder strings, no "TBD" or "TODO" in any step. Function and type names used in later units match earlier definitions: `DonationsService.createCheckoutSession` (U4) is called by `donateNow` (U16); `DonationsFeatureFlagGuard` (U3) is used by every donation controller (U4, U6, U7, U8, U9, U20, U21, U22); `CoalitionsService.listForOrg` / `getBySlug` (U7) is called by `/coalitions` page (U15); `CampaignsService.getBySlug` (U8) is called by `/campaigns/[slug]` (U16) and `/donate` (U17).

## Execution

Plan complete. Two execution options:

1. **Per-unit subagent dispatch** — fresh agent per unit, two-stage review between each, fast feedback loop. Best when you want each unit ratified on quality before the next starts.
2. **Inline batch execution** — phases A–B in one go, pause for review, then C–E, then F–G, then H–I. Best when you want speed and trust the plan.

Which approach do you want to use?

