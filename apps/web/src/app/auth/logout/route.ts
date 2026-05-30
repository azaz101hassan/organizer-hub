import { NextRequest, NextResponse } from "next/server";
import { oidcConfig, oidcEndpoints } from "@/lib/oidc";

export async function GET(req: NextRequest): Promise<Response> {
  const idToken = req.cookies.get("oh_member_session")?.value;

  const endSession = new URL(oidcEndpoints.endSession);
  endSession.searchParams.set("post_logout_redirect_uri", oidcConfig.postLogoutRedirectUri);
  endSession.searchParams.set("client_id", oidcConfig.clientId);
  if (idToken) endSession.searchParams.set("id_token_hint", idToken);

  const res = NextResponse.redirect(endSession);
  // Clear the local web session immediately. The IdP roundtrip will end the SSO
  // session at the provider, then redirect back to post_logout_redirect_uri.
  res.cookies.delete("oh_member_session");
  res.cookies.delete("oh_member_access_token");
  res.cookies.delete("oh_member_refresh");
  res.cookies.delete("oh_member_state");
  res.cookies.delete("oh_member_pkce");
  return res;
}
