#!/usr/bin/env node
// Copies every .env.example to a sibling .env.local if the local file does not exist.
// Idempotent: never overwrites an existing .env.local.
import { readdir, copyFile, access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const APPS_DIR = join(REPO_ROOT, "apps");

async function exists(p) {
  try { await access(p, constants.F_OK); return true; } catch { return false; }
}

async function copyIfMissing(examplePath, localPath) {
  if (await exists(localPath)) {
    console.log(`  skip   ${localPath} (exists)`);
    return;
  }
  await copyFile(examplePath, localPath);
  console.log(`  create ${localPath}`);
}

async function main() {
  const targets = [];
  // Root.
  const rootExample = join(REPO_ROOT, ".env.example");
  if (await exists(rootExample)) {
    targets.push({ example: rootExample, local: join(REPO_ROOT, ".env") });
  }
  // Per-app.
  const apps = await readdir(APPS_DIR);
  for (const app of apps) {
    const appPath = join(APPS_DIR, app);
    const st = await stat(appPath);
    if (!st.isDirectory()) continue;
    const example = join(appPath, ".env.example");
    if (await exists(example)) {
      targets.push({ example, local: join(appPath, ".env.local") });
    }
  }
  console.log(`setup:env — ${targets.length} candidate(s)`);
  for (const t of targets) {
    await copyIfMissing(t.example, t.local);
  }
  console.log("done. fill in any sentinel values then `pnpm dev`.");
}

main().catch(err => { console.error(err); process.exit(1); });
