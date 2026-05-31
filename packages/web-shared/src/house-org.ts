// Server-only: reads HOUSE_ORG_ID at runtime so the admin app can bind to
// a single tenant. Throws with a clear message if unset so callers can't
// silently fall back to undefined and create cross-tenant bugs.
export function getHouseOrgId(): string {
  const id = process.env.HOUSE_ORG_ID;
  if (!id) {
    throw new Error(
      "HOUSE_ORG_ID is not set. Add it to apps/admin/.env.local.",
    );
  }
  return id;
}
