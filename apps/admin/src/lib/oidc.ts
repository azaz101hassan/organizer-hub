import { buildOidcConfig } from "@organizer-hub/web-shared";

export const { config: oidcConfig, endpoints: oidcEndpoints } = buildOidcConfig({
  defaultClientId: "organizer-admin",
  defaultRedirectUri: "http://localhost:3003/auth/callback",
  defaultPostLogoutRedirectUri: "http://localhost:3003/",
});
