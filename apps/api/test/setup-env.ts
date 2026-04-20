import * as fs from 'node:fs';
import * as nodePath from 'node:path';
import { config as loadDotenv } from 'dotenv';

function findUp(name: string, start: string = __dirname): string | undefined {
  let dir = start;
  for (let i = 0; i < 10; i++) {
    const candidate = nodePath.join(dir, name);
    if (fs.existsSync(candidate)) return candidate;
    const parent = nodePath.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

const envFile = findUp('.env');
if (envFile) loadDotenv({ path: envFile });
