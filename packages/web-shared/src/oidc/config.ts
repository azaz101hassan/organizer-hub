export type OidcDefaults = {
  defaultClientId: string;
  defaultRedirectUri: string;
  defaultPostLogoutRedirectUri: string;
};

export type OidcConfig = {
  issuer: string;
  clientId: string;
  redirectUri: string;
  postLogoutRedirectUri: string;
  scope: string;
};

export type OidcEndpoints = {
  authorize: string;
  token: string;
  userinfo: string;
  jwks: string;
  endSession: string;
};

export function buildOidcConfig(defaults: OidcDefaults): {
  config: OidcConfig;
  endpoints: OidcEndpoints;
} {
  const issuer = process.env.NEXT_PUBLIC_ACCOUNTS_URL ?? "http://localhost:3002";
  const config: OidcConfig = {
    issuer,
    clientId: process.env.OAUTH_CLIENT_ID ?? defaults.defaultClientId,
    redirectUri: process.env.OAUTH_REDIRECT_URI ?? defaults.defaultRedirectUri,
    postLogoutRedirectUri:
      process.env.OAUTH_POST_LOGOUT_REDIRECT_URI ?? defaults.defaultPostLogoutRedirectUri,
    scope: "openid profile email offline_access",
  };
  const endpoints: OidcEndpoints = {
    authorize: `${issuer}/oidc/auth`,
    token: `${issuer}/oidc/token`,
    userinfo: `${issuer}/oidc/me`,
    jwks: `${issuer}/oidc/jwks`,
    endSession: `${issuer}/oidc/session/end`,
  };
  return { config, endpoints };
}
