// packages/web-shared/src/oidc/refresh.ts
//
// Server-only. POSTs grant_type=refresh_token to the IdP and returns the new
// token set. Returns null on any non-2xx or fetch failure — the caller decides
// what to do (typically clear cookies and continue).
import type { OidcConfig, OidcEndpoints } from "./config";

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
  config: OidcConfig,
  endpoints: OidcEndpoints,
): Promise<TokenResponse | null> {
  try {
    const res = await fetch(endpoints.token, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: config.clientId,
      }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as TokenResponse;
  } catch {
    return null;
  }
}
