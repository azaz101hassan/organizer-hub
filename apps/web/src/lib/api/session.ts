import "server-only";
import { cookies } from "next/headers";
import { decodeJwt } from "jose";

export interface Session {
  sub: string;
  email?: string;
  name?: string;
  emailVerified?: boolean;
  accessToken: string;
}

interface IdTokenClaims {
  sub?: string;
  email?: string;
  name?: string;
  email_verified?: boolean;
}

export async function readSession(): Promise<Session | null> {
  const store = await cookies();
  const idToken = store.get("session")?.value;
  const accessToken = store.get("access_token")?.value;
  if (!idToken || !accessToken) return null;

  let claims: IdTokenClaims;
  try {
    // Phase 1: parse only. Phase 2 will verify signature against the IdP's JWKS.
    claims = decodeJwt(idToken) as IdTokenClaims;
  } catch {
    return null;
  }
  if (!claims.sub) return null;

  return {
    sub: claims.sub,
    email: claims.email,
    name: claims.name,
    emailVerified: claims.email_verified,
    accessToken,
  };
}
