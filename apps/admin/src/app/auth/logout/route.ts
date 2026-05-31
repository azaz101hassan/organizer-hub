import { NextRequest, NextResponse } from "next/server";
import { oidcConfig, oidcEndpoints } from "@/lib/oidc";

export async function GET(req: NextRequest): Promise<Response> {
  const idToken = req.cookies.get("oh_admin_session")?.value;

  const endSession = new URL(oidcEndpoints.endSession);
  endSession.searchParams.set("post_logout_redirect_uri", oidcConfig.postLogoutRedirectUri);
  endSession.searchParams.set("client_id", oidcConfig.clientId);
  if (idToken) endSession.searchParams.set("id_token_hint", idToken);

  const res = NextResponse.redirect(endSession);
  res.cookies.delete("oh_admin_session");
  res.cookies.delete("oh_admin_access_token");
  res.cookies.delete("oh_admin_refresh");
  res.cookies.delete("oh_admin_state");
  res.cookies.delete("oh_admin_pkce");
  return res;
}
