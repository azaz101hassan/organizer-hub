import { chromium, type FullConfig } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { loadE2EEnv } from './shared/env';
import { signupViaMember, signinExistingViaApp } from './shared/accounts';
import { grantHouseOwner, lookupAccountsUserId } from './shared/db';

export default async function globalSetup(config: FullConfig): Promise<void> {
  const repoRoot =
    (config.metadata?.repoRoot as string | undefined) ??
    join(__dirname, '..');
  const env = await loadE2EEnv(repoRoot);

  const authDir = join(__dirname, '.auth');
  await mkdir(authDir, { recursive: true });

  const browser = await chromium.launch();

  try {
    // Member context: signup + persist storageState
    const memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();
    const creds = await signupViaMember(
      memberPage,
      env.memberUrl,
      env.accountsUrl,
    );

    const userId = lookupAccountsUserId(env.accountsDatabaseUrl, creds.email);
    grantHouseOwner(env.apiDatabaseUrl, env.houseOrgId, userId);

    await memberContext.storageState({ path: join(authDir, 'member.json') });
    await memberContext.close();

    // Admin context: sign in same user, persist storageState
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await signinExistingViaApp(adminPage, env.adminUrl, env.accountsUrl, creds);
    await adminContext.storageState({ path: join(authDir, 'admin.json') });
    await adminContext.close();
  } finally {
    await browser.close();
  }
}
