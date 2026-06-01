import { publicApiFetch } from './client';

interface OrgFlags {
  donationsEnabled: boolean;
}

/**
 * Resolves the current organization's donations feature flag.
 * Used by member and admin server components to 404 donation routes
 * when the flag is off. Cached per request via React's cache().
 */
export async function donationsEnabledForOrg(): Promise<boolean> {
  try {
    const flags = await publicApiFetch<OrgFlags>('/organization/flags');
    return Boolean(flags.donationsEnabled);
  } catch {
    return false;
  }
}
