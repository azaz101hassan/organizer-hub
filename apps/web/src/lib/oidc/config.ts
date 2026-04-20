// Server-only OIDC client config. Read from the monorepo root .env.
// (next.config.ts dotenv-loads it at startup.)

export const oidcConfig = {
  issuer: process.env.NEXT_PUBLIC_ACCOUNTS_URL ?? "http://localhost:3002",
  clientId: process.env.OAUTH_CLIENT_ID ?? "organizer-web",
  redirectUri:
    process.env.OAUTH_REDIRECT_URI ?? "http://localhost:3000/auth/callback",
  postLogoutRedirectUri:
    process.env.OAUTH_POST_LOGOUT_REDIRECT_URI ?? "http://localhost:3000/",
  scope: "openid profile email offline_access",
} as const;

export const oidcEndpoints = {
  authorize: `${oidcConfig.issuer}/oidc/auth`,
  token: `${oidcConfig.issuer}/oidc/token`,
  userinfo: `${oidcConfig.issuer}/oidc/me`,
  jwks: `${oidcConfig.issuer}/oidc/jwks`,
  endSession: `${oidcConfig.issuer}/oidc/session/end`,
} as const;
