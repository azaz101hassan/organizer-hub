# Phase 2 — Browser smoke checklist

Drive this manually after `pnpm dev` is running and the three services
are healthy on ports 3000 (web), 3001 (api), and 3002 (accounts).

## Pre-flight

- [ ] `pnpm --filter @organizer-hub/db migrate:accounts:dev` has been run.
- [ ] `pnpm --filter @organizer-hub/db migrate:api:dev` has been run.
- [ ] `pnpm dev` is up; no errors in the terminal for any of the three apps.
- [ ] Optional clean slate: `psql accounts_db -c "DELETE FROM users;"` and
      `psql organizer_db -c "DELETE FROM organizations;"`.

## Organizer happy path

1. [ ] Visit `http://localhost:3000`. The landing card shows a Sign in
       button and a Browse events link.
2. [ ] Click Sign in. The accounts IdP shows the signup/login form.
       Create `owner@test.com`. You are redirected back to `/`.
3. [ ] The landing card now shows you are signed in plus Dashboard and
       Sign out buttons.
4. [ ] Open `/dashboard`. Empty state appears with a Create your first
       organization CTA.
5. [ ] Click the CTA. Submit `Acme Events` with no description. You
       land on `/dashboard/organizations/<id>` with an empty events
       section and a New event button.
6. [ ] Create an event: title `Spring Gala`, startsAt a few days in the
       future, no other fields. You land on the edit page with status
       DRAFT.
7. [ ] Edit the title to `Spring Gala 2026`, save. The success banner
       appears; navigating back to the org shows the new title.
8. [ ] Publish the event. Status flips to PUBLISHED, the public URL
       shows under the title, and the org page shows the badge change.

## Public path (anonymous)

9.  [ ] Open a private/incognito window. Visit `/events`. The published
        event appears with its organization name and start time.
10. [ ] Click through to `/events/<id>`. Title, host, dates, and the
        coming-soon Get tickets button render.
11. [ ] Visit `/events/<draft-or-cancelled-id>` directly. 404 page.
12. [ ] Visit `/dashboard` directly while anonymous. You are redirected
        to `/auth/login`.

## Role-gating sanity

13. [ ] Create a second user `member@test.com` (sign out, sign up
        fresh). They land on `/dashboard` with an empty state — they
        do not see the first user's org.
14. [ ] (Optional) Insert a MEMBER membership for `member@test.com`
        directly in `organizer_db` (see `docs/plans/...`). The dashboard
        now shows the org. The New event button is hidden for them, and
        attempting `POST /organizations/:orgId/events` with their token
        returns 403.

## Status workflow

15. [ ] Cancel a published event from the edit page. Status flips to
        CANCELLED; the buttons collapse to a "cannot be reactivated"
        message; the event disappears from `/events`.

## Cleanup

16. [ ] Sign out from the home page; both the local cookie and the IdP
        session clear.
