# Token Refresh Middleware Implementation Plan

**Goal:** Keep an authenticated web session alive across id_token expirations by exchanging the refresh_token in Next.js middleware, transparent to pages.

**Architecture:** A Next.js middleware decodes the `session` cookie's id_token, and within a 60-second skew window of expiry, exchanges the `refresh_token` at the IdP's `/oidc/token` endpoint and rotates `session` / `access_token` / `refresh_token` cookies on the outgoing response. On any failure, all three cookies are cleared and the request continues — the Home page renders its signed-out UI.

**Tech Stack:** Next.js 15 middleware (Edge runtime), `jose` for JWT decoding, native `fetch` for the token exchange, `NextRequest`/`NextResponse` cookie API.

**Spec:** `docs/specs/2026-05-20-token-refresh-middleware-design.md`

---

## Testing approach

The web app has no test harness (no vitest/jest/playwright). The spec explicitly declared automated tests out of scope. Verification per task uses **typecheck + lint** as the static gate, and **manual browser flow** for the end-to-end happy and failure paths. Standing up a test runner is a separate initiative — do not add one here.

## File structure

| Path | Status | Responsibility |
|------|--------|----------------|
| `apps/web/src/lib/oidc/refresh.ts` | new | Server-only helper: POST `grant_type=refresh_token` to IdP, return token payload or `null`. Pure — no cookie writes. |
| `apps/web/src/middleware.ts` | new | Next.js middleware entry: decode session cookie, decide on refresh, write cookies on response. |
| `apps/web/src/app/auth/callback/route.ts` | modify | Persist `access_token` cookie at sign-in alongside the existing `session` and `refresh_token`. |

---

## Task 1: Add the `refreshTokens` helper

**Files:**
- Create: `apps/web/src/lib/oidc/refresh.ts`

- [ ] **Step 1: Create the helper file with the exact content below**

```ts
// apps/web/src/lib/oidc/refresh.ts
//
// Server-only. POSTs grant_type=refresh_token to the IdP and returns the new
// token set. Returns null on any non-2xx or fetch failure — the caller decides
// what to do (typically clear cookies and continue).
import { oidcConfig, oidcEndpoints } from "@/lib/oidc/config";

export interface TokenResponse {
  access_token: string;
  id_token: string;
  refresh_token?: string;
  token_type: "Bearer";
  expires_in: number;
  scope?: string;
}

export async function refreshTokens(
  refreshToken: string,
): Promise<TokenResponse | null> {
  try {
    const res = await fetch(oidcEndpoints.token, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: oidcConfig.clientId,
      }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as TokenResponse;
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @organizer-hub/web typecheck
```

Expected: exits 0, no errors.

- [ ] **Step 3: Lint**

```bash
pnpm --filter @organizer-hub/web lint
```

Expected: exits 0, no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/oidc/refresh.ts
git commit -m "feat(web): add refreshTokens helper for OIDC token rotation"
```

---

## Task 2: Persist `access_token` cookie on sign-in

**Files:**
- Modify: `apps/web/src/app/auth/callback/route.ts`

- [ ] **Step 1: Read the file**

Open `apps/web/src/app/auth/callback/route.ts` to confirm current state.

- [ ] **Step 2: Add the `access_token` cookie after the `session` cookie write**

Find the block:

```ts
  const res = NextResponse.redirect(new URL("/", req.url));
  // Phase 1 MVP: stash id_token in an httpOnly cookie. Phase 2 will move to a
  // server-side session store and verify signature against JWKS on each read.
  res.cookies.set("session", tokens.id_token, {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    maxAge: tokens.expires_in ?? 3600,
  });
```

Add immediately after the closing brace of the `session` cookie set:

```ts
  res.cookies.set("access_token", tokens.access_token, {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    maxAge: tokens.expires_in ?? 3600,
  });
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @organizer-hub/web typecheck
```

Expected: exits 0.

- [ ] **Step 4: Lint**

```bash
pnpm --filter @organizer-hub/web lint
```

Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/auth/callback/route.ts
git commit -m "feat(web): persist access_token cookie on sign-in"
```

---

## Task 3: Add the refresh middleware

**Files:**
- Create: `apps/web/src/middleware.ts`

- [ ] **Step 1: Create the middleware file with the exact content below**

```ts
// apps/web/src/middleware.ts
//
// Runs on every page request (per `config.matcher`). When the session cookie's
// id_token is within SKEW_SECONDS of expiry, exchanges the refresh_token at the
// IdP and rotates the session / access_token / refresh_token cookies on the
// outgoing response. On any failure path the cookies are cleared and the
// request continues — pages render signed-out from a missing session.
//
// Phase 1 limitations are tracked in:
//   ~/Documents/Obsidian/OrganizerHub/Auth/Token Refresh - Limitations.md
import { NextRequest, NextResponse } from "next/server";
import { decodeJwt } from "jose";
import { refreshTokens, type TokenResponse } from "@/lib/oidc/refresh";

const SKEW_SECONDS = 60;
const REFRESH_COOKIE_MAX_AGE = 60 * 60 * 24 * 14; // 14 days

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function clearAuthCookies(res: NextResponse): NextResponse {
  res.cookies.delete("session");
  res.cookies.delete("access_token");
  res.cookies.delete("refresh_token");
  return res;
}

function setAuthCookies(res: NextResponse, tokens: TokenResponse): NextResponse {
  const shared = { httpOnly: true, path: "/", sameSite: "lax" as const };
  const accessMaxAge = tokens.expires_in ?? 3600;
  res.cookies.set("session", tokens.id_token, { ...shared, maxAge: accessMaxAge });
  res.cookies.set("access_token", tokens.access_token, { ...shared, maxAge: accessMaxAge });
  if (tokens.refresh_token) {
    res.cookies.set("refresh_token", tokens.refresh_token, {
      ...shared,
      maxAge: REFRESH_COOKIE_MAX_AGE,
    });
  }
  return res;
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const session = req.cookies.get("session")?.value;
  if (!session) return NextResponse.next();

  let exp: number;
  try {
    const claims = decodeJwt(session);
    exp = claims.exp ?? 0;
  } catch {
    return clearAuthCookies(NextResponse.next());
  }

  if (exp - nowSeconds() > SKEW_SECONDS) {
    return NextResponse.next();
  }

  const refreshToken = req.cookies.get("refresh_token")?.value;
  if (!refreshToken) {
    return clearAuthCookies(NextResponse.next());
  }

  const tokens = await refreshTokens(refreshToken);
  if (!tokens) {
    return clearAuthCookies(NextResponse.next());
  }

  return setAuthCookies(NextResponse.next(), tokens);
}

export const config = {
  matcher: ["/((?!_next|api|auth|favicon\\.ico).*)"],
};
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @organizer-hub/web typecheck
```

Expected: exits 0, no errors.

- [ ] **Step 3: Lint**

```bash
pnpm --filter @organizer-hub/web lint
```

Expected: exits 0, no errors.

- [ ] **Step 4: Build (catches Edge-runtime incompatibilities not seen in typecheck)**

```bash
pnpm --filter @organizer-hub/web build
```

Expected: build succeeds. Look in the output for a line like `ƒ Middleware                                  XX kB` — if absent, the middleware was not picked up.

If build flags an Edge-runtime restriction on `process.env.OAUTH_CLIENT_ID` (server-only var consumed via `oidcConfig.clientId`), the fix is to add `export const runtime = "nodejs";` at the top of `middleware.ts` and rebuild. In Next.js 15 dev mode middleware runs on Node, but the build target may be Edge.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/middleware.ts
git commit -m "feat(web): add token-refresh middleware for transparent session renewal"
```

---

## Task 4: Manual happy-path verification

**No file changes — verification only. Do not commit.**

- [ ] **Step 1: Temporarily shorten the access token TTL in the IdP for fast verification**

Edit `apps/accounts/src/oidc/oidc.service.ts`, find the `resourceIndicators.getResourceServerInfo` block, change `accessTokenTTL: 60 * 60` to `accessTokenTTL: 90`. Save.

This change is temporary and reverted in Step 6.

- [ ] **Step 2: Restart the accounts and web dev servers**

Ensure both `apps/accounts` (port 3002) and `apps/web` (port 3000) are running from this branch's checkout. If servers were running off `main`, stop those and restart:

```bash
pnpm --filter @organizer-hub/accounts dev &
pnpm --filter @organizer-hub/web dev &
```

Wait until both log "listening" / "Ready".

- [ ] **Step 3: Sign in via the browser**

Navigate to `http://localhost:3000/`. Click **Sign In**. Complete the login form. You should land back on `/` showing "Signed in as ...".

- [ ] **Step 4: Inspect cookies before refresh**

In DevTools → Application → Cookies → `http://localhost:3000` — record the **values** of `session`, `access_token`, `refresh_token`. They should all be present.

- [ ] **Step 5: Wait 35 seconds, then reload**

After ~35s the access token has 55s left, so the middleware's 60s skew window triggers a refresh. Hard-reload the page (Cmd+Shift+R).

- [ ] **Step 6: Confirm cookies rotated**

The values of `session` and `access_token` MUST be different from Step 4. `refresh_token` is also typically rotated by `oidc-provider` (default behavior). The page still shows "Signed in as ...". ✅ pass.

If values did not change or "Sign in" appears, the refresh did not work — see Troubleshooting below.

- [ ] **Step 7: Revert the TTL change**

Restore `accessTokenTTL: 60 * 60` in `apps/accounts/src/oidc/oidc.service.ts`. Restart accounts.

**Troubleshooting:**
- If the page shows "Sign in" after Step 5: open the dev console; check for fetch errors. Inspect the network tab for the `/oidc/token` request — note the response status and body.
- If no `/oidc/token` request was made: the middleware did not trigger. Verify `apps/web/src/middleware.ts` exists, the build output included a middleware line, and you are signed in (session cookie present).

---

## Task 5: Manual failure-path verification

**No file changes — verification only. Do not commit.**

- [ ] **Step 1: With the test user signed in, find the refresh token row in the accounts DB**

```bash
psql "$ACCOUNTS_DATABASE_URL" -c "SELECT id, type, expires_at FROM oidc_payloads WHERE type = 'RefreshToken' ORDER BY created_at DESC LIMIT 3;"
```

Expected: at least one row with `type = 'RefreshToken'`.

- [ ] **Step 2: Delete all refresh-token rows to simulate a revoked refresh token**

```bash
psql "$ACCOUNTS_DATABASE_URL" -c "DELETE FROM oidc_payloads WHERE type = 'RefreshToken';"
```

- [ ] **Step 3: Force the middleware to attempt refresh**

Either (a) temporarily lower `accessTokenTTL` again per Task 4 Step 1 and wait, or (b) in DevTools → Application → Cookies, manually delete the `session` cookie's value and replace it with a tampered/expired JWT.

Easiest: lower TTL to 30, wait 35s, reload.

- [ ] **Step 4: Confirm signed-out state**

After reload, the page shows "Sign in". In DevTools → Cookies, `session` / `access_token` / `refresh_token` are gone. ✅ pass.

- [ ] **Step 5: Revert the TTL change**

Restore `accessTokenTTL: 60 * 60` in `apps/accounts/src/oidc/oidc.service.ts`. Restart accounts.

---

## Done criteria

- All three impl tasks (1, 2, 3) committed.
- Manual happy path (Task 4) confirms cookie rotation and continued sign-in.
- Manual failure path (Task 5) confirms cookies clear and signed-out UI renders.
- TTL revert from both manual tasks is in the working tree (not committed) — restored to original 1h.
- Branch `worktree-token-refresh` is on three new commits ahead of the `main` it was branched from.
