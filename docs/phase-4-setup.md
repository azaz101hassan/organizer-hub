# Phase 4 — Setup & operations

Phase 4 adds two pieces of infrastructure beyond the Phase 3 Stripe
integration: **transactional email** (Resend) for waitlist approval /
rejection notices, and a **live admin queue over Server-Sent Events**
(SSE) backed by an in-process emit hub plus a scheduled auto-reject job.
This doc covers the account + DNS setup email needs, the proxy/runtime
posture SSE needs in production, and the single-instance operational
constraints both the scheduler and the SSE token store carry — with the
documented scale-ups for each.

Phase 3's `docs/phase-3-stripe-setup.md` still applies in full: paid
waitlist approvals reuse the same Checkout + signed-webhook path.

## Transactional email (Resend)

The Mailer (`apps/api/src/mail/mailer.ts`) sits behind a `RESEND_CLIENT`
seam and sends three templates — `paid-approved`, `claim-approved`,
`rejected` — **after** the corresponding DB transition commits. It is
best-effort: a delivery failure is logged, never thrown, so it can never
block or roll back an HTTP response or a scheduler sweep. The
`/dashboard/requests` UI is the system of record if mail is lost.

### Account + API key

1. Create a Resend account at <https://resend.com> and verify your login.
2. **API Keys → Create API Key** (a `re_…` value). Copy it into the
   deploy's `RESEND_API_KEY`. It is shown once.
3. Local dev: leave `RESEND_API_KEY` **blank**. The app boots, logs
   `RESEND_API_KEY not set — … any outbound email will fail to send`,
   and skips delivery. Set a test key only when you want to see real
   mail land.

### From address (`MAIL_FROM`)

- Format is a standard RFC 5322 address, e.g.
  `OrganizerHub <noreply@your-domain.com>`. Defaults to
  `OrganizerHub <onboarding@resend.dev>` if unset.
- Locally, Resend's `onboarding@resend.dev` sandbox sender works with no
  DNS. In production you **must** send from a domain you have verified in
  Resend (next section), or deliverability collapses.

### `WEB_ORIGIN` (hard requirement)

Approval/rejection emails embed dashboard deep-links built from
`WEB_ORIGIN`. The Mailer validates it at construction as an absolute
http(s) URL and **throws at boot** if it is missing or malformed — this
is deliberate, so a misconfigured origin fails fast instead of shipping
relative or broken hrefs to recipients. Set it to the public web origin
(e.g. `https://app.your-domain.com`), no trailing slash needed.

### DNS records for the sending domain (deepening sec-L4)

Resend's dashboard generates the exact records when you add a domain;
add all three categories at your DNS provider and wait for Resend to show
them **Verified**:

1. **SPF** — a TXT record authorizing Resend's mail servers to send for
   your domain (Resend provides the exact `include:` value).
2. **DKIM** — the CNAME/TXT key records Resend generates. DKIM signs each
   message so receivers can verify it was not tampered in transit.
3. **DMARC** — a `_dmarc` TXT record. **Start at `p=none`**
   (`v=DMARC1; p=none; rua=mailto:dmarc@your-domain.com`) so you collect
   aggregate reports without dropping any mail while SPF/DKIM alignment
   settles. Once reports confirm aligned, authenticated mail, **escalate
   to `p=quarantine` and then `p=reject`** to actually block spoofers.
   Escalating before alignment is confirmed silently sends legitimate
   mail to spam.

## SSE — admin live queue (production posture)

The consume endpoint is `@Sse('stream')` on
`apps/api/src/realtime/sse.controller.ts` at
`GET /orgs/:orgId/requests/stream`. The emit hub
(`waitlist-stream.ts`) merges a **25-second heartbeat** (`ping`) into
every connection so idle-timeout proxies don't silently close a quiet
stream, and the controller sets **`X-Accel-Buffering: no`** so buffering
proxies flush each event immediately. Both are in code; the rest is
deployment configuration.

### Reverse proxy (nginx example)

A buffering or short-timeout proxy is the classic way SSE "works in dev,
dies in prod." For the stream location specifically:

```nginx
location /orgs/ {
    proxy_pass              http://api_upstream;
    proxy_http_version      1.1;
    proxy_set_header        Connection "";   # keep upstream alive
    proxy_buffering         off;             # don't buffer SSE frames
    proxy_cache             off;
    proxy_read_timeout      3600s;           # > heartbeat, so no idle close
    chunked_transfer_encoding on;
}
```

- `proxy_buffering off` is the counterpart to the app's
  `X-Accel-Buffering: no` — either alone is insufficient behind some
  configurations; set both.
- `proxy_read_timeout` must comfortably exceed the 25s heartbeat
  interval (the example uses 1h) so the proxy never idle-closes a healthy
  stream between heartbeats.
- Prefer **HTTP/2** end-to-end: it multiplexes the long-lived SSE stream
  over a single connection instead of consuming one of the browser's
  per-host HTTP/1.1 connections.

### Redact the query token from logs (deepening sec-M4)

`EventSource` cannot send an `Authorization` header, so the stream is
authenticated by a single-use token passed as `?token=…`. That token is
opaque, single-use, and ~60s-lived (see below), but it should still
never be persisted in plaintext. **Redact `?token=` from proxy and
application access logs.** For nginx, log a sanitized URI rather than the
raw request line, e.g.:

```nginx
map $request_uri $loggable_uri {
    ~^(?<path>[^?]*)  $path;   # drop the query string entirely
    default           $request_uri;
}
access_log /var/log/nginx/access.log combined_with_loggable_uri;
```

(or any equivalent that strips the query string for the `/stream`
route). The same applies to any APM/request-logging middleware.

### SSE auth model (why the token is safe)

`SseTokenService` mints 256 bits of randomness
(`randomBytes(32).toString('hex')`), holds it **only in memory**, with a
**60-second TTL** and a 1000-entry FIFO cap. It is minted **only** by the
authenticated, role-gated, throttled `POST …/requests/stream-token`
(JwtAuthGuard + RolesGuard `OWNER`/`ADMIN` + ThrottlerGuard 10/min) and
**burned on first use**. Because it is opaque — not a JWT and carries no
signature — it can never be replayed against `JwtAuthGuard` (which only
accepts a signed JWS for `API_AUDIENCE`). That structural separation is
the deepening sec-H1 guarantee. A stream also self-recycles at a
**90-second max-lifetime** ceiling, which bounds how long a just-demoted
admin keeps receiving the org's requester-PII payload before the client
must re-mint (and is then denied).

> We ship the **opaque-token** variant, not a JWT stream token. There is
> therefore **no `SSE_TOKEN_SECRET`** to configure — if a future change
> ever swaps in signed tokens, add that secret then.

## Single-instance posture (scheduler + SSE token store)

Two Phase 4 components hold state in a single process and assume a
**single API instance** today. Both are correct and adequate for current
scope; both have a documented scale-up before you run multiple instances.

### Scheduler (auto-reject job)

`AutoRejectJob` (`apps/api/src/scheduler/auto-reject.job.ts`) runs
`@Cron(EVERY_5_MINUTES)` in-process and sweeps `PENDING` requests whose
event has started into `REJECTED` (emailing the requester, emitting the
SSE drop). `@Cron(waitForCompletion)` plus an `isRunning` flag prevent a
tick overlapping itself *within one instance*.

- **Multi-instance consequence:** every instance would run the cron, so
  the sweep could run N times concurrently. The per-row CAS
  (`FOR UPDATE … SKIP LOCKED` + guarded `updateMany`) keeps the result
  **correct** even if doubled — the worst case is a duplicate rejection
  email, not a double state change.
- **Scale-up:** wrap the sweep in a `pg_try_advisory_lock(<constant>)`
  so exactly one instance runs it per tick (release on completion), or
  move the schedule to an external single-shot trigger.

### SSE token store

`SseTokenService` holds minted tokens in an in-memory `Map`.

- **Multi-instance consequence:** a token minted on instance A cannot be
  burned/verified on instance B. Behind a load balancer without sticky
  routing, the `stream-token` POST and the `stream` GET can land on
  different instances and the stream fails to authenticate (the client
  simply retries, but it can wedge).
- **Scale-up:** move the token store to a **shared backend** (e.g. Redis
  with a 60s TTL key per token) so any instance can verify-and-burn, or
  pin both requests to one instance with sticky sessions.

## Capacity cap is a *soft* cap (over-cap approvals)

The `TicketType.cap` is a soft cap: at cap, purchases/claims become
waitlist requests, but an organizer **may still approve over the cap**
(the admin UI prompts "At cap (n/cap) — confirm approve?" and proceeds on
confirm). There is intentionally **no hard enforcement** that issued
tickets stay ≤ cap.

Operational consequence (deepening): the over-cap signal the system
exposes is **issued-count-only** — the admin sees `issuedCount` vs `cap`
at decision time and the moderation audit row records the count
before/after, but nothing blocks or auto-reconciles an over-issue. If you
need a hard cap, that is a future change (a counted, locked check at
issue time); today the operator is the backstop, and the count is what
they watch.

## The one Phase 4 auto-refund (and what to monitor) — deepening sec-H2 / C2

Phase 4 issues tickets but, like Phase 3, does not add a general refund
flow. It adds exactly **one** automatic refund: when a paid
`checkout.session.completed` webhook lands against a **dead request** —
one that is no longer payable (cancelled / rejected / expired, event
already started) or whose `client_reference_id`/metadata does not match
the request — the handler refunds the charge instead of issuing a
ticket. The money was taken for a ticket that can no longer be honored,
so it is returned.

How it is made safe (`refundDeadRequest` in
`apps/api/src/webhooks/stripe-webhook.service.ts`):

- **Commit-then-refund**, idempotency-keyed
  `waitlist-refund-${sessionId}` → at most one *real* refund across
  Stripe webhook redeliveries.
- A **durable `RefundLog` row**, UPSERTed on the unique
  `stripeCheckoutSessionId` → exactly one record per session even under
  redelivery, carrying the `reason` and `amountCents`.

What the operator should monitor:

- **Alert on the log line** `Auto-refunded dead-request payment for
  session … (reason=…)` — it is emitted at **`warn`** level precisely so
  it is alert-worthy. A spike means requests are dying between approval
  and payment (or someone is tampering with checkout metadata).
- **Watch the `refund_logs` table** as the durable record:
  `select reason, count(*) from refund_logs group by reason;`. Each row
  is a customer who paid and was refunded — reconcile against Stripe and,
  for a real product, follow up with the affected requester.
- Also watch `Auto-refund failed for session …` (a separate `error`
  line): the refund API call itself failed and needs manual action in
  the Stripe Dashboard.

## Environment variables (Phase 4 additions)

| Var | Required | Notes |
|-----|----------|-------|
| `RESEND_API_KEY` | prod only | Blank locally → mail is logged + skipped. |
| `MAIL_FROM` | recommended | Verified-domain sender in prod; `onboarding@resend.dev` locally. |
| `WEB_ORIGIN` | **yes** | Absolute http(s) origin; Mailer throws at boot if missing/malformed. |
| `NEXT_PUBLIC_API_URL` | yes | Web builds the SSE `…/stream` URL from it (defaults to `http://localhost:3001`). |

There is no `SSE_TOKEN_SECRET` — the shipped stream token is opaque, not
signed. See `.env.example` for the full annotated list.
