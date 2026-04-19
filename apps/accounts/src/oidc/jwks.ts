import { generateKeyPairSync, type JsonWebKey } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

export interface JWKSet {
  keys: JsonWebKey[];
}

/**
 * Load the RS256 private JWK from disk, or generate one if it doesn't exist.
 * The generated key is written to <keysDir>/private-jwk.json (gitignored).
 */
export async function loadOrGenerateJWKS(keysDir: string): Promise<JWKSet> {
  const keyPath = path.resolve(keysDir, 'private-jwk.json');
  try {
    const raw = await fs.readFile(keyPath, 'utf8');
    return { keys: [JSON.parse(raw) as JsonWebKey] };
  } catch {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = privateKey.export({ format: 'jwk' }) as JsonWebKey;
    const annotated: JsonWebKey = { ...jwk, use: 'sig', alg: 'RS256', kid: 'main' };
    await fs.mkdir(keysDir, { recursive: true });
    await fs.writeFile(keyPath, JSON.stringify(annotated, null, 2), { mode: 0o600 });
    return { keys: [annotated] };
  }
}
