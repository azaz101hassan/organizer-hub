import { NextResponse } from "next/server";
import { oidcConfig, oidcEndpoints } from "@/lib/oidc";
import { generatePkcePair, generateState } from "@organizer-hub/web-shared/oidc/pkce";

export async function GET(): Promise<Response> {
  const { verifier, challenge } = generatePkcePair();
  const state = generateState();

  const authUrl = new URL(oidcEndpoints.authorize);
  authUrl.searchParams.set("client_id", oidcConfig.clientId);
  authUrl.searchParams.set("redirect_uri", oidcConfig.redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", oidcConfig.scope);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  // OIDC spec requires `prompt=consent` for offline_access to survive the
  // authorize stage; without it the IdP drops it and no refresh_token is issued.
  // Our consent handler auto-grants for first-party clients, so this is invisible.
  authUrl.searchParams.set("prompt", "consent");

  const res = NextResponse.redirect(authUrl);
  const cookieOpts = {
    httpOnly: true as const,
    path: "/",
    sameSite: "lax" as const,
    maxAge: 600, // 10 minutes — only used during the redirect roundtrip
  };
  res.cookies.set("oh_member_state", state, cookieOpts);
  res.cookies.set("oh_member_pkce", verifier, cookieOpts);
  return res;
}
