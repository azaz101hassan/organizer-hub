# Token Refresh Middleware — Design

**Date:** 2026-05-20
**Status:** Approved for implementation
**Worktree:** `worktree-token-refresh`
**Related notes:** `~/Documents/Obsidian/OrganizerHub/Auth/Token Refresh - Limitations.md`

## Problem

The web app (`apps/web`) stores `refresh_token` and `session` (id_token) cookies after sign-in, but nothing exchanges the refresh_token. When the id_token expires (1 hour), the user appears signed-out on the next request even though their IdP session is still valid. This forces an unnecessary re-login.

## Goal

Keep an authenticated user's web session alive transparently across id_token expirations, using the refresh_token issued at sign-in, for as long as the refresh_token is valid (14 days). Failure of refresh must degrade gracefully to the signed-out state without surprising redirects.

## Non-goals

- Verifying the id_token signature against JWKS (separate task; see Limitation #2 in the Obsidian note).
- Building a session store. Cookies remain the source of truth in Phase 1.
- Wiring the web app to call the API with the access_token. The access_token will be stored so it is available, but no API calls are introduced here.
- UI changes (toasts, banners, redirects on expiry).

## Architecture

A Next.js middleware (`apps/web/src/middleware.ts`) runs on every page request in the configured matcher. It inspects the `session` cookie's `exp` claim and, when within a 60-second skew window of expiry, exchanges the `refresh_token` at the IdP's `/oidc/token` endpoint and rotates the three auth cookies on the outgoing response. On refresh failure, the three cookies are cleared and the request continues — the existing Home page renders the signed-out UI when no session is present.

## Components

### 1. `apps/web/src/middleware.ts` (new)

Entry point for Next.js middleware. Responsibilities, in order:

1. Read `session` cookie. If missing, return `NextResponse.next()` unchanged.
2. Decode the id_token using `jose.decodeJwt` (no signature verification — see Non-goals). On decode error, clear all three auth cookies and return `next()`.
3. Compute `secondsUntilExpiry = (claims.exp ?? 0) - nowSeconds()`. If greater than `SKEW_SECONDS` (60), return `next()` unchanged.
4. If the `refresh_token` cookie is missing, clear all three auth cookies and return `next()`.
5. Call `refreshTokens(refreshToken)`. On `null` (any failure), clear cookies and return `next()`.
6. On success, build a `NextResponse.next()`, set the three rotated cookies on it (see Cookie contract below), return it.

Exports a `config.matcher` array — see Matcher section.

### 2. `apps/web/src/lib/oidc/refresh.ts` (new)

Pure server-side helper. Signature:

```ts
export interface TokenResponse {
  access_token: string;
  id_token: string;
  refresh_token?: string;
  token_type: "Bearer";
  expires_in: number;
  scope?: string;
}

export async function refreshTokens(refreshToken: string): Promise<TokenResponse | null>;
```

POSTs `application/x-www-form-urlencoded` to `oidcEndpoints.token` with body:

```
grant_type=refresh_token
refresh_token=<refreshToken>
client_id=<oidcConfig.clientId>
```

Returns the parsed JSON on `2xx`, `null` on any non-2xx or fetch exception. No side effects (no cookie writes — the caller handles those).

### 3. `apps/web/src/app/auth/callback/route.ts` (modify)

Currently stores only `session` (id_token) and `refresh_token`. Add an `access_token` cookie with the same `httpOnly`, `path`, `sameSite`, and `maxAge: tokens.expires_in` options. This makes the cookie contract uniform — sign-in writes all three, middleware rotates all three.

## Data flow

```
Browser → page request
   │
   ▼
Next.js middleware (apps/web/src/middleware.ts)
   │
   ├── no `session` cookie         ──► NextResponse.next()  (unauthenticated)
   │
   ├── session valid (>60s left)   ──► NextResponse.next()  (no rotation)
   │
   └── session expiring or expired:
        POST ${issuer}/oidc/token  grant_type=refresh_token
          │
          ├── 2xx ──► set new session, access_token, refresh_token cookies
          │          on NextResponse.next(); continue
          │
          └── non-2xx / fetch error / no refresh_token cookie ──►
                     clear session, access_token, refresh_token
                     on NextResponse.next(); continue (renders signed-out)
```

## Matcher

```ts
export const config = {
  matcher: ["/((?!_next|api|auth|favicon|.*\\.).*)"],
};
```

Excludes:
- `_next/*` — Next.js internals and assets
- `api/*` — Next.js route handlers (none today; reserved)
- `auth/*` — `login`, `callback`, `logout` routes have their own cookie semantics and **must not** be intercepted
- `favicon` and any path containing a dot — static files

## Cookie contract

| Cookie          | Written at sign-in | Rotated by middleware | TTL                           | Options                             |
| --------------- | ------------------ | --------------------- | ----------------------------- | ----------------------------------- |
| `session`       | ✅ (already)       | ✅                    | `tokens.expires_in` (≈1h)     | `httpOnly`, `path=/`, `sameSite=lax` |
| `access_token`  | ⏳ (added here)    | ✅                    | `tokens.expires_in` (≈1h)     | `httpOnly`, `path=/`, `sameSite=lax` |
| `refresh_token` | ✅ (already)       | ✅ (when IdP rotates) | 14 days                       | `httpOnly`, `path=/`, `sameSite=lax` |

`oidc-provider` rotates refresh tokens by default; the response may include a new `refresh_token`. The middleware always overwrites if present, leaves the existing cookie untouched if absent.

## Error handling

| Condition                                      | Response                                                          |
| ---------------------------------------------- | ----------------------------------------------------------------- |
| No `session` cookie                            | Pass through, no work                                              |
| Malformed id_token (decode throws)             | Clear all three cookies, pass through                              |
| `session` valid (>60s left)                    | Pass through, no work                                              |
| `session` expiring, no `refresh_token` cookie  | Clear all three cookies, pass through                              |
| `session` expiring, IdP returns non-2xx        | Clear all three cookies, pass through                              |
| `session` expiring, fetch throws (network)     | Clear all three cookies, pass through                              |
| `session` expiring, IdP returns 2xx            | Set rotated cookies on response, pass through                      |

No request is ever blocked or redirected by the middleware. The signed-out UI on the Home page is the user-visible signal that refresh failed.

## Testing plan

### Manual happy path

1. In `apps/accounts/src/oidc/oidc.service.ts`, temporarily set `accessTokenTTL: 60` in `resourceIndicators.getResourceServerInfo`. Restart accounts.
2. Sign in via the web flow.
3. Wait ~30 seconds (within the 60s skew window).
4. Reload the home page.
5. Observe in DevTools Application → Cookies: `session`, `access_token`, and `refresh_token` values have changed (rotated).
6. Page still shows "Signed in as ...".
7. Revert the `accessTokenTTL` change.

### Manual failure path

1. Sign in.
2. In the accounts DB: `DELETE FROM oidc_payloads WHERE type = 'RefreshToken';`
3. Reload the home page after the skew window kicks in (or temporarily lower TTL as above).
4. Observe cookies cleared and "Sign in" button visible.

### Automated tests

Out of scope for this spec — the project has no e2e harness for `apps/web` yet. Adding one is a separate initiative.

## Known limitations

Tracked in `~/Documents/Obsidian/OrganizerHub/Auth/Token Refresh - Limitations.md`:

1. Refresh token rotation race under parallel SSR requests.
2. No JWKS signature verification on id_token decode.
3. Silent refresh failure (no UI signal beyond the signed-out page).

All three are accepted Phase-1 trade-offs with documented Phase-2 mitigation paths.

## Out-of-scope work surfaced during design

- API access using the `access_token` — captured but not implemented; we just store the token.
- JWKS verification — separate task.
- Toast/banner UX for expiry — deferred until telemetry shows it is needed.

## Open questions

None. All design decisions confirmed on 2026-05-20.
