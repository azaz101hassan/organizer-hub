---
date: 2026-05-20
topic: phase-3-billing
---

# Phase 3 — Stripe Billing (Tiered Tickets + Platform Memberships)

## Summary

A Stripe-powered billing layer for OrganizerHub that lets attendees either subscribe to a platform-wide membership tier (Bronze, Silver, Gold) monthly or yearly, or buy a one-time tiered ticket to a specific event. Active members automatically get free tickets at any event whose ticket-tier they qualify for, unless the organizer has flagged that event as members-excluded.

---

## Problem Frame

At the end of Phase 2, OrganizerHub exposes events end-to-end — organizers can create and publish them through the dashboard, and anonymous attendees can browse the public list and read event detail pages — but there is no money path. Every "Get tickets" surface is a placeholder; attendees cannot buy anything, organizers cannot sell anything, and the product's stated hybrid one-time-plus-subscription business model exists only in the README.

The closest behavioral comparable is cpac.org: a single brand running tiered-ticket events (Student / General / Premium / VIP) alongside a paid supporter program where the supporter tier determines what is included for free vs. what an attendee still pays for. OrganizerHub's bet is that this hybrid shape is more durable than ticketing-only platforms (Eventbrite, Universe) or membership-only platforms (Patreon, Substack), because it lets one organizer monetize both casual attendees and engaged regulars through a single billing relationship instead of two disjoint ones.

---

## Actors

- A1. Platform (OrganizerHub) — merchant of record; owns the Stripe account; defines and seeds the membership tiers; processes every checkout regardless of whether the buyer is a member or an organizer's event attendee
- A2. Organizer — uses the dashboard to create events and configure each event's ticket types and members-excluded flag; never touches Stripe directly
- A3. Attendee / Member — buys tickets and/or subscribes via Stripe Checkout; "active member" means an attendee with a non-cancelled, non-lapsed subscription
- A4. Stripe — hosts the checkout UI, charges cards, bills subscriptions on cadence, and emits webhooks the API consumes

---

## Key Flows

- F1. New member subscribes to a tier
  - **Trigger:** Attendee clicks "Become a Bronze/Silver/Gold member" on the membership page and chooses a billing cadence (monthly or yearly)
  - **Actors:** A3, A4, A1
  - **Steps:** Attendee picks tier + cadence → API creates Stripe Checkout Session (subscription mode) with the matching Stripe Price → attendee is redirected to Stripe Checkout → on success Stripe redirects back to OrganizerHub → Stripe sends `checkout.session.completed` and `customer.subscription.created` webhooks → API records the Membership row and marks the attendee active at the selected tier
  - **Outcome:** Attendee has active tier-level access through `current_period_end`
  - **Covered by:** R1, R2, R12, R14
  - **Escape path:** Attendee abandons checkout → no Membership row created → next attempt starts cleanly
- F2. Member claims a free ticket to a covered event
  - **Trigger:** Active member views an event's detail page and sees "Claim free ticket" for at least one TicketType
  - **Actors:** A3, A1
  - **Steps:** Member clicks "Claim free ticket" on a specific TicketType → API verifies the member's current tier ≥ TicketType.min_tier_level AND event is not members-excluded AND no prior claim exists for this (member, event, TicketType) → API issues a Ticket marked as a membership claim (no payment) → member sees confirmation in dashboard
  - **Outcome:** Member holds a valid Ticket; no Stripe charge is created
  - **Covered by:** R8, R9, R10
  - **Escape path:** Coverage check fails (tier downgraded, event toggled members-excluded between page load and click) → API returns 409 and UI re-renders with "Buy" instead
- F3. Non-member or insufficient-tier member buys a paid ticket
  - **Trigger:** Attendee clicks "Buy" on a TicketType, either because they're not a member or their tier is below `min_tier_level` or the event is members-excluded
  - **Actors:** A3, A4, A1
  - **Steps:** Attendee picks TicketType → API creates Stripe Checkout Session (payment mode) for the TicketType's `priceCents` → attendee completes Stripe Checkout → Stripe sends `checkout.session.completed` webhook → API issues the Ticket marked as a paid purchase
  - **Outcome:** Attendee holds a valid Ticket linked to the Stripe payment
  - **Covered by:** R6, R12
  - **Escape path:** Checkout abandoned → no Ticket issued
- F4. Member subscription lapses or is cancelled
  - **Trigger:** Stripe emits `customer.subscription.updated` (cancel_at_period_end set) or `customer.subscription.deleted`, or `invoice.payment_failed` for a renewal
  - **Actors:** A4, A1, A3
  - **Steps:** Stripe sends webhook → API updates Membership row (cancellation date or lapsed status) → at `current_period_end` the member is no longer "active" → previously-issued Tickets stay valid → future "Claim free ticket" actions are gated by the standard coverage check, which now fails
  - **Outcome:** Member loses prospective tier access at period end; retains all tickets already issued
  - **Covered by:** R3, R4, R11, R14
- F5. Organizer marks a premium event as members-excluded
  - **Trigger:** Organizer (OWNER/ADMIN) edits an event and toggles "Exclude this event from membership coverage"
  - **Actors:** A2, A1
  - **Steps:** Organizer toggles flag on event-edit page → API updates `Event.members_excluded = true` → all subsequent coverage checks for that event return "not covered" regardless of member tier → tickets already issued before the toggle remain valid
  - **Outcome:** Members must pay full price for this event going forward
  - **Covered by:** R7, R11, R16

---

## Requirements

**Membership tiers and subscription billing**
- R1. The platform defines a fixed, seeded set of membership tiers — Bronze, Silver, Gold — each with an ordered `tier_level` (1, 2, 3) and a configured Stripe Price per billing cadence (monthly, yearly), for six Stripe Prices total. Tier definitions are NOT organizer-configurable in Phase 3.
- R2. Attendees subscribe to a tier via Stripe Checkout in subscription mode. On successful completion, the attendee is recorded as an active member at the selected tier until `current_period_end`.
- R3. A member can cancel their subscription. Cancellation takes effect at `current_period_end`; the member retains tier access until then and loses it immediately after.
- R4. Subscription lifecycle webhook events from Stripe — created, updated (including upgrades, downgrades, and `cancel_at_period_end`), deleted, and renewal payment failures — keep the member's recorded tier and active-status in sync.

**Ticket types and one-time purchases**
- R5. Each event can have zero or more TicketType definitions. Each TicketType has a human-readable name (e.g., "GA", "VIP"), a `priceCents`, and a `min_tier_level` (0 means any tier qualifies if the event is otherwise covered).
- R6. Attendees buy a one-time ticket via Stripe Checkout in payment mode. On successful completion, one Ticket record is issued, bound to the attendee, the event, and the purchased TicketType, with provenance recorded as a paid purchase.
- R7. Each Event has a `members_excluded` boolean (default `false`). When `true`, no membership tier grants free-ticket access on that event — all attendees, members or not, must purchase.

**Coverage rules and free-ticket issuance**
- R8. When an active member views an event detail page, the UI shows "Claim free ticket" for a TicketType when all three conditions hold: the event is not members-excluded; the member's `tier_level` is greater than or equal to the TicketType's `min_tier_level`; and the member has not already claimed this (event, TicketType) pair. Otherwise the UI shows "Buy" with the priceCents.

  | Attendee state | Event flag | Member tier vs. TicketType min | UI |
  |---|---|---|---|
  | Not a member | any | n/a | Buy ($price) |
  | Active member | `members_excluded = true` | any | Buy ($price) |
  | Active member | `members_excluded = false` | tier_level < min_tier_level | Buy ($price) |
  | Active member | `members_excluded = false` | tier_level >= min_tier_level | Claim free ticket |

- R9. Free-ticket issuance occurs through an OrganizerHub API call, not through Stripe Checkout. The Ticket record reflects that it was issued through membership coverage rather than purchased, so downstream reporting can distinguish member-claimed tickets from paid ones.
- R10. Free-ticket issuance is idempotent per (member, event, TicketType) tuple — a member cannot claim multiple free tickets of the same type for the same event. Re-attempts return a duplicate-claim error.
- R11. Tickets remain valid after the issuing membership cancels, downgrades, or lapses, and after an event's `members_excluded` flag is toggled. Once issued, a Ticket is the attendee's earned asset.

**Stripe integration and webhook handling**
- R12. Stripe webhook handlers are idempotent: a redelivered or retried event must not produce duplicate Tickets, duplicate Memberships, or double-applied subscription state changes.
- R13. Every incoming Stripe webhook request has its signature verified against `STRIPE_WEBHOOK_SECRET`. Requests with missing or invalid signatures are rejected with HTTP 400 and not processed.
- R14. The API handles at minimum these Stripe event types: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`. Other event types may be acknowledged without action.

**Organizer-facing controls**
- R15. The event create/edit dashboard surface lets OWNER/ADMIN add, edit, and remove TicketTypes for an event, including each TicketType's name, price, and `min_tier_level`.
- R16. The event edit surface lets OWNER/ADMIN toggle `members_excluded` for the event, with a clear label that toggling on means members lose free-ticket access on this event going forward.

**Data-model evolution (Phase 2 cleanup)**
- R17. The Phase 2 `Membership` concept (user-to-organization role with OWNER / ADMIN / MEMBER) is renamed to a non-colliding name (e.g., `OrganizationMember`) before the new platform-tier Membership concept lands. The rename is a single migration ahead of, or bundled into, Phase 3's first schema change.

---

## Acceptance Examples

- AE1. **Covers R2, R4.** Given an attendee with no active subscription, when they complete Stripe Checkout for the Gold-monthly Price and Stripe delivers `checkout.session.completed` followed by `customer.subscription.created`, then a Membership row exists for that attendee with tier = Gold and active = true through `current_period_end`.
- AE2. **Covers R8, R9.** Given a Gold member viewing an event with TicketTypes `{ GA min_tier_level=1, VIP min_tier_level=3 }` and `members_excluded=false`, when they click "Claim free ticket" on VIP, then a Ticket is issued as a membership-claim with no Stripe charge.
- AE3. **Covers R7, R8.** Given a Gold member viewing an event with `members_excluded=true`, when they view ticket options, then every TicketType shows "Buy ($price)" and no "Claim free ticket" affordance.
- AE4. **Covers R10.** Given a Gold member who has already claimed a free GA ticket for event E, when they attempt to claim another free GA ticket for the same event, then the request returns a duplicate-claim error and no new Ticket is created.
- AE5. **Covers R11.** Given a member who claimed a free ticket on 2026-06-01 and cancelled their subscription on 2026-06-15, when the event occurs on 2026-07-10, then their ticket is still valid.
- AE6. **Covers R3, R4.** Given a member with active monthly subscription, when they cancel mid-month, then their tier-level access remains usable until `current_period_end` and lapses immediately after.
- AE7. **Covers R12.** Given Stripe re-delivers a `checkout.session.completed` webhook the API has already processed, when the handler runs again, then no duplicate Ticket is created and no duplicate Membership state change is applied.
- AE8. **Covers R13.** Given a request to the webhook endpoint with an invalid or missing Stripe signature, when the API receives it, then the request is rejected with HTTP 400 and no side effect occurs.

---

## Success Criteria

- An attendee can complete the end-to-end purchase flow for either a membership subscription or a one-time ticket via Stripe Checkout, and the resulting state is reflected in OrganizerHub's database within seconds of Stripe's webhook arriving.
- An active member can claim a free covered ticket in a single in-app click — no Stripe redirect — and that ticket remains valid after a subsequent subscription cancellation or downgrade.
- An organizer can configure a new event with multiple ticket tiers and toggle the members-excluded flag entirely through the dashboard with no engineering involvement.
- Stripe webhook replays do not produce duplicate Tickets, duplicate Memberships, or double-applied subscription state — verified by replaying webhooks against a test environment.
- An implementation plan can be derived from this document without needing to invent product behavior, scope boundaries, or success criteria.

---

## Scope Boundaries

- Sponsor packages (B2B event sponsorships, sponsor-tier perks tied to specific events) — Phase 4+
- Refunds, chargebacks, and dispute handling — Phase 4+
- Organizer payouts and revenue-share — Phase 4+; under the platform-collects model, revenue accumulates in OrganizerHub's Stripe account and any redistribution is a later concern
- Event capacity, sold-out states, waitlists, per-tier inventory — Phase 4+
- Coupons, promo codes, discount codes — out of Phase 3
- Multi-currency support — out of Phase 3 (single platform currency, likely USD)
- Custom receipt emails beyond Stripe's defaults — out of Phase 3
- Discount-percentage coverage (e.g., "Silver members get 50% off VIP") — Phase 3 coverage stays binary
- Membership gift, family plans, or transferable subscriptions — Phase 4+
- Organizer-configurable membership tiers (each organization defining their own Bronze / Silver / Gold semantics) — explicitly out: tiers are platform-defined and uniform across OrganizerHub
- Stripe Connect / connected organizer accounts — out (platform-collects only)
- Member-side ticket cancellation or self-refund — out of Phase 3

---

## Key Decisions

- Platform-wide membership over per-organization membership: a single platform-tier identity simplifies billing, lets one Stripe Customer back one attendee across many organizers' events, and decouples membership economics from the organizer tenant. The cost is renaming the Phase 2 Membership role concept so the words don't collide (R17).
- Tier ordering with per-event override over an explicit MembershipPlan ↔ TicketType join table: chosen for the lowest organizer-UX cost while still expressing "membership covers most events, but not the annual gala." A future need for per-tier discount percentages or per-ticket-type coverage exceptions can extend this without breaking the simple-default case.
- Free-ticket issuance bypasses Stripe Checkout: a direct in-app claim avoids $0 Stripe sessions, gives a clean audit-trail distinction between paid and member-claimed tickets, and keeps the Stripe surface focused on actual money movement.
- Membership tiers are platform-seeded, not organizer-configurable, in Phase 3: keeps scope manageable; organizer-defined tiers can come later if organizer demand surfaces.
- Tickets issued during active membership remain valid after the membership ends: standard SaaS "earned benefit" pattern; avoids retroactive invalidation logic and aligns with attendee expectations.
- TicketTypes are event-scoped, not template-based: each event defines its own ticket tiers from scratch. Organization-level templates for recurring series may come in Phase 4+ if recurring-event organizers ask for them.
- API service hosts Stripe integration; accounts service stays identity-only: keeps the OAuth/OIDC bounded context clean and avoids coupling billing state to the auth surface.

---

## Dependencies / Assumptions

- A Stripe account is set up for OrganizerHub; Products + Prices for Bronze/Silver/Gold × monthly/yearly (six Stripe Prices total) are created in the Stripe dashboard and their Price IDs are available to the API.
- Environment variables `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` are wired in. Placeholders already exist in `.env.example` as of Phase 2; Phase 3 makes them required.
- Local development requires the Stripe CLI (`stripe listen`) or an equivalent tunnel to forward webhooks to a developer's machine; production-style HTTPS endpoints are assumed in deployed environments.
- A Stripe Customer is created (or looked up) per OrganizerHub user on first checkout; the user record stores the resulting `stripe_customer_id`.
- An attendee can hold at most one active membership subscription at a time; concurrent subscriptions across tiers or cadences are not supported.
- Phase 2's existing Event, Organization, and (post-rename) OrganizationMember models stay in place; Phase 3 layers TicketType, Ticket, MembershipPlan, and Membership on top.
- The webhook secret is rotated only by re-deployment, not at runtime.
- Single platform currency in Phase 3 (likely USD); currency is not configurable per event or per tier.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R1][Technical] Where do the six membership Stripe Price IDs live — environment variables, a checked-in config file, or a seeded database table?
- [Affects R12][Technical] Does Stripe webhook handling live in the same NestJS controller surface as the rest of the API or in a dedicated webhook module? What's the local-dev story with `stripe listen`?
- [Affects R8, R9][Technical] How is free-ticket-claim idempotency enforced — a unique constraint on (member_id, event_id, ticket_type_id), a client-supplied idempotency key, or both?
- [Affects R17][Technical] Does the Phase 2 `Membership` rename ship as a standalone migration ahead of Phase 3's first new-table migration, or bundled into it?
- [Affects R6][Needs research] What is Stripe Checkout's exact behavior when an attendee closes the tab mid-checkout — does the session expire on its own, or does OrganizerHub need any cleanup path?
- [Affects R2, R6][Needs research] Should the API persist a pending-checkout record before redirecting to Stripe, or wait for the webhook to be the source of truth? Trade-off between observability and write-amplification.
- [Affects R4][Technical] What's the policy on `invoice.payment_failed` — immediate lapse, grace period (e.g., Stripe's smart-retry window), or platform-defined retry window?
