import { buildOidcConfig } from "@organizer-hub/web-shared";

export const { config: oidcConfig, endpoints: oidcEndpoints } = buildOidcConfig({
  defaultClientId: "organizer-member",
  defaultRedirectUri: "http://localhost:3000/auth/callback",
  defaultPostLogoutRedirectUri: "http://localhost:3000/",
});
