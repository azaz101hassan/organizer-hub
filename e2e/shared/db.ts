import { execSync } from 'node:child_process';

function psql(databaseUrl: string, sql: string): string {
  return execSync(
    `psql -tA "${databaseUrl}" -c "${sql.replace(/"/g, '\\"')}"`,
    { encoding: 'utf8' },
  ).trim();
}

// Look up the freshly-created accounts user by email. The accounts DB uses
// the `users` table with columns `id` and `email`. Throws if no row is found.
export function lookupAccountsUserId(
  accountsDatabaseUrl: string,
  email: string,
): string {
  const id = psql(
    accountsDatabaseUrl,
    `SELECT id FROM users WHERE email = '${email}' LIMIT 1`,
  );
  if (!id) {
    throw new Error(`lookupAccountsUserId: no users row for email ${email}`);
  }
  return id;
}

// Re-create the house org row if it was wiped by API e2e specs (those suites
// run prisma.organization.deleteMany which removes the seed row). Mirrors the
// canonical values from apps/api/scripts/seed.ts. ON CONFLICT DO NOTHING
// (bare, no target) covers both the id PK and the unique slug constraint,
// making the call safe to run even when the row already exists.
export function upsertHouseOrg(
  apiDatabaseUrl: string,
  houseOrgId: string,
): void {
  psql(
    apiDatabaseUrl,
    `INSERT INTO organizations (id, name, slug, created_by, created_at, updated_at) ` +
      `VALUES ('${houseOrgId}', 'House Organization', 'house', 'system', NOW(), NOW()) ` +
      `ON CONFLICT DO NOTHING`,
  );
}

// Grant the user OWNER on the house org. A fresh OIDC signup arrives with no
// memberships, so admin routes return 404 until this row exists. The id is
// generated locally to avoid relying on a DB default, matching the predecessor
// smoke script's pattern.
export function grantHouseOwner(
  apiDatabaseUrl: string,
  houseOrgId: string,
  userId: string,
): void {
  const memberId = `om_e2e_${Math.random().toString(36).slice(2, 12)}`;
  psql(
    apiDatabaseUrl,
    `INSERT INTO organization_members (id, organization_id, user_id, role, created_at) ` +
      `VALUES ('${memberId}', '${houseOrgId}', '${userId}', 'OWNER', NOW()) ` +
      `ON CONFLICT (organization_id, user_id) DO NOTHING`,
  );
}
