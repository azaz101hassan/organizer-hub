# Phase 3 — Browser smoke checklist

Drive this manually after `pnpm dev` is running and the three services
are healthy on ports 3000 (web), 3001 (api), and 3002 (accounts), plus
the Stripe CLI is forwarding webhooks to the local api.

See `docs/phase-3-stripe-setup.md` for the Stripe Dashboard configuration
(six Prices with `lookup_key`s, the "Limit customers to one subscription"
toggle, webhook endpoint setup, secret rotation procedure).

## Pre-flight

- [ ] `pnpm --filter @organizer-hub/db migrate:accounts:dev` has been run.
- [ ] `pnpm --filter @organizer-hub/db migrate:api:dev` has been run.
- [ ] `pnpm --filter @organizer-hub/db seed:api` has run on a fresh DB —
      six `membership_plans` rows exist (`psql organizer_db -c "select
      lookup_key, tier_level from membership_plans order by tier_level;"`).
- [ ] Stripe CLI installed and authenticated: `stripe login`.
- [ ] Six Stripe Prices exist in Test mode with the matching
      `lookup_key`s from the setup doc.
- [ ] `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY` (test mode) are
      set in `.env`.
- [ ] `stripe listen --forward-to http://localhost:3001/webhooks/stripe`
      is running in its own terminal. Copy the printed `whsec_…` into
      `.env` as `STRIPE_WEBHOOK_SECRET` and restart `pnpm dev`.
- [ ] `pnpm dev` is up; no errors in the terminal for any of the three
      apps. The api logs show `Nest application successfully started`
      and the `stripe listen` terminal prints `Ready! Your webhook
      signing secret is whsec_…`.
- [ ] Optional clean slate: `psql organizer_db -c "delete from tickets;
      delete from ticket_types; delete from memberships; delete from
      billing_customers; delete from webhook_events;"`.

## Organizer happy path

1. [ ] Sign in to `http://localhost:3000` as the OWNER from the Phase 2
       smoke checklist (or create a fresh `owner@test.com`).
2. [ ] Open a published event from `/dashboard/organizations/<id>` (or
       create + publish one per the Phase 2 checklist).
3. [ ] On the event edit page, scroll to the **Ticket types** section
       and click **Manage ticket types →**. Empty-state message renders
       with the Add ticket type form below.
4. [ ] Add a `GA` tier at `25.00`, coverage **Open — anyone can buy**.
       Row appears with `$25.00 · Open to anyone`.
5. [ ] Add a `Member` tier at `50.00`, coverage **Bronze or higher**.
       Row appears with `Bronze+ claim free`.
6. [ ] Add a `VIP` tier at `200.00`, coverage **Gold**. Row appears
       with `Gold claim free`.
7. [ ] Edit `Member` — change name to `Premium`, save. Row reflects
       the new name; Stripe Dashboard shows the old Price archived and
       a new Price live (price unchanged so no new Price was created).
8. [ ] Edit `Premium` — change price to `60.00`, save. Stripe Dashboard
       shows a new Price live and the previous active Price archived
       (`active=false`).
9. [ ] Try to add a free ticket gated to a tier (`name: Bug`, price
       `0.00`, coverage **Gold**). Form rejects with "Free tickets
       cannot also gate by membership tier."
10. [ ] Click **Delete** on `VIP`. Button label flips to **Confirm
        delete?**; click again to confirm. Row disappears. The Stripe
        Product is archived in the Dashboard.
11. [ ] Return to the event edit page. Toggle **Exclude this event from
        membership coverage** on and save. The status banner on the
        ticket-types page now reads "Members are excluded from this
        event — every tier sells as paid only."
12. [ ] Toggle the exclusion back off and save.

## Member happy path (subscription → claim → buy)

13. [ ] In an incognito window, sign in (or sign up) as
        `member@test.com`. Visit `/membership`. All six plans render.
14. [ ] Click **Subscribe Gold / monthly**. Stripe Checkout opens. Pay
        with `4242 4242 4242 4242`, any future expiry, any CVC.
15. [ ] Land on `/membership/success`. After a moment (webhook should
        arrive in <2s), the page reads "Welcome to Gold." The `stripe
        listen` terminal shows `customer.subscription.created` and
        `checkout.session.completed`; `psql organizer_db -c "select
        tier, status from memberships;"` returns `GOLD | ACTIVE`.
16. [ ] Visit the public URL of the published event from step 2,
        `/events/<id>`. The **GA** row shows a blue **Buy $25.00**
        button; **Premium** shows a green **Claim free ticket** button.
17. [ ] Click **Claim free ticket** on **Premium**. The button rerenders
        as the green pill **Ticket claimed**. `psql organizer_db -c
        "select source from tickets;"` returns `MEMBERSHIP_CLAIM`.
18. [ ] Click **Buy $25.00** on **GA**. Stripe Checkout opens in
        payment mode. Pay with `4242 4242 4242 4242`. Land back on
        `/events/<id>`. Refresh — **GA** now shows **Ticket claimed**.
        `psql organizer_db -c "select source, stripe_payment_intent_id
        from tickets order by issued_at;"` shows the second row as
        `PAID` with a `pi_…` value.

## Failure paths

19. [ ] As the same member, click **Claim free ticket** on **Premium**
        again (browser back to before claim, or open in a new tab).
        Inline error appears: "Coverage changed — refresh to see updated
        options."
20. [ ] As the member, visit `/dashboard/membership` and click
        **Cancel membership**. Status updates to "Canceling on <date>".
        The previously issued tickets remain — confirm via `psql
        organizer_db -c "select source, event_id from tickets;"`.
21. [ ] In a terminal: `stripe trigger checkout.session.completed`. The
        api receives the event; `psql organizer_db -c "select count(*)
        from webhook_events;"` increments by one. Re-fire the same
        trigger — duplicate dedupe kicks in (count does NOT increment
        a second time for the redelivered event ID).
22. [ ] Hand-craft a bad signature:
        `curl -X POST http://localhost:3001/webhooks/stripe -H
        "Stripe-Signature: t=123,v1=garbage" -H "Content-Type:
        application/json" -d '{}'`. Response is `400`. No new
        `webhook_events` row.
23. [ ] (Optional, requires test-clock setup) Fast-forward Stripe to
        the cancellation date. `stripe listen` shows
        `customer.subscription.deleted`; the `Membership` row status
        flips to `CANCELED`; issued tickets persist.

## Role-gating sanity

24. [ ] Sign in as a non-OWNER/ADMIN org member (MEMBER role). Visit
        the same event's ticket-types page. The Add ticket type form is
        hidden; existing rows show the labels only — no Edit / Delete
        buttons. Direct `POST /organizations/:orgId/events/:eventId/
        ticket-types` with their token returns 403.
25. [ ] Visit `/events/<draft-or-cancelled-id>` while signed in as the
        member. 404 page (no enumeration of unpublished events).

## Cleanup

26. [ ] Stop `stripe listen`. Sign out from `/`.
27. [ ] (Optional) Reset Stripe test-mode data via the Dashboard if
        you want a clean slate for the next run.
