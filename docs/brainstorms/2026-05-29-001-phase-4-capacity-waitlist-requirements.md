---
date: 2026-05-29
topic: phase-4-capacity-waitlist
---

# Phase 4 — Per-TicketType Capacity + Admin-Moderated Waitlist

## Summary

Add an optional soft cap to each TicketType. Under cap, Phase 3's instant ticket flow stays intact. Once a tier hits its cap, subsequent paid purchases and free member claims become `TicketRequest` rows that surface in a real-time admin queue, where the organizer can approve, approve-with-warning (audit-trailed), or reject. Approved paid requests receive an emailed Stripe Checkout link; approved free claims issue immediately. Phase 4 also introduces a transactional email channel so requesters learn the outcome without having to poll the dashboard.

---

## Problem Frame

Phase 3 shipped ticketing as an instant-issue model: a paid checkout completes and the webhook stamps a Ticket; a coverage-eligible member POSTs `/tickets/claim` and gets a Ticket in the same request. The unconditional issuance was the right cut for Phase 3 because it removed the parallel admin queue that would have blocked the money-loop demo, but it also means an organizer running a small-venue event today has no enforcement against overbooking and no surface to consciously approve the marginal attendee. The organizer's only present option is either to leave the event uncapped and hope, or to set the TicketType price/min-tier high enough that demand stays inside the room — neither of which is the actual control they want.

The pain shows up at exactly two moments: the moment a tier is technically sold out but the organizer would still like to admit one more friend-of-the-band, and the moment a member tries to claim a free ticket after the room is full and gets a silent failure instead of an "ask the organizer" path. The expected real-world workaround for both is out-of-band — a Slack message, a side spreadsheet — invisible to the platform. (OrganizerHub is a portfolio project, so this is the persona behavior the phase is designed against, not measured data from deployed organizers.)

---

## Actors

- A1. **Buyer (non-member)**: starts a paid purchase from a public event page; today goes straight to Stripe Checkout.
- A2. **Member**: starts either a paid purchase or a free coverage claim; today the free path issues a Ticket directly.
- A3. **Organizer Admin** (`OWNER` or `ADMIN` on the org): controls TicketType capacity, reviews the request queue, approves/rejects pending requests.
- A4. **Stripe**: passive in this phase — same Checkout role as in Phase 3, just invoked at a later moment for over-cap paid requests.
- A5. **Scheduler**: the in-process scheduled-job runner that sweeps `PENDING` requests whose event has started and transitions them to `REJECTED`.

---

## Key Flows

- F1. **Paid request over cap**
  - **Trigger:** Buyer clicks "Buy" for a TicketType whose `issuedCount >= cap`.
  - **Actors:** A1 (or A2), A3, A4.
  - **Steps:** (1) API creates a `TicketRequest{intent=PAID, status=PENDING}` and returns it instead of a Checkout redirect. (2) Admin sees the request appear in real time via SSE. (3) Admin approves. (4) System emails the buyer a one-shot Stripe Checkout link. (5) Buyer completes Checkout. (6) Existing Phase 3 webhook issues the Ticket.
  - **Outcome:** Ticket exists with `source=PAID`; the TicketRequest is in `APPROVED` and references the issued Ticket. If the buyer never pays before the link expires, the request lapses to `EXPIRED` (R18). The audit trail records the admin's decision regardless of whether it was over cap.
  - **Covered by:** R3, R4, R5, R11, R12, R14, R16, R18.

- F2. **Free claim over cap**
  - **Trigger:** Eligible member POSTs `/tickets/claim` for a TicketType whose `issuedCount >= cap`.
  - **Actors:** A2, A3.
  - **Steps:** (1) Eligibility checks pass (tier ≥ minTierLevel, event not members-excluded, no prior claim). (2) API creates `TicketRequest{intent=MEMBERSHIP_CLAIM, status=PENDING}` instead of a Ticket. (3) Admin reviews and approves. (4) System issues the Ticket inline (no Stripe involvement). (5) System emails the member the approval.
  - **Outcome:** Ticket exists with `source=MEMBERSHIP_CLAIM`; the TicketRequest is in `APPROVED`. Audit row written.
  - **Covered by:** R3, R5, R10, R12, R14, R16.

- F3. **Admin reject**
  - **Trigger:** Admin clicks "Reject" on a pending request.
  - **Actors:** A3.
  - **Steps:** (1) TicketRequest transitions to `REJECTED`. (2) System emails the requester. (3) Audit row written.
  - **Outcome:** No Ticket. No Stripe activity. Requester has an emailed explanation.
  - **Covered by:** R13, R14, R16.

- F4. **Requester self-cancel**
  - **Trigger:** Requester clicks "Cancel my request" on their dashboard while the request is `PENDING`.
  - **Actors:** A1 or A2.
  - **Steps:** (1) API transitions the request to `CANCELLED_BY_USER`. (2) No email; no audit row (no admin involved). (3) Queue UI removes the row in real time via SSE.
  - **Outcome:** Request is closed; no further admin action possible. Idempotent — a second cancel call is a no-op.
  - **Covered by:** R6, R15, R27.

- F5. **Auto-reject at event start**
  - **Trigger:** Scheduler observes an event whose `startsAt` has passed and which has `PENDING` requests attached.
  - **Actors:** A5; emails reach A1 / A2.
  - **Steps:** (1) Scheduler transitions each affected request to `REJECTED` with reason `expired_at_event_start`. (2) Standard rejection email sent. (3) No audit row (no admin involved).
  - **Outcome:** Queue is bounded by event lifetime; no PENDING request outlives its event.
  - **Covered by:** R7, R16.

---

## Requirements

**Capacity model**
- R1. Each `TicketType` carries an optional soft cap. A null cap preserves Phase 3 behavior (no limit, instant issuance).
- R2. Under cap, Phase 3 surfaces are unmodified: paid Checkout issues a Ticket on `checkout.session.completed`; `/tickets/claim` issues a free Ticket in-band.
- R3. At cap (`issuedCount >= cap`), the paid purchase endpoint and the free claim endpoint each produce a `TicketRequest` in `PENDING` state in place of their Phase 3 success response.

**Request lifecycle**
- R4. A `TicketRequest` carries: requester user, target `TicketType`, intent (`PAID` or `MEMBERSHIP_CLAIM`), creation timestamp, and current status (`PENDING`, `APPROVED`, `REJECTED`, `CANCELLED_BY_USER`, `EXPIRED`).
- R5. Phase 3 eligibility gates (member-tier coverage, `members_excluded`, prior-claim idempotency for free claims) run BEFORE a `TicketRequest` is created. Ineligible attempts return the same errors they do in Phase 3 and never enter the queue.
- R6. The requester can transition their own `PENDING` request to `CANCELLED_BY_USER` from their dashboard. The transition is idempotent and fails (no-op or 409) if the request has already been decided.
- R7. `PENDING` requests auto-reject when their event's `startsAt` has passed. A scheduled job transitions each affected request to `REJECTED` with the reason `expired_at_event_start` and dispatches the standard rejection email.

**Admin queue**
- R8. Organizers see the pending queue for their org's events in the dashboard, updated in real time via Server-Sent Events.
- R9. Organizers with `OWNER` or `ADMIN` role can approve or reject any pending `TicketRequest` belonging to their org's events.

**Approval outcomes**
- R10. Approving a `MEMBERSHIP_CLAIM` request issues the Ticket directly and transitions the request to `APPROVED`. An approval email is sent to the requester.
- R11. Approving a `PAID` request emails the buyer a single-use Stripe Checkout link. The Ticket only materializes when the buyer completes Checkout (via the existing Phase 3 webhook). The TicketRequest stays `APPROVED` until the buyer pays (→ Ticket issued) or the link expires (→ `EXPIRED`, see R18).
- R12. Approving a request when `issuedCount >= cap` is permitted — the cap is soft and the admin always has the override. The admin UI surfaces a **non-blocking** warning at decision time showing the current `cap` and `issuedCount`; the audit-trail row for the decision captures the cap state. (An aggregate "approving all N pending puts you X over cap" projection is out of scope — see Scope Boundaries.)
- R13. Rejecting a request transitions it to `REJECTED` and emails the requester. No Stripe activity occurs for either intent.

**Audit trail**
- R14. Every admin decision (approve or reject) writes one audit-trail row capturing at minimum: the admin's user identity, the `TicketRequest`, the cap value at decision time, the `issuedCount` before the decision, the resulting `issuedCount` after, and the decision verb (approve / reject).

**Realtime + notifications**
- R15. The admin dashboard queue updates without page refresh when a request lands, is approved, is rejected, or is cancelled by its requester. Transport is Server-Sent Events.
- R16. Approve, reject, and auto-reject-at-event-start transitions trigger a transactional email to the affected requester. The phase introduces the transactional-mail infrastructure (no mailer exists today). Email content and templates are specified in R21.

**Capacity configuration**
- R17. Organizers set or clear a `TicketType`'s cap from the existing Phase 3 TicketType create/edit form. The cap is a nullable non-negative integer; `0` is rejected as invalid (use null for "no cap"). Setting a cap below the current `issuedCount` is permitted and surfaces a warning — already-issued tickets are never revoked (consistent with the soft-cap model in R2).

**Approval expiry**
- R18. A `PAID` approval's Stripe Checkout session carries an explicit expiry (24h, matching Stripe's default, stated rather than left implicit). If it lapses unpaid, the `TicketRequest` transitions `APPROVED` → `EXPIRED`, and the lapse is reflected in the organizer's dashboard so the seat is visibly free again. Because no capacity was held while pending (no soft hold), `EXPIRED` records the lapse without an inventory release. A requester who still wants in submits a new request.

**Requester-facing surface**
- R19. Phase 4 ships a requester dashboard at `/dashboard/requests` listing the caller's own `TicketRequest`s with status, plus a per-request detail view. The surface specifies states for `PENDING` (with a Cancel action), `APPROVED`-awaiting-payment (PAID — shows the Checkout call-to-action), `APPROVED`-with-ticket (issued), `REJECTED`, `CANCELLED_BY_USER`, and `EXPIRED`, alongside loading and empty states.
- R20. The public event detail page renders an at-cap affordance per `TicketType`: when `issuedCount >= cap`, the Phase 3 buy / claim button becomes a "Request a spot" action. This extends the Phase 3 coverage-verdict button states with an `AT_CAP` state rather than showing a dead "sold out".

**Email content**
- R21. Three transactional email templates: (a) **PAID approved** — carries the direct Stripe-hosted Checkout URL as the primary call-to-action, states the link's expiry, and links to the requester dashboard for status; (b) **MEMBERSHIP_CLAIM approved** — confirms the issued ticket, no payment action; (c) **rejected** — used for both admin rejection and auto-reject-at-event-start, surfacing the reason. Free-text rejection reasons are out of scope this phase (see deferred review questions).

**Accessibility**
- R22. The SSE-updated admin queue announces row arrivals, removals, and status transitions through an ARIA live region (e.g., `role="log"` / `aria-live="polite"`) so assistive-technology users perceive updates that arrive without a page refresh.

**Security & authorization**
- R23. The SSE endpoint authenticates at connection time and refuses the upgrade (HTTP 401) before streaming any data to an unauthenticated caller. Org-scoping (`OWNER`/`ADMIN` on the target org) is enforced at connect, not deferred until the first push. A mid-stream token expiry closes the stream rather than continuing to emit.
- R24. The Stripe Checkout session created on `PAID` approval is scoped to the approved requester's Stripe Customer and carries an explicit expiry (R18). A completed Checkout whose `TicketRequest` is no longer `APPROVED` (superseded, cancelled, or expired) must not issue a Ticket — the webhook reconciles against current request state.
- R25. `TicketRequest` state transitions are atomic, and the system guarantees at most one Ticket per `TicketRequest`. Concurrent transitions to a terminal state resolve to exactly one success; the loser receives a conflict (409). This underpins AE10 and both the two-admins and self-cancel-vs-approve races.
- R26. Transactional-mail security: provider credentials live in environment secrets (never source control); the sending domain has SPF and DKIM configured; email delivery failure is non-blocking (the `TicketRequest` transition is durable, delivery is best-effort with logging); and the Checkout link in approval emails is a direct Stripe-hosted URL, never a redirect through the platform's own domain.
- R27. Requester-facing `TicketRequest` endpoints (view, cancel) verify the authenticated caller owns the request; requests belonging to other users return 404, consistent with the existence-hiding convention established in Phase 2 / Phase 3.

---

## Acceptance Examples

- AE1. **Covers R3, R5.** Given a TicketType with `cap=10` and `issuedCount=10`, when a non-member calls the paid-purchase endpoint, the response is a created TicketRequest in `PENDING` state, not a Stripe Checkout redirect.
- AE2. **Covers R3, R5.** Given a TicketType with `cap=5` and `issuedCount=5`, when a member with tier ≥ `minTierLevel` POSTs `/tickets/claim`, the response is a created TicketRequest in `PENDING`. When the same member's tier is below `minTierLevel`, the response is the Phase 3 403 (eligibility runs before the cap check; no request is created).
- AE3. **Covers R10, R14, R16.** Given a `PENDING` `MEMBERSHIP_CLAIM` request, when an admin approves it, a Ticket row is created with `source=MEMBERSHIP_CLAIM`, the request is `APPROVED` and linked to the new Ticket, an audit-trail row is written, and an approval email is sent to the requester.
- AE4. **Covers R11, R14, R16.** Given a `PENDING` `PAID` request, when an admin approves it, the buyer receives an email carrying a Stripe Checkout link, an audit-trail row is written, and the request is `APPROVED`. No Ticket exists yet. The Ticket materializes only if the buyer completes Checkout, triggering the existing Phase 3 webhook path.
- AE5. **Covers R12, R14.** Given a `MEMBERSHIP_CLAIM` TicketType with `cap=10` and `issuedCount=10`, when an admin approves the pending request, the approval succeeds, the Ticket issues inline, and the audit-trail row records `cap=10`, `issuedCountBefore=10`, `issuedCountAfter=11`, and the admin's identity. (For a `PAID` request the audit row records the decision and cap state at approval time; `issuedCount` is unchanged until the buyer pays — see R11.)
- AE6. **Covers R13, R14, R16.** Given a `PENDING` request, when an admin rejects it, the request is `REJECTED`, an audit-trail row is written with verb `reject`, a rejection email is sent to the requester, and no Stripe API call is made.
- AE7. **Covers R1, R2.** Given a TicketType with `cap=null` (no cap), every paid purchase and every free claim behaves exactly as in Phase 3 — no TicketRequest is ever created.
- AE8. **Covers R6, R15.** Given a `PENDING` request, when its creator calls cancel, the request is `CANCELLED_BY_USER`, the admin queue UI removes it via SSE within ~1s, no email is sent, and no audit-trail row is written. A second cancel call on the same request is a no-op (idempotent).
- AE9. **Covers R7, R16.** Given a `PENDING` request whose event's `startsAt` has passed, when the scheduler sweep runs, the request transitions to `REJECTED` with reason `expired_at_event_start`, the standard rejection email is sent, and no admin-decision audit row is written (the row originates from the scheduler, not an admin).
- AE10. **Covers R6, R9, R25.** Given a request the requester has already cancelled (`CANCELLED_BY_USER`), when an admin attempts to approve it, the API responds 409 (or comparable conflict status) and no state change occurs.
- AE11. **Covers R18, R24.** Given an `APPROVED` `PAID` request whose Stripe Checkout link has expired unpaid, the request is `EXPIRED`, no Ticket exists, and the lapse is visible in the organizer's dashboard. If a Checkout for that session somehow completes afterward, the webhook does not issue a Ticket (the request is no longer `APPROVED`).
- AE12. **Covers R27.** Given a `TicketRequest` belonging to user A, when user B calls the view or cancel endpoint for it, the API responds 404 (existence hidden), and the request is unchanged.

---

## Success Criteria

- An organizer running a small-venue event can set a per-tier cap on the dashboard, watch their queue light up as soon as the cap fills, approve a friend-of-the-band over cap after a one-step confirmation, and see the over-cap decision recorded in an audit trail — all without leaving the dashboard or touching Stripe.
- A member who tries to claim a free ticket for a sold-out tier sees "request submitted" instead of a silent failure, and receives an email when the request is approved, rejected, or auto-rejected at event start.
- A buyer can withdraw a pending request from their dashboard without admin involvement.
- `ce-plan` can produce a dependency-ordered implementation plan from this doc without inventing the request lifecycle, the cap semantics, the admin actions, the mail content shape, or which Phase 3 surfaces are or are not modified.

---

## Scope Boundaries

- Refunds, chargebacks, and dispute handling — deferred to Phase 5. Refunds remain a manual Stripe-Dashboard action by the organizer, with no Ticket-state sync.
- Hard caps that block over-cap approval — the cap is soft by design. Admin always has the override.
- Stripe auth-and-capture, SetupIntent, or "charge later" flows for paid requests — emailed Checkout link is the chosen pattern.
- WebSocket or polling-based realtime updates — SSE is the chosen channel.
- Per-Event total cap (a single cap across all TicketTypes) — different shape; not in this phase.
- Soft hold of capacity while a request is `PENDING` — inventory tracks only issued tickets; pending requests don't decrement.
- Aggregate over-cap visibility — a projected "approving all N pending puts you X over cap" rollup in the admin UI is deferred. Phase 4 shows per-decision `cap` / `issuedCount` only (R12).
- Admin-side notifications on queue arrival — organizers learn of pending requests by opening the dashboard (R8 / R15 update it live while viewing); a proactive admin email or digest when the queue goes from empty to non-empty is deferred.
- Auto-promotion from queue to instant-issue when an admin raises the cap — every queued item still requires explicit admin decision.
- Bulk approve/reject — admin actions are single-item only.
- Reordering or prioritization of the queue (FIFO is the default; no VIP-tier first-served logic).
- Non-admin audit rows (capacity edits, user cancellations, scheduler auto-rejects) — only admin approve/reject is captured this phase. Emitting rows for other sources is Phase 5 work; the Phase 4 schema is not pre-generalized for them.
- In-app inbox / push notifications — email is the only outbound channel in this phase.

---

## Key Decisions

- **Cap lives on `TicketType`, not `Event`** — matches the tiered model Phase 3 already exposes in the dashboard. Per-event totals don't distinguish GA from VIP sell-outs.
- **Pay-after-approval via emailed Stripe Checkout link** — reuses Phase 3's Checkout integration end-to-end. Accepted trade-off: buyer drop-off between approval and payment is possible (and bounded by R18's link expiry), in exchange for zero new Stripe integration surface.
- **No soft hold while pending** — keeps capacity state binary (issued vs free) instead of three-state (issued vs reserved-pending vs free). The over-cap "warning" is pushed into the admin UI, not the inventory.
- **SSE over WebSocket for realtime** — one-way push is exactly what the queue needs; native NestJS `@Sse()` support; no sticky-session concerns.
- **Soft cap with admin override** — admin always gets the last word. The cap is a guideline that produces friction at the boundary, not a wall.
- **Refunds deferred to Phase 5** — Phase 4's value emerges without the refund flow, and combining them would have doubled the surface for a portfolio milestone. Refunds couple back to capacity (released seat) and to Stripe lifecycle (`charge.refunded`, `charge.dispute.created`) and earn their own phase.
- **Requester can self-cancel a `PENDING` request** — a request whose plans have changed is closed by the requester, not orphaned until admin notices. Adds the `CANCELLED_BY_USER` lifecycle state but no admin-side complexity.
- **Auto-reject at event start (not a fixed-day TTL)** — the natural deadline for a "may I please come" request is the event itself. No arbitrary TTL number to pick or rationalize. The scheduler is event-anchored.
- **Audit trail records every admin decision (approve and reject)** — not over-cap only. The cap state on each row keeps over-cap queryable.
- **Email-only notifications this phase** — introduces a transactional mailer dependency. In-app inbox is out of scope; an unattended buyer's only signal is the approve / reject email.

---

## Dependencies / Assumptions

- Phase 3's `Ticket`, `TicketType`, `BillingCustomer`, `WebhookEvent`, `syncStripeData`, and webhook controller are in place and operate as documented in `docs/plans/2026-05-21-001-feat-phase-3-stripe-billing-plan.md`. Phase 4 extends these surfaces; it does not modify them under cap.
- A transactional email channel does NOT yet exist in the codebase (verified: no `@nestjs-modules/mailer`, `nodemailer`, or comparable dependency present). Phase 4 introduces it — provider selection (SMTP, Resend, Postmark, etc.) is a planning concern, not a brainstorm decision.
- A scheduled-job runner is required for R7. Phase 3 does not run one today. Planning chooses between an in-process cron (e.g., `@nestjs/schedule`), an out-of-process scheduler, or piggybacking on an existing event-loop tick.
- The Phase 3 `Event` model is assumed to carry a non-null, single `startsAt` (no recurring or open-ended events); R7's auto-reject anchors on it. Planning to confirm against the Phase 3 schema before relying on it.
- Browser clients reaching the SSE endpoint support `EventSource` (modern evergreen browsers do); production reverse-proxy configuration tolerates long-lived `text/event-stream` connections.
- `OWNER`/`ADMIN` role-gating from Phase 2's `OrganizationMember` model is the authoritative authorization layer for queue actions.
- Email deep links point at the requester dashboard (`/dashboard/requests` plus per-request detail), specified as a first-class surface in R19 rather than an implied dependency.

---

## Outstanding Questions

### Resolve Before Planning

(None. The four open product decisions from the initial draft — requester self-cancel, expiration policy, audit-trail scope, notification channel — were resolved in dialogue and captured in Key Decisions and Requirements above. The 2026-05-29 document review added no new blockers; its open items are mechanism- or UI-design-level and are deferred to planning below.)

### Deferred to Planning

- [Affects R25][Technical] Locking / isolation mechanism for the atomic transition R25 requires when two admins approve over cap simultaneously. A transactional read of `issuedCount` at decision time plus the audit-row write inside the same transaction likely suffices; planning to confirm and pick an isolation level.
- [Affects R3][Technical] Response shape for the paid-purchase endpoint when capacity is hit. Phase 3's endpoint returns `{ url: string }` JSON (the client follows the URL client-side); the over-cap branch needs a discriminated shape — e.g., `{ url } | { requestId, status }` — that Phase 3 callers can switch on. Planning to pick the envelope.
- [Affects R23][Technical] Mechanism for SSE connection auth — `EventSource` cannot send an `Authorization` header, so planning picks between a short-lived query-string token and a cookie-based session, and verifies NestJS `@Sse()` composes with the existing `JwtAuthGuard`. (R23 sets the required posture; this is the how.)
- [Affects R15][Needs research] SSE behavior under production proxy / load-balancer idle timeouts and HTTP/2 multiplexing. Local dev does not surface these. Planning to research before picking a heartbeat / keep-alive interval.
- [Affects R3, R25][Technical] Whether the eligibility check + cap check + `TicketRequest` insert should run as a single transaction, and what unique constraints prevent double-queuing the same user for the same TicketType in `PENDING` state.
- [Affects R7][Technical] Scheduled-job runner choice (`@nestjs/schedule` vs out-of-process), sweep interval, and idempotency (the sweep must be safe to re-run if it crashes mid-batch).
- [Affects R21, R26][Technical] Transactional-mail provider selection, queue-vs-direct-send, and bounce handling. Templating engine for the approve / reject email bodies.
- [Affects R6, R25][Technical] Race window between requester self-cancel and admin approve happening in the same second. AE10 specifies the outcome (admin gets a conflict); planning to choose the locking/version-check mechanism.
- [Affects R3, RR][Technical] Whether request creation needs a per-user / per-TicketType rate limit or a cap on concurrent `PENDING` requests, to bound the admin queue against a flood of spurious requests.

### From 2026-05-29 document review (deferred)

These four are UI-design-level decisions surfaced by the document review and best resolved during planning / implementation:

- [Affects R8, R15][Design] Admin queue interaction states beyond the happy path — SSE connecting / dropped / reconnecting, and the in-flight state of an approve or reject button between click and confirmation.
- [Affects R3, R20][Design] Copy and affordance the buyer sees at the over-cap submission moment — what the "request submitted" confirmation says, and whether queue position or expected wait is shown.
- [Affects R8][Design] Admin queue information architecture — per-row column set (requester, requested tier, intent, request time), default sort, and how rows group when an org runs several events at once.
- [Affects R13, R21][Design] Whether admin rejection supports a free-text reason that appears in the rejection email, and if so whether it is required or optional.
