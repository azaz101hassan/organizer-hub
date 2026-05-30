---
title: "Query-token SSE auth: single-use opaque tokens for EventSource"
date: 2026-05-30
category: architecture-patterns
module: realtime
problem_type: architecture_pattern
component: service_object
severity: medium
applies_when:
  - You need to authenticate a browser EventSource (SSE) connection
  - The API uses bearer-token auth (JWT) that relies on the Authorization header
  - You need mid-stream authorization revocation (e.g. a demoted admin must lose access)
  - The app runs on a single instance (the in-memory token store is not shared)
tags: [sse, eventsource, query-token, opaque-token, single-use, realtime, nestjs]
---

# Query-token SSE auth: single-use opaque tokens for EventSource

## Context

The browser `EventSource` API provides no mechanism to set custom HTTP headers. When your API authenticates via `Authorization: Bearer <jwt>`, you cannot pass the JWT to an SSE endpoint using the standard auth flow. The common workaround — stuffing the JWT into a query parameter — creates replay and log-leakage risks because JWTs are long-lived, signed, and accepted by every guarded endpoint. A leaked `?token=<jwt>` URL in server logs, referrer headers, or browser history becomes a full session credential.

## Guidance

Mint a **single-use, opaque, short-lived query token** specifically for the SSE connection. The token is 256 bits of cryptographic randomness stored only in an in-memory Map (60s TTL, 1000-entry FIFO cap). It is minted by an authenticated, role-gated, throttled POST endpoint and burned on first use. Because it is opaque (not a JWT — no dots, no signature, no claims), it structurally cannot be replayed against `JwtAuthGuard`.

**Three-layer architecture:**

1. **Token Service** — mint and verify-and-burn in an in-memory Map with insertion-order FIFO eviction:

```typescript
mint(userId: string, orgId: string): string {
  this.evictExpired();
  while (this.tokens.size >= MAX_TOKENS) {
    this.tokens.delete(this.oldestKey()!);
  }
  const token = randomBytes(32).toString('hex');
  this.tokens.set(token, { userId, orgId, expiresAt: Date.now() + TTL_MS });
  return token;
}

verifyAndBurn(token: string): { userId: string; orgId: string } | null {
  const entry = this.tokens.get(token);
  if (!entry) return null;
  this.tokens.delete(token);  // delete before checking expiry
  if (entry.expiresAt < Date.now()) return null;
  return { userId: entry.userId, orgId: entry.orgId };
}
```

2. **Stream Token Guard** — NestJS `CanActivate` that extracts `?token=`, burns it, and cross-checks the bound `orgId` against `:orgId`. A token minted for org A cannot tap org B's stream.

3. **Controller** — two endpoints on the same route prefix:
   - `POST stream-token`: `JwtAuthGuard` + `RolesGuard` (OWNER/ADMIN) + `ThrottlerGuard` (10/min)
   - `@Sse stream`: `SseStreamTokenGuard` + `@Header('X-Accel-Buffering', 'no')` + 90s max-lifetime via `takeUntil(timer(90_000))`

**Client-side reconnect:** Because the token is single-use, native `EventSource` auto-reconnect (which replays the same URL) always fails. The client must close the dead `EventSource`, re-mint via the POST endpoint (which re-runs `JwtAuthGuard` + `RolesGuard`), and open a new connection. This is also the mechanism that enforces mid-stream authorization revocation: a demoted admin's reconnect is denied at the mint step.

## Why This Matters

1. **Structural replay isolation:** 64 hex chars with no dots is structurally not a JWS. `JwtAuthGuard` will never accept it — not a policy check, a format-level impossibility.
2. **Single-use eliminates replay:** Deleted from the Map on first lookup. A second presentation always returns null.
3. **Bounded authorization lag:** The 90s max-stream-lifetime means a demoted admin's stream dies within 90s. Reconnect requires re-mint through the `RolesGuard`-gated endpoint, which now denies them.
4. **Cross-org isolation:** The token binds `orgId` at mint time; the guard cross-checks it against `:orgId`.
5. **Memory safety:** 1000-entry FIFO cap + 60s TTL eviction prevent unbounded growth.

## When to Apply

- Adding SSE to an app that authenticates via the Authorization header
- The SSE connection must be scoped to a specific resource (org, tenant, room)
- Authorization changes must take effect on existing streams within a bounded window
- Single-instance deployment (for multi-instance, swap the Map for Redis with TTL keys)
- You want to avoid WebSocket complexity but still need authenticated server-push

**Do not apply when:** you can use WebSockets with an auth handshake, the SSE endpoint is public, or you're already multi-instance without a shared token store.

## Examples

| File | Role |
|---|---|
| `apps/api/src/realtime/sse-token.service.ts` | Mint + verify-and-burn (in-memory Map) |
| `apps/api/src/realtime/sse-stream-token.guard.ts` | Guard: extract `?token=`, burn, cross-check orgId |
| `apps/api/src/realtime/sse.controller.ts` | `POST stream-token` + `@Sse stream` (90s max lifetime) |
| `apps/api/src/realtime/waitlist-stream.ts` | Per-org emit hub with 25s heartbeat |
| `apps/api/src/realtime/sse-token.service.spec.ts` | Tests: opaque format, single-use, FIFO eviction |
| `apps/web/.../requests/WaitlistQueue.tsx` | Client: EventSource + custom reconnect with re-mint |

**Security invariants to preserve:**
- Token MUST be `randomBytes(32)` (256 bits) — do not downgrade entropy
- `verifyAndBurn` MUST delete before checking expiry
- Guard MUST cross-check `claims.orgId !== req.params.orgId`
- `ThrottlerGuard` MUST be in `@UseGuards()`, not just `@Throttle()` (the decorator alone is inert)
- 90s max lifetime MUST use `takeUntil(timer(...))`, not a connection-level timeout

## Related

- Phase 4 commits U4 (`0447d41`) and U14 (`15ed61b`)
- `docs/phase-4-setup.md` — SSE production posture (proxy config, token log redaction, single-instance scale-up)
- `docs/solutions/billing/nestjs-stripe-testing-seam.md` — the DI seam pattern this extends to the realtime module
