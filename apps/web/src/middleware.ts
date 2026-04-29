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
  matcher: ["/((?!_next|api|auth|favicon|.*\\.).*)"],
};
