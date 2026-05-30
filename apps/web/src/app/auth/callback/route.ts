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

  const storedState = req.cookies.get("oidc_state")?.value;
  const verifier = req.cookies.get("oidc_verifier")?.value;
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

  const res = NextResponse.redirect(new URL("/", req.url));
  // Phase 1 MVP: stash id_token in an httpOnly cookie. Phase 2 will move to a
  // server-side session store and verify signature against JWKS on each read.
  res.cookies.set("session", tokens.id_token, {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    maxAge: tokens.expires_in ?? 3600,
  });
  res.cookies.set("access_token", tokens.access_token, {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    maxAge: tokens.expires_in ?? 3600,
  });
  if (tokens.refresh_token) {
    res.cookies.set("refresh_token", tokens.refresh_token, {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 14, // 14 days
    });
  }
  // clean up transient cookies
  res.cookies.delete("oidc_state");
  res.cookies.delete("oidc_verifier");
  return res;
}
