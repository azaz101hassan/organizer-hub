import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface E2EEnv {
  apiUrl: string;
  accountsUrl: string;
  memberUrl: string;
  adminUrl: string;
  houseOrgId: string;
  apiDatabaseUrl: string;
  accountsDatabaseUrl: string;
}

// Minimal dotenv parser: ignores comments and blank lines, strips surrounding
// quotes. Matches the format produced by scripts/setup-env.mjs.
async function readDotenv(path: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  try {
    const txt = await readFile(path, 'utf8');
    for (const line of txt.split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m) out[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
    }
  } catch {
    // Missing .env is OK; values may come from the shell environment instead.
  }
  return out;
}

export async function loadE2EEnv(repoRoot: string): Promise<E2EEnv> {
  const fileEnv = await readDotenv(join(repoRoot, '.env'));
  const pick = (key: string, fallback: string): string =>
    process.env[key] ?? fileEnv[key] ?? fallback;

  const env: E2EEnv = {
    apiUrl: pick('API_URL', 'http://localhost:3001'),
    accountsUrl: pick('ACCOUNTS_URL', 'http://localhost:3002'),
    memberUrl: pick('WEB_ORIGIN', 'http://localhost:3000'),
    adminUrl: pick('ADMIN_ORIGIN', 'http://localhost:3003'),
    // Hardcoded to match the predecessor smoke script. If a future setup
    // changes the house org id, switch to reading from .env.
    houseOrgId: 'org_house_000000000000000001',
    apiDatabaseUrl: pick(
      'API_DATABASE_URL',
      'postgresql://localhost:5432/organizer_db',
    ),
    accountsDatabaseUrl: pick(
      'ACCOUNTS_DATABASE_URL',
      'postgresql://localhost:5432/accounts_db',
    ),
  };
  return env;
}
