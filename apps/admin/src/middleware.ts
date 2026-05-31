import { createAuthRefreshMiddleware } from "@organizer-hub/web-shared";
import { oidcConfig, oidcEndpoints } from "@/lib/oidc";

const { middleware } = createAuthRefreshMiddleware({
  cookiePrefix: "oh_admin_",
  oidc: { config: oidcConfig, endpoints: oidcEndpoints },
});
export { middleware };

export const config = {
  matcher: ["/((?!_next|api|auth|favicon|.*\\.).*)"],
};
