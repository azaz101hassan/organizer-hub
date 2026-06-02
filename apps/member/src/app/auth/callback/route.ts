import { NextRequest, NextResponse } from "next/server";
import { oidcConfig, oidcEndpoints } from "@/lib/oidc";

interface TokenResponse {
  access_token: string;
  id_token: string;
  refresh_token?: string;
  token_type: "Bearer";
  expires_in: number;
  scope?: string;
}

export async function GET(req: NextRequest): Promise<Response> {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const errorParam = req.nextUrl.searchParams.get("error");
  if (errorParam) {
    return new Response(`OIDC error: ${errorParam}`, { status: 400 });
  }

  const storedState = req.cookies.get("oh_member_state")?.value;
  const verifier = req.cookies.get("oh_member_pkce")?.value;
  if (!code || !state || !storedState || state !== storedState || !verifier) {
    return new Response("invalid auth callback (state mismatch or missing verifier)", { status: 400 });
  }

  const tokenRes = await fetch(oidcEndpoints.token, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: oidcConfig.redirectUri,
      client_id: oidcConfig.clientId,
      code_verifier: verifier,
    }),
  });

  if (!tokenRes.ok) {
    const detail = await tokenRes.text();
    return new Response(`token exchange failed (${tokenRes.status}): ${detail}`, { status: 502 });
  }

  const tokens = (await tokenRes.json()) as TokenResponse;

  // Resume the requested destination if the login flow set one; defaults to "/".
  // The validation in authorize already screened for safe relative paths, but
  // re-check here so a tampered cookie can't break out to an absolute URL.
  const requestedNext = req.cookies.get("oh_member_next")?.value ?? null;
  const safeNext =
    requestedNext &&
    requestedNext.startsWith("/") &&
    !requestedNext.startsWith("//")
      ? requestedNext
      : "/";

  const res = NextResponse.redirect(new URL(safeNext, req.url));
  // Phase 1 MVP: stash id_token in an httpOnly cookie. Phase 2 will move to a
  // server-side session store and verify signature against JWKS on each read.
  res.cookies.set("oh_member_session", tokens.id_token, {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    maxAge: tokens.expires_in ?? 3600,
  });
  res.cookies.set("oh_member_access_token", tokens.access_token, {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    maxAge: tokens.expires_in ?? 3600,
  });
  if (tokens.refresh_token) {
    res.cookies.set("oh_member_refresh", tokens.refresh_token, {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 14, // 14 days
    });
  }
  // clean up transient cookies
  res.cookies.delete("oh_member_state");
  res.cookies.delete("oh_member_pkce");
  res.cookies.delete("oh_member_next");
  return res;
}
