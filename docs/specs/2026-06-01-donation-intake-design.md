# Donation intake — design

**Status:** approved, ready for implementation plan
**Date:** 2026-06-01

## Problem

The payment-events ledger reserves `PaymentEventKind.DONATION` and the
Stripe webhook already maps `metadata.source = "donation"` onto it, but no
donor-facing flow exists to create those donation Checkout Sessions. A
recent inventory pass also flagged that the existing
`checkout.session.completed` handler, lacking a donation guard, would
attempt to issue a Ticket for any `mode='payment'` session that arrives
without a `ticketRequestId` — including a donation. Donation intake
therefore needs both a new donor surface and a small webhook patch
before the ledger entry can be exercised.

The intake also needs a *categorisation* layer that real fundraising
operations require: donors give to a specific **campaign**
("Towson University"), and campaigns roll up to a **coalition**
("Student Fundraising"). Coalitions are directory-only; only campaigns
receive money. Recurring giving (monthly, quarterly, yearly) sits next
to one-time giving as a cadence choice on the same panel.

## Scope

In scope:
- Two new entities (`Coalition`, `Campaign`) and one operational entity
  (`Donation`) in `packages/db/api/schema.prisma`, plus an additive
  `donationId` column on `PaymentEvent`.
- Member-facing pages: `/coalitions`, `/coalitions/[slug]`,
  `/campaigns/[slug]`, `/donate`, `/donate/thanks`, `/dashboard/donations`.
- Admin-facing pages: `/coalitions`, `/coalitions/[id]`,
  `/campaigns/[id]`; extensions to the existing `/transactions` filters.
- API write endpoints for donation checkout, donor-initiated cancel,
  admin force-cancel, and coalition/campaign CRUD.
- API read endpoints for the public donor surfaces and the member
  dashboard.
- Stripe webhook patch: a donation guard on `checkout.session.completed`,
  donation arms on `invoice.paid`, `invoice.payment_failed`, and
  `customer.subscription.deleted`.
- Per-organization `donationsEnabled` flag gating every donation surface
  for safe rollout.

Out of scope:
- App-side branded confirmation email. Stripe's own receipt covers the
  immediate transactional acknowledgement.
- Tax-receipt-compliant emails (501(c)(3) language, EIN, year-end summary).
- Recurring-donation modifications other than cancel — no change-amount,
  no change-cadence, no pause/resume. Donor cancels and creates a fresh
  donation if either needs to change.
- Donor display name on a public donor list. The schema reserves
  `Donation.displayNameOptIn` but no public list ships here.
- Image upload pipeline for `coverImageUrl`. Admin pastes URLs.
- Bulk admin operations, CSV export of donations, donation-related
  entries in the admin activity feed.
- Multi-currency donations and Apple Pay / Google Pay configuration
  beyond Stripe Checkout defaults.
- Coalition-level donations (money pooled at the coalition without
  picking a child campaign). Coalitions remain directory-only.
- Sub-coalitions / nested coalition trees.

## Decisions

The design rests on a small number of upstream choices made during
brainstorming. Each is load-bearing — changing one ripples through the
whole spec.

- **Login required for every donation.** Keeps `PaymentEvent.userId`
  NOT NULL, aligns with the "every transactional actor is a member" rule,
  and reuses session and Stripe-customer plumbing. Anonymous donors sign
  up via the existing Digital Free tier first.
- **Preset chips plus custom amount.** Industry-standard donation UX.
  Four chips (`$10` / `$25` / `$50` / `$100`) plus a custom-amount input
  for the long tail. Implemented in Stripe via inline `price_data`, not
  static Products.
- **Four cadences.** `ONCE`, `MONTHLY`, `QUARTERLY`, `YEARLY`. Quarterly
  is expressed as `recurring.interval = "month", interval_count = 3`.
- **Coalition is required for every campaign.** `Campaign.coalitionId`
  NOT NULL. A seeded "General" coalition with a single "General fund"
  campaign supplies the soft general-fund destination — no special case
  in code.
- **Coalitions are directory only.** They do not accept donations.
  `PaymentEvent.campaignId` (via `Donation.campaignId`) is the single
  attribution path; coalition totals are derived by summing across child
  campaigns.
- **Donation is its own entity.** A `Donation` row models the donor's
  intent / commitment; `PaymentEvent` continues as the append-only
  money-movement ledger. Recurring management updates the Donation;
  every Stripe charge writes a fresh PaymentEvent.
- **Public viewing, login gate at checkout.** `/coalitions`,
  `/coalitions/[slug]`, `/campaigns/[slug]` and `/donate` are all in
  `PublicShell`. The login redirect happens when the form is submitted,
  carrying the destination context in `?next=`.
- **Cancel-only for recurring management.** No change-amount or
  change-cadence in this cycle. Cancel uses Stripe's cancel-at-period-end
  semantics.

## Data model

Three new entities and one additive field on `PaymentEvent`. Everything
scoped by `organizationId`, matching existing tenancy.

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

Additive change to `PaymentEvent`:

```prisma
donationId  String?  @map("donation_id")
donation    Donation? @relation(fields: [donationId], references: [id])
@@index([donationId])
```

The column is nullable to preserve existing rows. The app-layer invariant
is: `kind = DONATION ⇒ donationId IS NOT NULL`. Enforced at write sites,
not at the schema level.

### Status lifecycles

- `Donation.PENDING` on Checkout Session create.
- One-time: `PENDING → COMPLETED` on `checkout.session.completed`
  (succeeded), or `PENDING → FAILED` on a terminal failure.
- Recurring: `PENDING → ACTIVE` on first `invoice.paid` (subscription
  confirmed). Subsequent `invoice.paid` events leave Donation `ACTIVE`
  and write fresh PaymentEvent rows. Donor or admin cancel sets
  `ACTIVE → CANCELED`. A Stripe-side `customer.subscription.deleted`
  also transitions any non-canceled donation to `CANCELED`.

### Cadence → Stripe recurring

| Cadence       | `recurring.interval` | `interval_count` |
|---------------|----------------------|------------------|
| `MONTHLY`     | `month`              | `1`              |
| `QUARTERLY`   | `month`              | `3`              |
| `YEARLY`      | `year`               | `1`              |
| `ONCE`        | n/a (mode='payment') |                  |

### Derived stats

Computed in the service layer; not stored.

- `Campaign.raisedCents` =
  `SUM(PaymentEvent.amountCents)` over **all kinds** (`DONATION`,
  `REFUND`, `DISPUTE`) for rows where
  `donationId IN (SELECT id FROM Donation WHERE campaignId = :id)` and
  `status = 'SUCCEEDED'`. Refund and dispute rows carry negative
  `amountCents` (per the payment-events ledger spec) and inherit
  `donationId` from the original donation PaymentEvent (see refund
  inheritance under the webhook section), so the sum naturally nets to
  the donor-net amount the campaign still holds.
- `Campaign.donorCount` =
  `COUNT(DISTINCT Donation.userId)` for
  `campaignId = :id AND status IN ('ACTIVE','COMPLETED')`.
- `Coalition.totalRaisedCents` = sum of `raisedCents` across child
  campaigns.

## Donor surfaces

Five new routes in `apps/member`. Each composed from primitives in
`packages/web-shared/src/ui/` shipped during the redesign.

### `/coalitions` — public directory

`PublicShell` → `container` → `Eyebrow "Initiatives"`, `Display "Where to
give"`, one-line `Lede`, then `grid-3-narrow` of `CoalitionCard`s.
Each card: cover image, name, child-campaign count, total raised across
children. Click → `/coalitions/[slug]`.

### `/coalitions/[slug]` — coalition detail

Header with coalition cover, name, description. Below: `grid-3-narrow`
of child `ACTIVE` campaigns as `CampaignCard`s (cover, name,
raised-of-target progress, donor count, days remaining when deadline is
set). Coalition with zero active campaigns shows a `Card` empty state:
"No active campaigns right now. Check back soon."

### `/campaigns/[slug]` — campaign detail

Two-column on wide viewports, stacked on narrow.

Left: hero poster, `Eyebrow` linking to the parent coalition, `Display`
with campaign name, prose `description`, optional "Most recent gifts"
snippet (counts and relative timestamps only — no donor names in this
cycle).

Right: the **donate panel**, sticky on wide viewports.

```
Card (panel)
  ProgressBar (raised / target)
  Fact rows: "Raised $1,200" · "Goal $5,000" · "Ends Sep 30" · "32 donors"
  Segmented cadence: [ One-time | Monthly | Quarterly | Yearly ]
  Amount chips: [ $10 ] [ $25 ] [ $50 ] [ $100 ]
  Field "Custom amount" (number input, prefixed with currency symbol)
  Hidden inputs: campaignId, cadence, amountCents
  Button (block, primary) "Continue to donate"
```

Form `action={donateNow}`. The panel disables and shows a `Pill
tone="lapsed"` "Closed" when `campaign.status === 'COMPLETE'` or
`deadline < now`.

### `/donate` — general-fund landing

Short page. `PublicShell` with `Display "Support the work"` and the same
donate panel pre-bound to the seeded "General fund" campaign. Below: a
`Lede` link to `/coalitions` ("Looking to support a specific cause?
Browse our active initiatives.").

### `/donate/thanks` — success landing

`PublicShell`. Brief acknowledgement; cross-links to
`/dashboard/donations` (when the donor's just-confirmed donation is
recurring) or `/dashboard/payments?kind=DONATION` (one-time). Reads the
donation id from `?session_id=…` and revalidates the corresponding
campaign cache so the new total reflects on next view.

### `/dashboard/donations` — recurring management

`DashShell`. Two stacked sections.

1. **Active recurring donations.** `DataTable<Donation>` filtered to
   `status='ACTIVE' AND mode='RECURRING'` for the current user. Columns:
   Campaign (linked) / Coalition / Amount / Cadence / Next charge date /
   `…` menu. The only action is **Cancel**; change-amount and
   change-cadence are deliberately out.
2. **One-time donation history.** Cross-link to
   `/dashboard/payments?kind=DONATION`. No list duplication.

Empty state: `Card` with "You don't have any recurring donations yet.
Browse our [campaigns]."

### Server actions

Two server actions in `apps/member/src/app/campaigns/actions.ts`:

- **`donateNow(formData)`** accepts `campaignId`, `cadence`,
  `amountCents`. Validates `100 ≤ amountCents ≤ 1_000_000` (the upper
  bound is a fat-finger guard). POSTs to `/billing/checkout/donation`.
  On success: `redirect(checkoutUrl)`. On `UnauthorizedError`:
  `redirect(/auth/login?next=…)` carrying the full
  `/campaigns/[slug]?cadence=…&amount=…` query string. On `ApiError`:
  `redirect(/campaigns/[slug]?error=…)`.
- **`cancelDonation(donationId)`** POSTs to
  `/billing/donation/:id/cancel`, then `revalidatePath
  ('/dashboard/donations')`. On error, surface via `useActionState`.

### Auth gate flow

For unauthenticated visitors viewing `/campaigns/[slug]`:

1. Page renders publicly.
2. Donor submits the donate form.
3. Server action gets `UnauthorizedError`.
4. Action redirects to `/auth/login?next=` with the full
   `/campaigns/[slug]?cadence=monthly&amount=2500` query string.
5. After login the campaign page rehydrates the form from the query
   string. Donor re-submits.

The re-submit friction is intentional. Stash-and-resume (server-side
intent cookie that auto-resumes on login) is fancier but out of scope.

### Surfacing

- `PublicNav`: add `Support` link between `Membership` and the auth
  links. Points to `/coalitions` (the storytelling entry point), not
  `/donate`.
- `DashSidebar`: add `Donations` link between `Membership` and
  `Payments`.
- `/membership` page footer: a single cross-link, "Not ready to
  subscribe? You can also [support a campaign]." Anything more
  aggressive is its own styling pass.

## API and webhook

### Write endpoints

```
POST   /billing/checkout/donation                 (auth)
POST   /billing/donation/:donationId/cancel       (auth)
```

`POST /billing/checkout/donation` body:

```ts
{
  campaignId: string;
  cadence: "ONCE" | "MONTHLY" | "QUARTERLY" | "YEARLY";
  amountCents: number;       // 100 ≤ x ≤ 1_000_000
  currency?: "usd";          // defaults to organization.defaultCurrency
}
```

Service flow:

1. Load `Campaign`. Reject if `status !== 'ACTIVE'` or `deadline < now`.
2. Validate amount bounds and cadence/mode coherence: `ONCE` only with
   `ONE_TIME`; the other three cadences always with `RECURRING`.
3. `getOrCreateStripeCustomer(userSub, email)` — reuses the existing
   helper.
4. Insert `Donation` row with `status=PENDING`, `mode` derived from
   cadence, and the input fields.
5. Create the Stripe Checkout Session via inline `price_data`:

```ts
// One-time
{
  mode: 'payment',
  line_items: [{
    quantity: 1,
    price_data: {
      currency,
      unit_amount: amountCents,
      product_data: {
        name: `Donation: ${campaign.name}`,
        metadata: { campaignId, coalitionId: campaign.coalitionId },
      },
    },
  }],
  client_reference_id: userSub,
  metadata: { source: 'donation', userId, donationId, campaignId },
  success_url: `${webOrigin}/donate/thanks?session_id={CHECKOUT_SESSION_ID}`,
  cancel_url:  `${webOrigin}/campaigns/${campaign.slug}?checkout=canceled`,
}

// Recurring
{
  mode: 'subscription',
  line_items: [{
    quantity: 1,
    price_data: {
      currency,
      unit_amount: amountCents,
      recurring: { interval, interval_count },
      product_data: {
        name: `Recurring donation: ${campaign.name}`,
        metadata: { campaignId, coalitionId: campaign.coalitionId },
      },
    },
  }],
  client_reference_id: userSub,
  metadata: { source: 'donation', userId, donationId, campaignId },
  subscription_data: {
    metadata: { source: 'donation', userId, donationId, campaignId },
  },
  success_url: `${webOrigin}/donate/thanks?session_id={CHECKOUT_SESSION_ID}`,
  cancel_url:  `${webOrigin}/campaigns/${campaign.slug}?checkout=canceled`,
}
```

6. Persist `stripeCheckoutSessionId` on the Donation row.
7. Return `{ url, donationId }`.

`POST /billing/donation/:id/cancel` service:

1. Load Donation. Reject (404) when `userId !== userSub`. Reject (409)
   when `status !== 'ACTIVE'` or `mode !== 'RECURRING'`.
2. Cancel the Stripe subscription with **no-further-charges**
   semantics: the current period stays paid (the donation that already
   landed is the donation that already landed), no new invoice is
   generated for the next period. The exact Stripe API call mirrors
   `BillingService.cancelMembership` (the membership flow already
   resolved which of `subscriptions.update({cancel_at_period_end:
   true})` vs. `subscriptions.cancel(...)` matches this semantic in
   this codebase; donations adopt the same call).
3. Optimistically set `Donation.status = 'CANCELED'`, `canceledAt =
   now`. The `customer.subscription.deleted` webhook arm is
   idempotent — it no-ops when status is already `CANCELED`.
4. Return `{ status: 'canceled' }`.

### Read endpoints

```
GET    /coalitions                                (public)
GET    /coalitions/:slug                          (public)
GET    /campaigns/:slug                           (public)
GET    /donations/mine                            (auth)
```

Public reads scope by `organizationId` resolved from the request host
(existing convention). The `mine` endpoint accepts an optional
`?mode=RECURRING` filter; the dashboard uses it to populate the active
recurring list.

### Admin endpoints

```
POST   /admin/coalitions
PATCH  /admin/coalitions/:id
POST   /admin/coalitions/:id/archive
GET    /admin/coalitions
GET    /admin/coalitions/:id

POST   /admin/campaigns
PATCH  /admin/campaigns/:id
POST   /admin/campaigns/:id/transition       body: { to: CampaignStatus }
GET    /admin/campaigns/:id

POST   /admin/donations/:donationId/cancel
GET    /admin/donations                      query: campaignId, mode, status
```

`/admin/campaigns/:id/transition` is one endpoint with a `to` field
rather than four (`/publish`, `/complete`, `/archive`, `/draft`). The
service enforces the legal transition matrix in one place:

| From       | To                          |
|------------|-----------------------------|
| `DRAFT`    | `ACTIVE`, `ARCHIVED`        |
| `ACTIVE`   | `COMPLETE`, `ARCHIVED`      |
| `COMPLETE` | `ACTIVE`, `ARCHIVED`        |
| `ARCHIVED` | `DRAFT`                     |

`POST /admin/coalitions/:id/archive` rejects (409) if any child campaign
is currently `ACTIVE`.

### Stripe webhook patch

Single targeted patch to `apps/api/src/webhooks/stripe-webhook.service.ts`.

**`checkout.session.completed`** — add a top-priority branch on
`metadata.source` *before* the existing `mode` branches:

```ts
if (session.metadata?.source === 'donation') {
  return this.handleDonationCheckoutCompleted(session, event);
}
```

`handleDonationCheckoutCompleted`:

- Lookup `Donation` by `metadata.donationId` (primary), falling back to
  `stripeCheckoutSessionId`.
- No row found: warn-and-no-op.
- `mode === 'payment'`: set `Donation.status = 'COMPLETED'`, stamp
  `stripeCustomerId`, `stripePaymentIntentId`. No ticket logic runs.
- `mode === 'subscription'`: capture `stripeSubscriptionId` on the
  Donation. Status remains `PENDING`; the first `invoice.paid` promotes
  it.

**`invoice.paid`** — existing membership arm stays; add a donation arm
keyed on `subscription.metadata.source === 'donation'`:

- Lookup Donation by `stripeSubscriptionId`. If `status === 'PENDING'`,
  promote to `ACTIVE`.
- Insert a `PaymentEvent` with `kind=DONATION`, `status=SUCCEEDED`,
  `donationId`, and the charge details. Idempotent on
  `stripeInvoiceId`.

**`invoice.payment_failed`** — donation arm: insert a `PaymentEvent`
with `kind=DONATION`, `status=FAILED`. Donation status unchanged —
Stripe retries; only `customer.subscription.deleted` flips us to
`CANCELED`.

**`customer.subscription.deleted`** — donation arm: lookup Donation
by `stripeSubscriptionId`. If `status !== 'CANCELED'`, set to `CANCELED`
and stamp `canceledAt`. Reconciles drift from the optimistic-cancel path
or any Stripe-side termination.

**`charge.refunded` — donation-aware extension.** The existing arm
already inserts a `REFUND` PaymentEvent with `refundsPaymentIntentId`
set. Donation work extends it: before insert, look up the *original*
PaymentEvent by `stripePaymentIntentId`. If that row had
`kind = DONATION` and a non-null `donationId`, copy the same
`donationId` onto the new REFUND PaymentEvent. Same for the
`charge.dispute.*` arms when they write `DISPUTE` rows. This is the
mechanism that makes `Campaign.raisedCents` net refunds and disputes
correctly — without the inheritance, the campaign keeps reporting the
original amount after the money was returned.

### Idempotency posture

Every donation webhook arm short-circuits on existing rows. PaymentEvent
inserts are upserts keyed on `stripeInvoiceId` or
`stripePaymentIntentId`. Donation status transitions are guarded
(`if (current === 'PENDING') ...`). Same posture as membership and
ticket arms.

## Admin surfaces

### Nav placement

Add to `AdminSidebar` under the existing **Manage** group:

```
Manage
  Events
  Coalitions   ← new
  Labels
```

Donation activity surfaces under the existing **Finance** group via the
`/transactions` filters; no new top-level admin entry for "Donations".

### `/coalitions` — DataTable

`PageHead` with "New coalition" CTA → `DataTable<Coalition>` with
`Toolbar` filters.

Columns: Name (linked) · Slug · Active campaigns count · Total raised
(org currency) · Status (Pill) · Updated · `…` menu (Edit, Archive).

Toolbar: status filter (`ACTIVE` / `ARCHIVED` / `All`), text search on
name.

"New coalition" opens a `Dialog` with name, slug (auto from name,
editable), description, cover image URL, status (defaults to ACTIVE),
displayOrder. POST `/admin/coalitions`. Slug uniqueness checked
server-side; the dialog surfaces the error via `useActionState`.

### `/coalitions/[id]` — coalition detail

Two stacked sections.

**Top: coalition fields.** Edit-in-place form. `Fact` row shows
aggregate stats: total raised across children, total donor count, total
active campaigns. `Archive coalition` confirms when child campaigns
exist and blocks (409 from the API) when any child is still `ACTIVE`.

**Below: child campaigns.** `DataTable<Campaign>` filtered to this
coalition. Columns: Name (linked) · Status · Target · Raised (mini
`ProgressBar`) · Donors · Deadline · `…`.

"New campaign" opens a `Dialog` with all Campaign fields. Slug
uniqueness scoped per-org. Status defaults to `DRAFT` so the admin can
preview before publishing.

### `/campaigns/[id]` — campaign detail

Three sections.

**Top: campaign fields.** Edit-in-place form. Status transitions render
as explicit action buttons — `Promote to active`, `Mark complete`,
`Archive`, `Back to draft` — rather than a status dropdown, so
consequences are spelled out at the button level.

**Middle: KPI cards.** Existing `StatCard` / `KpiCard` primitives —
Raised / Goal / Donors / Days remaining / Active recurring donors.

**Bottom: donations under this campaign.** `DataTable<DonationRow>`
showing both one-time and recurring. Columns: Donor (name + email) ·
Mode · Cadence · Amount · Status · Created · `…`. Action menu surfaces:
"View on Stripe" (deep link) and "Cancel recurring" (admin force-cancel,
only on `ACTIVE & RECURRING`).

### `/transactions` extensions

Add to the existing Toolbar filters:

- `Kind` multi-select now includes `DONATION`.
- `Campaign` searchable select. Only renders when `Kind = DONATION` is
  selected.
- `Recurring only` toggle. Filters rows whose donation has
  `mode = RECURRING`.

No new page; the existing list already labels DONATION.

## Cross-cutting

### Receipts and confirmation

Enable Stripe Dashboard → "Email customers" → "Successful payments" for
the prod account. Donors get Stripe-rendered receipts automatically.
No app-side branded confirmation email in this cycle. Tax-receipt
emails (501(c)(3), EIN, deductibility) deferred entirely.

### Voice and copy

Match the editorial tone from `PRODUCT.md`:

- Section headlines lead with intent, not action: "Support the work" /
  "Where to give" — not "Donate now!".
- Buttons say what happens next: "Continue to donate" / "Cancel
  recurring" — not "Give today!".
- Empty / zero states are observational: "No active campaigns right
  now." — not "We're sorry, we don't have any campaigns at the moment."
- Numbers carry the persuasion: the "Raised $1,200 of $5,000 · 32
  donors · 14 days remaining" line is the emotional layer; the
  surrounding prose stays quiet.

Final copy lives in the implementation plan.

### SEO and shareability

Public campaign and coalition pages use Next.js `generateMetadata`:

- `<title>`: `{campaign.name} — {organizationName}`
- `<meta name="description">`: first ~160 chars of campaign description,
  markdown stripped
- `og:title`, `og:description`, `og:image` (`coverImageUrl`),
  `og:type=website`, `og:url` canonical
- `twitter:card=summary_large_image`

No `robots: noindex`. Campaigns are meant to be findable.

### Currency and time zones

All donations charged in `organization.defaultCurrency` (else `"usd"`).
Multi-currency donations not supported in this cycle.

`Campaign.deadline` stored as `DateTime` (UTC). Display formatted in the
organization's time zone where available, else the viewer's. The
`status === 'ACTIVE' && deadline > now()` check at the API layer is
UTC-comparable.

### Anonymity

`Donation.displayNameOptIn` defined and defaulted `false`. Unused in
this cycle. Reserving the field now avoids a migration when the public
donor list ships.

### Refunds and disputes

No donor-initiated refunds. Admin-issued refunds via Stripe Dashboard
flow through the existing `charge.refunded` webhook arm, writing a
`PaymentEvent` with `kind=REFUND`, `refundsPaymentIntentId` set, and
the `donationId` inherited from the original donation PaymentEvent
(see the donation-aware extension under the webhook section). The
inheritance is what makes `Campaign.raisedCents` reflect the net
amount the campaign still holds.

The Donation row stays unchanged for one-time refunds (it remains an
accurate record of intent at the time of the gift; `status` stays
`COMPLETED` because the donation did happen). For recurring, the admin
can also force-cancel the subscription via the admin endpoint to stop
future charges.

Disputes flow through the existing `charge.dispute.*` arms with the
same `donationId` inheritance. Donation rows are not touched on
dispute; the audit lives on PaymentEvent.

### Rate limiting and abuse

Public read endpoints (`GET /coalitions`, `GET /campaigns/:slug`)
inherit existing gateway-level rate limiting. Authenticated checkout
creation is naturally throttled by Stripe; a malicious authenticated
member could in theory loop on `POST /billing/checkout/donation`,
generating Stripe Sessions, but Stripe handles the volume and we accept
the risk.

### Feature flag

Per-organization `Organization.donationsEnabled` boolean, default
`false` for existing orgs. Gating:

- API: every donation, coalition, and campaign endpoint returns 404
  when the org's flag is off (404 not 403 — don't leak existence).
- Member shell: `/coalitions`, `/coalitions/[slug]`, `/campaigns/[slug]`,
  `/donate`, `/donate/thanks`, `/dashboard/donations` all 404 when the
  flag is off. Nav links (`Support` in `PublicNav`, `Donations` in
  `DashSidebar`) omit themselves.
- Admin shell: `Coalitions` nav entry and CRUD pages 404 when off.

The flag is the rollback. Flip to off and the surface disappears
end-to-end.

## Migration

Single Prisma migration creating `coalitions`, `campaigns`, `donations`,
the five new enums, and the `donation_id` column on `payment_events`.
No backfill required — no existing donation data exists. The migration
script also:

- Seeds one `Coalition` row per existing org (`slug = "general"`,
  `name = "General"`).
- Seeds one `Campaign` row per organization under the general coalition
  (`slug = "general-fund"`, `name = "General fund"`,
  `targetAmountCents = 0`, `status = ACTIVE`, no deadline).
- Adds the `donationsEnabled` column to `organizations` with
  `default false`.

The seed step runs idempotently inside the migration so re-running on
already-seeded orgs is safe.

## Failure modes and invariants

Invariants the spec depends on, with the surface that enforces each.

- **Every campaign has a coalition.** `Campaign.coalitionId NOT NULL`
  in the schema. No "orphan campaign" UI state exists.
- **Every donation targets a campaign.** `Donation.campaignId NOT NULL`.
- **Money attribution is unambiguous.** `PaymentEvent.kind = DONATION
  ⇒ donationId IS NOT NULL` (app-layer invariant; the column itself is
  nullable to preserve other kinds). Every write site of a donation
  PaymentEvent passes `donationId`.
- **Cancel is donor-scoped at the donor endpoint.** `POST
  /billing/donation/:id/cancel` returns 404 on cross-user attempts to
  avoid leaking the existence of others' donations.
- **Donation status is monotonic in practice.** `PENDING → ACTIVE`,
  `PENDING → COMPLETED`, `ACTIVE → CANCELED`, `PENDING → FAILED` are
  the only legal transitions. Every webhook arm guards on current
  status before transitioning.
- **PaymentEvent idempotency.** Every donation arm upserts on
  `stripeInvoiceId` (recurring) or `stripePaymentIntentId` (one-time).
  Replayed webhooks insert zero new rows.
- **Refund and dispute rows inherit `donationId`.** When a `REFUND` or
  `DISPUTE` PaymentEvent is written for a charge whose original event
  had `kind=DONATION`, the new row carries the same `donationId`. This
  is the invariant that makes `Campaign.raisedCents` reflect the net
  amount the campaign holds. A future contributor adding new
  refund-source webhook arms must preserve this rule.
- **Closed campaigns can't accept donations.** `POST
  /billing/checkout/donation` rejects on `status != ACTIVE` or
  `deadline < now`. A campaign that *transitions* to `COMPLETE` after a
  Session was minted but before checkout completes is still honored at
  the webhook — the money has been charged.
- **Coalition can't be archived while children are active.** API guard
  on `/admin/coalitions/:id/archive`.

Known acceptable risks:

- **Stripe Session minting volume.** An authenticated member can loop on
  `POST /billing/checkout/donation`. Stripe absorbs the volume; we don't
  add a custom limiter.
- **Re-submit friction after auth.** Donor who clicks Donate while
  signed out re-submits the form post-login. Stash-and-resume is the
  follow-up.
- **Cross-cycle campaign edits during recurring.** Admin can rename a
  campaign while donors have active recurring donations to it. The
  Donation row keeps its `campaignId`; future PaymentEvent rows
  continue to roll up under the (renamed) campaign. No special
  handling.

## Verification

Test focus is on state transitions, webhook idempotency, and
validation — the surfaces where bugs in this kind of work actually hide.

### Webhook coverage (`apps/api/test/donations.e2e-spec.ts`)

- **Donation guard prevents ticket issuance.** `checkout.session.completed`
  with `metadata.source='donation'`, `mode='payment'`, no
  `ticketRequestId`: asserts zero `Ticket` rows created, Donation flips
  `PENDING → COMPLETED`, PaymentEvent inserted with `kind=DONATION`.
- **One-time donation full lifecycle.** Session created →
  `checkout.session.created` writes `PENDING` PaymentEvent →
  `checkout.session.completed` flips Donation to `COMPLETED` and
  PaymentEvent to `SUCCEEDED`.
- **Recurring donation: first charge promotes to ACTIVE.** Session with
  `mode='subscription'`, `metadata.source='donation'` →
  `checkout.session.completed` captures `stripeSubscriptionId`, Donation
  stays `PENDING`. Then `invoice.paid` arrives → Donation flips to
  `ACTIVE`, fresh PaymentEvent row created.
- **Subsequent `invoice.paid` is idempotent.** Replaying the same
  invoice creates no duplicate PaymentEvent.
- **Subscription canceled out of band.** `customer.subscription.deleted`
  for a donation subscription → Donation flips `ACTIVE → CANCELED` even
  when the donor had already optimistically canceled.
- **`invoice.payment_failed`.** PaymentEvent inserted with
  `status=FAILED`, Donation status unchanged.
- **Webhook handles unknown ids gracefully.** Malformed metadata
  (campaign deleted between Session create and webhook arrival): warn
  and no-op, no 500.
- **Refund of a donation inherits `donationId` and nets
  `Campaign.raisedCents`.** Seed a `SUCCEEDED` donation PaymentEvent of
  +$50, fire `charge.refunded` for the same `PaymentIntent`, assert the
  new REFUND PaymentEvent has the same `donationId` as the original,
  and assert the campaign's computed `raisedCents` is now $0. Same
  shape for `charge.dispute.created`.

### API write coverage (`apps/api/test/billing-donations.e2e-spec.ts`)

- `POST /billing/checkout/donation` amount bounds (`100`, `1_000_000`
  accepted; `99`, `1_000_001` rejected).
- Cadence/mode coherence: `ONCE` rejected when paired with
  `RECURRING`-cadence body.
- Campaign existence / status: `DRAFT` and `COMPLETE` rejected with
  explicit error codes.
- Deadline guard: `deadline < now` rejected.
- Happy path: creates `Donation` with `status=PENDING`, returns
  `{ url, donationId }`, Stripe Session metadata stamped correctly
  (Stripe client mocked).
- `POST /billing/donation/:id/cancel` ownership: a different user's
  token returns 404.
- State guard: cancel on `PENDING` or `COMPLETED` rejected with explicit
  error; cancel on `ACTIVE + RECURRING` succeeds.
- Feature flag: every endpoint returns 404 when
  `organization.donationsEnabled = false`.

### API read coverage

- `GET /coalitions` returns only `ACTIVE`, scoped by `organizationId`,
  ordered by `displayOrder`.
- `GET /coalitions/:slug` 404 on `ARCHIVED`.
- `GET /campaigns/:slug` includes `raisedCents` matching the sum of
  PaymentEvent rows with `donationId` belonging to that campaign and
  `status=SUCCEEDED`. Seed two SUCCEEDED + one FAILED + one PENDING
  PaymentEvent; assert only SUCCEEDED sum.
- `GET /donations/mine` returns only the current user's rows.

### Admin API coverage

- Transition-endpoint legality matrix: every illegal transition returns
  400 with a clear code; every legal transition succeeds.
- Coalition archive blocked (409) when any child campaign is `ACTIVE`.
- Admin `cancel` endpoint bypasses the donor-ownership check but still
  rejects non-`ACTIVE` recurring rows.

### Frontend component coverage (Vitest in `packages/web-shared`)

- `DonatePanel`: cadence + amount chip selection writes correct hidden
  inputs; typing into "Custom amount" clears the active chip; clicking
  a chip clears the custom input; submitting with no amount blocks.
- `ProgressBar`: renders `min(raised/target, 1)`; handles `target = 0`
  without NaN.
- `CampaignCard` / `CoalitionCard`: renders without crashing when
  `coverImageUrl` is null.

### Member app server-action coverage

`apps/member/src/app/campaigns/__tests__/actions.test.ts`:

- `UnauthorizedError` → redirect to `/auth/login?next=` with the full
  query string preserved.
- `ApiError` → redirect to the campaign page with `?error=`.
- Happy path → redirect to the Stripe URL.

### Out of test scope

- Real Stripe test-mode integration tests. Existing membership / ticket
  tests already use the Stripe mock; donations follow the same pattern.
- Browser E2E (Playwright / Cypress). The repo doesn't have one yet;
  introducing it just for donations is its own effort. The feature
  flag is the production rollback.
- Visual regression tests. Not present in the redesign either.
- Load tests on public read endpoints. Volume is below any concerning
  threshold.

### Test data factories

Extend `apps/api/test/factories.ts` with:

- `coalitionFactory`, `campaignFactory`, `donationFactory`.
- `paymentEventFactory` accepts an optional `donationId`.
- `seedActiveRecurringDonation(user, campaign)` — wires Donation +
  Stripe-mock SubscriptionId + first PaymentEvent. Used in every
  recurring lifecycle test.

## Alternatives considered

- **Extend `PaymentEvent` only, no Donation entity.** Add `campaignId`
  to `PaymentEvent`, treat the most recent matching row as the active
  recurring. Rejected because cancel becomes "go to Stripe, hope the
  webhook updates the right row", and `PaymentEvent` would conflate
  append-only money movement with mutable subscription state.
- **Stripe Subscription as the source of truth.** Query Stripe directly
  for the recurring list on the dashboard. Rejected: couples the UI to
  Stripe API availability, and org-level analytics requires a sync job
  that recreates the local model anyway.
- **Cards-per-card pattern on `/donate` (like `/membership`).**
  One card per active campaign + general fund, each with its own donate
  form. Rejected: each card's amount and cadence controls make the
  cards much taller than membership cards; scales poorly past four or
  five campaigns; campaigns lose dedicated storytelling space.
- **Per-campaign Stripe Products + Prices.** Static Product per
  campaign, static Prices per amount tier. Rejected: doesn't support
  the custom-amount input, and creates a Stripe-side configuration
  burden every time a campaign launches. Inline `price_data` solves
  both.
- **Coalition-level donations.** Donor gives to the coalition; money
  pools at the coalition or splits across child campaigns. Rejected:
  ambiguous attribution from the donor's perspective ("where does my
  money actually go?") is the opposite of the editorial brand's
  clarity-first principle.
- **Sub-coalitions / nested coalition trees.** Rejected: adds real UI
  and reporting complexity for a hierarchy that hasn't been requested.
- **Stash-and-resume after login.** Server-side intent cookie that
  auto-resumes the donate form post-login. Reasonable follow-up; the
  re-submit friction is acceptable for the first cycle.
- **Donor-initiated refunds.** Rejected: refunds are an org-side
  decision; surfacing a refund button on the donor dashboard would
  invite abuse. Admin refunds via Stripe Dashboard flow through the
  existing webhook arm.

## References

- `docs/specs/2026-05-31-payment-events-ledger-design.md` — the ledger
  this builds on. Defers donation intake explicitly.
- `docs/plans/2026-05-31-002-feat-payment-events-ledger-plan.md` — the
  ledger implementation plan that also defers donation intake.
- `docs/specs/2026-05-31-app-redesign-direction.md` — the design system
  every donor and admin surface composes against.
- `PRODUCT.md` — brand personality and design principles. Drives the
  voice section above.
- `packages/db/api/schema.prisma` — the existing schema. New entities
  land here.
- `apps/api/src/billing/billing.controller.ts` — existing billing
  controller; donation endpoints colocate here or in a sibling
  `DonationsController`.
- `apps/api/src/webhooks/stripe-webhook.service.ts` — the webhook
  service that takes the donation guard patch.
- `apps/member/src/app/membership/page.tsx` — the page pattern donor
  surfaces follow.
- `apps/member/src/app/membership/actions.ts` — the server-action
  pattern `donateNow` follows.
