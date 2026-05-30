# Phase 4 — Browser smoke checklist

Drive this manually after `pnpm dev` is running and the three services
are healthy on ports 3000 (web), 3001 (api), and 3002 (accounts), plus
the Stripe CLI is forwarding webhooks to the local api.

Phase 4 layers a **capacity cap → waitlist** flow on top of Phase 3:
once a ticket type is at cap, purchases and claims become *requests*
that an organizer approves or rejects, approvals fan out transactional
email (Resend), and the admin queue updates **live over SSE**. This
checklist is the frontend verification gate — there are no automated web
tests for Phase 4.

See `docs/phase-4-setup.md` for the Resend account + DNS configuration
and the SSE / scheduler production posture. Phase 3 Stripe setup
(`docs/phase-3-stripe-setup.md`) still applies — paid waitlist approvals
go through the same Checkout + webhook path.

## Pre-flight

- [ ] Phase 3 pre-flight is green (see `docs/phase-3-browser-smoke.md`):
      both DBs migrated, `seed:api` has run, Stripe test keys in `.env`,
      six Prices exist.
- [ ] `pnpm --filter @organizer-hub/db migrate:api:dev` has been run on a
      tree that includes the Phase 4 migrations — confirm the partial
      unique index exists:
      `psql organizer_db -c "\d ticket_requests"` lists
      `ticket_requests_one_open_per_user_type`. (The api boot guard
      `open-request-index.ts` aborts startup if it is missing.)
- [ ] `stripe listen --forward-to http://localhost:3001/webhooks/stripe`
      is running. `stripe listen` forwards **all** test events, so the
      new `checkout.session.expired` event is covered with no extra
      config. (A production endpoint must add it explicitly — see the
      setup doc.)
- [ ] Email seam: `RESEND_API_KEY` may be left blank locally — the
      Mailer logs `RESEND_API_KEY not set …` at boot and **skips
      delivery** (commit-then-send is best-effort and never blocks the
      response). To actually see mail, set a Resend test key and a
      `MAIL_FROM` of `OrganizerHub <onboarding@resend.dev>`.
- [ ] `WEB_ORIGIN=http://localhost:3000` is set — the Mailer validates it
      as an absolute http(s) URL at boot and **throws** if missing or
      malformed (email deep-links must never be relative/broken). If the
      api refuses to start, this is the first thing to check.
- [ ] `pnpm dev` is up with no errors; the api log shows `Nest
      application successfully started`.
- [ ] Optional clean slate:
      `psql organizer_db -c "delete from ticket_requests; delete from
      tickets; delete from refund_logs;"`.

## Set up an at-cap ticket type (organizer)

1. [ ] Sign in to `http://localhost:3000` as the OWNER. Open a published
       event and go to **Manage ticket types →**.
2. [ ] Add a `GA` tier at `25.00`, coverage **Open — anyone can buy**,
       and set the **Capacity** field to `1`. The hint reads "Leave blank
       for no cap. At capacity, buyers and members join a waitlist you
       approve." Row appears.
3. [ ] (For the free-claim leg later) Add a `Member` tier at `0.00` with
       coverage **Bronze or higher** and **Capacity** `1`.
4. [ ] Reach cap on `GA`: in an incognito window as a different signed-in
       user, open the public event `/events/<eventId>` and **Buy $25.00**
       on `GA`; pay with `4242 4242 4242 4242`. After the webhook lands,
       `psql organizer_db -c "select count(*) from tickets where
       source='PAID';"` is `1` — `GA` is now at cap (1/1).

## Requester: request a spot (at cap)

5. [ ] As a **third** signed-in user (no ticket yet), open
       `/events/<eventId>`. The `GA` row now shows an amber **Request a
       spot** button instead of Buy (verdict `AT_CAP`). Click it — the
       button shows **Requesting…**, then an inline amber note appears:
       "Request submitted — we'll email you when the organizer responds.
       Track it in your requests." and the control becomes a
       **Requested** pill.
6. [ ] Reload `/events/<eventId>`. The `GA` row now renders a **Request
       pending** link (the open request is detected via the coverage
       call's `openRequestId`).
7. [ ] Visit `/dashboard/requests`. The new request is listed as
       **Pending**. Open it — the detail page reads "Your request is in
       the organizer's queue. We'll email you when they respond." with a
       **Cancel request** button.
8. [ ] `psql organizer_db -c "select status, intent from ticket_requests
       order by created_at desc limit 1;"` returns `PENDING | PAID`.

## Two-tab live SSE check (the core Phase 4 realtime gate)

9. [ ] **Tab A** (OWNER/ADMIN): open
       `/dashboard/organizations/<orgId>/requests`. The waitlist queue
       lists the pending request grouped under its event title, and the
       connection indicator reads **● Live** (green dot). The page minted
       a single-use stream token server-side and opened
       `…/orgs/<orgId>/requests/stream?token=…`.
10. [ ] **Tab B** (the requester from step 5, different browser/profile):
        submit a *second* request (e.g. on the `Member` tier, or a second
        event's at-cap tier). Within **~1 second**, Tab A's queue grows a
        new row **without a reload**, and a screen reader announces
        "Request from <name> added to the queue."
11. [ ] Still in Tab A: click **Reject** on one request. The row
        disappears immediately (optimistic drop); the matching SSE frame
        that follows is a no-op (no double announce).
12. [ ] Network-blip reconnect: in Tab A, briefly stop the api
        (`Ctrl-C` the `pnpm dev` api process or toggle network), watch
        the indicator flip to **Reconnecting…** (amber, pulsing), then
        restart. Within a few seconds it re-mints a fresh token via a
        server action and returns to **● Live** ("Queue reconnected" is
        announced). Native `EventSource` auto-reconnect cannot resume
        (the token is single-use and already burned), so the client
        re-mint path is what restores the stream.

## Admin approve — paid request → pay → ticket → email

13. [ ] In Tab A, **Approve** the pending `GA` (PAID) request. Because
        `GA` is already at cap, the button first asks **At cap (1/1) —
        confirm approve?**; click **Confirm**. The row leaves the queue.
        (Over-cap approval is intentionally allowed — the Approve issues
        an over-cap **PAID** approval; the cap is a soft cap. See the
        setup doc on why the over-cap warning is issued-count-only.)
14. [ ] As the requester, open `/dashboard/requests/<requestId>`. It now
        reads "You're approved! Complete payment to lock in your ticket."
        with a **Complete payment** button and "Payment link expires in
        …". (If `RESEND_API_KEY` is set, the requester also receives the
        **paid-approved** email with the same deep-link.)
15. [ ] Click **Complete payment** → Stripe Checkout in payment mode →
        pay `4242 4242 4242 4242`. The `stripe listen` terminal shows
        `checkout.session.completed`; the webhook re-reads the request
        row `FOR UPDATE`, confirms it is still APPROVED + the event is
        in the future, and issues the Ticket.
16. [ ] Reload the request detail page — it now reads "Approved — your
        ticket has been issued." `psql organizer_db -c "select source,
        ticket_request_id from tickets where ticket_request_id is not
        null;"` shows a `PAID` row linked to the request.

## Admin approve — free member claim → ticket → email

17. [ ] Have a Gold (or tier-qualifying) member submit a request on the
        at-cap `Member` tier (verdict `AT_CAP`, `requestIntent` =
        `MEMBERSHIP_CLAIM`). It appears in Tab A's queue tagged **Free**.
18. [ ] In Tab A, **Approve** it (confirm over-cap if prompted). A
        `MEMBERSHIP_CLAIM` Ticket is issued **immediately** — no payment
        step. The requester's detail page reads "Approved — your ticket
        has been issued." and (if Resend is live) they get the
        **claim-approved** email.
19. [ ] `psql organizer_db -c "select source from tickets where source =
        'MEMBERSHIP_CLAIM';"` returns the claimed row.

## Admin reject → email

20. [ ] In Tab A, **Reject** a remaining pending request. The row leaves
        the queue live. The requester's detail page reads "This request
        was declined by the organizer." and (if Resend is live) they
        receive the **rejected** email.

## Self-cancel (requester) — idempotent

21. [ ] Create a fresh pending request (repeat steps 5–7). On its detail
        page click **Cancel request** and accept the "Cancel this
        request?" browser confirm. The page reflects "You cancelled this
        request."; if Tab A's queue is open, the row drops live.
22. [ ] Re-trigger the cancel (browser back + click again, or re-POST):
        the operation is **idempotent** — no error, status stays
        `CANCELLED_BY_USER`, no duplicate state change.
23. [ ] `psql organizer_db -c "select status from ticket_requests where
        status='CANCELLED_BY_USER';"` shows the cancelled row.

## Auto-reject at event start (scheduler)

24. [ ] Leave a request **PENDING**, then make its event's `starts_at`
        fall in the past:
        `psql organizer_db -c "update events set starts_at = now() -
        interval '1 minute' where id = '<eventId>';"`.
25. [ ] Trigger the sweep without waiting for the 5-minute cron. Either
        wait for the next `EVERY_5_MINUTES` UTC tick, or invoke it
        directly in a REPL/script: `app.get(AutoRejectJob).run()`. The
        api log shows `Auto-rejected N request(s) (expired_at_event_start)`.
26. [ ] The request flips to `REJECTED`; if Tab A's queue is open the row
        drops live; the requester (if Resend is live) gets the
        **rejected** email (no admin reason — the scheduler is not an
        admin, and no audit row is written).

## Payment-window expiry (PAID approval left unpaid)

27. [ ] Approve a PAID request but **do not** pay. Either let the Stripe
        Checkout session lapse, or run `stripe trigger
        checkout.session.expired` for that session. The webhook CASes the
        request `APPROVED → EXPIRED` and emits (no email).
28. [ ] The requester's detail page reads "Your payment window closed
        before this request was paid." with a **Request a new spot**
        link back to `/events/<eventId>`.

## Tampered-checkout auto-refund (the one Phase 4 refund)

29. [ ] (Optional, advanced) Exercise the dead-request auto-refund: a
        paid `checkout.session.completed` that lands against a request
        that is no longer payable (cancelled/expired/rejected, event
        started, or a `client_reference_id`/metadata mismatch) is
        **auto-refunded** rather than issued. Confirm:
        - api log: `Auto-refunded dead-request payment for session …
          (reason=…)` (a `warn`-level line — the operator alert).
        - `psql organizer_db -c "select reason, amount_cents from
          refund_logs;"` shows exactly one durable row per session
          (the idempotency key collapses webhook redeliveries to one
          real refund). See `docs/phase-4-setup.md` for the monitoring
          posture.

## Role-gating sanity

30. [ ] Sign in as a non-OWNER/ADMIN org member (MEMBER role). Visiting
        `/dashboard/organizations/<orgId>/requests` must not expose the
        queue; a direct `POST …/orgs/<orgId>/requests/stream-token` with
        their token returns 403 (RolesGuard OWNER/ADMIN).
31. [ ] Mid-stream demotion: if an admin who is streaming is demoted, the
        stream self-recycles at the 90s max-lifetime ceiling; the client's
        re-mint is then denied and the queue shows "Your access has
        changed — reload the page."

## Cleanup

32. [ ] Stop `stripe listen`. Sign out from `/`.
33. [ ] (Optional) Reset Phase 4 tables:
        `psql organizer_db -c "delete from ticket_requests; delete from
        refund_logs;"` and Stripe test-mode data via the Dashboard.
