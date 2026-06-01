import { publicApiFetch } from './client';

interface OrgFlags {
  donationsEnabled: boolean;
}

/**
 * Resolves the current organization's donations feature flag.
 * Used by member and admin server components to 404 donation routes
 * when the flag is off. Callers in server components should wrap
 * this in React's cache() for per-request deduplication.
 */
export async function donationsEnabledForOrg(): Promise<boolean> {
  try {
    const flags = await publicApiFetch<OrgFlags>('/organization/flags');
    return Boolean(flags.donationsEnabled);
  } catch {
    return false;
  }
}
