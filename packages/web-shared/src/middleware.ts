// packages/web-shared/src/middleware.ts
//
// Factory that returns a Next.js-compatible middleware handler plus the
// `config` matcher object. Each app constructs its own 4-line shim that calls
// this factory with its cookiePrefix and OIDC configuration.
//
// Runs on every matched page request. When the session cookie's id_token is
// within SKEW_SECONDS of expiry, exchanges the refresh_token at the IdP and
// rotates the session / access_token / refresh_token cookies on the outgoing
// response. On any failure path the cookies are cleared and the request
// continues — pages render signed-out from a missing session.
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { decodeJwt } from "jose";
import type { OidcConfig, OidcEndpoints } from "./oidc/config";
import { refreshTokens, type TokenResponse } from "./oidc/refresh";

const SKEW_SECONDS = 60;
const REFRESH_COOKIE_MAX_AGE = 60 * 60 * 24 * 14; // 14 days

export type AuthMiddlewareOptions = {
  /** Prefix for all auth cookies, e.g. "oh_member_" or "oh_admin_". */
  cookiePrefix: string;
  oidc: { config: OidcConfig; endpoints: OidcEndpoints };
  /** Defaults to the standard Next.js exclusion pattern for pages. */
  matcher?: string[];
};

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function createAuthRefreshMiddleware(opts: AuthMiddlewareOptions): {
  middleware: (req: NextRequest) => Promise<NextResponse>;
  config: { matcher: string[] };
} {
  const sessionCookie = `${opts.cookiePrefix}session`;
  const accessTokenCookie = `${opts.cookiePrefix}access_token`;
  const refreshCookie = `${opts.cookiePrefix}refresh`;

  function clearAuthCookies(res: NextResponse): NextResponse {
    res.cookies.delete(sessionCookie);
    res.cookies.delete(accessTokenCookie);
    res.cookies.delete(refreshCookie);
    return res;
  }

  function setAuthCookies(res: NextResponse, tokens: TokenResponse): NextResponse {
    const shared = { httpOnly: true, path: "/", sameSite: "lax" as const };
    const accessMaxAge = tokens.expires_in ?? 3600;
    res.cookies.set(sessionCookie, tokens.id_token, { ...shared, maxAge: accessMaxAge });
    res.cookies.set(accessTokenCookie, tokens.access_token, { ...shared, maxAge: accessMaxAge });
    if (tokens.refresh_token) {
      res.cookies.set(refreshCookie, tokens.refresh_token, {
        ...shared,
        maxAge: REFRESH_COOKIE_MAX_AGE,
      });
    }
    return res;
  }

  async function middleware(req: NextRequest): Promise<NextResponse> {
    const session = req.cookies.get(sessionCookie)?.value;
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

    const refreshToken = req.cookies.get(refreshCookie)?.value;
    if (!refreshToken) {
      return clearAuthCookies(NextResponse.next());
    }

    const tokens = await refreshTokens(refreshToken, opts.oidc.config, opts.oidc.endpoints);
    if (!tokens) {
      return clearAuthCookies(NextResponse.next());
    }

    return setAuthCookies(NextResponse.next(), tokens);
  }

  const config = {
    matcher: opts.matcher ?? ["/((?!_next|api|auth|favicon|.*\\.).*)"],
  };

  return { middleware, config };
}
