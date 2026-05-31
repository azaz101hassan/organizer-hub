#!/usr/bin/env node
/* eslint-disable no-console */
// Local-dev convenience: grant the OWNER role on the seeded house
// organization to an accounts user (looked up by email), so a fresh signup
// can immediately use the admin app's write paths.
//
// Run:    node scripts/promote-house-owner.mjs alice@example.com
//   or:   pnpm setup:owner alice@example.com
//
// Idempotent. Reads ACCOUNTS_DATABASE_URL and API_DATABASE_URL from the
// repo root .env (the same one `pnpm setup:env` scaffolds).
//
// Out of scope: roles other than OWNER, organizations other than the
// seeded house org, multi-tenant flows. This script exists to remove a
// single local-dev paper-cut documented in
// docs/specs/2026-05-31-promote-house-owner-design.md.

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient as AccountsPrisma } from "@organizer-hub/db/accounts";
import { PrismaClient as ApiPrisma, OrganizationRole } from "@organizer-hub/db/api";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// The Prisma clients read their connection strings from `process.env.*` at
// `new PrismaClient()`. Hydrate the root .env into process.env without
// overriding anything the caller already set.
try {
  const txt = await readFile(join(REPO_ROOT, ".env"), "utf8");
  for (const line of txt.split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
    }
  }
} catch { /* no root .env — Prisma will error with a clear message */ }

const HOUSE_ORG_ID = "org_house_000000000000000001";

function usageAndExit(code) {
  console.error("usage: node scripts/promote-house-owner.mjs <email>");
  console.error("       pnpm setup:owner <email>");
  process.exit(code);
}

const email = process.argv[2];
if (!email) usageAndExit(2);
if (!email.includes("@")) {
  console.error(`error: "${email}" does not look like an email address`);
  usageAndExit(2);
}

const accounts = new AccountsPrisma();
const api = new ApiPrisma();

try {
  const user = await accounts.user.findUnique({ where: { email } });
  if (!user) {
    console.error(
      `error: no accounts user with email "${email}".\n` +
      `hint: sign up at http://localhost:3002 (or your accounts URL) first.`,
    );
    process.exit(1);
  }

  const org = await api.organization.findUnique({ where: { id: HOUSE_ORG_ID } });
  if (!org) {
    console.error(
      `error: house organization "${HOUSE_ORG_ID}" not found.\n` +
      `hint: run \`pnpm -F api seed\` first.`,
    );
    process.exit(1);
  }

  const existing = await api.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: org.id, userId: user.id } },
  });

  if (existing && existing.role === OrganizationRole.OWNER) {
    console.log(`${email} is already OWNER on ${org.id}, nothing to do.`);
  } else if (existing) {
    await api.organizationMember.update({
      where: { id: existing.id },
      data: { role: OrganizationRole.OWNER },
    });
    console.log(`upgraded ${email} (${user.id}) from ${existing.role} to OWNER on ${org.id}.`);
  } else {
    await api.organizationMember.create({
      data: { organizationId: org.id, userId: user.id, role: OrganizationRole.OWNER },
    });
    console.log(`granted OWNER to ${email} (${user.id}) on ${org.id}.`);
  }
} catch (err) {
  console.error(err);
  process.exit(1);
} finally {
  await accounts.$disconnect();
  await api.$disconnect();
}
