#!/usr/bin/env node
/* eslint-disable no-console */
// On-demand visual/UX smoke for the admin/member split. NOT wired into
// `pnpm test`, jest e2e, or CI -- run it manually when you want to confirm
// the end-to-end OIDC + label CRUD + event publish flow still works and
// looks right in a real browser. Update only when explicitly asked.
//
// Prereqs (one-time): `npx playwright install chromium`
// Required: all four apps already running (api 3001, accounts 3002,
// member 3000, admin 3003) and both seeds applied
// (`pnpm -F accounts seed && pnpm -F api seed`).
//
// Run:    node scripts/admin-member-smoke.mjs
// Output: /tmp/admin-member-smoke/<iso-stamp>/*.png  and  stdout summary
//
// Coverage:
//   • Two isolated browser contexts (member 3000, admin 3003)
//   • Fresh OIDC signup on accounts; cookie isolation between contexts
//   • Member three-card dashboard + label-chip filter on /events + label
//     badge on the public event detail
//   • Admin label CRUD: create, duplicate-slug 409 surfacing, rename,
//     delete-unused, delete-in-use rejection
//   • Admin event create -> publish -> visible to member
//
// Notes:
//   • Uses psql to grant the smoke user OWNER on the house org after
//     signup, because account signup alone provisions no membership.
//     See the brand-new-user bootstrap gap noted in the smoke report.
//   • DB urls and HOUSE_ORG_ID are read from the repo's root .env.

import { chromium } from "playwright";
import { mkdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Tiny dotenv reader: returns a map of KEY=VALUE pairs, ignoring comments.
async function readEnv(path) {
  const out = {};
  try {
    const txt = await readFile(path, "utf8");
    for (const line of txt.split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m) out[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
    }
  } catch { /* ignore */ }
  return out;
}
const env = await readEnv(join(REPO_ROOT, ".env"));

const ACCOUNTS_DB = env.ACCOUNTS_DATABASE_URL || "postgresql://localhost:5432/accounts_db";
const API_DB      = env.API_DATABASE_URL      || "postgresql://localhost:5432/organizer_db";
const HOUSE_ORG_ID = "org_house_000000000000000001";

function psql(url, sql) {
  return execSync(`psql -tA "${url}" -c "${sql.replace(/"/g, '\\"')}"`, { encoding: "utf8" }).trim();
}

// Grant the signed-up smoke user OWNER role on the house org so the admin
// surface (labels, events) has real backing data. Idempotent.
function grantHouseOwner(email) {
  const userId = psql(ACCOUNTS_DB, `SELECT id FROM users WHERE email = '${email}' LIMIT 1`);
  if (!userId) throw new Error(`grantHouseOwner: no user with email ${email}`);
  psql(
    API_DB,
    `INSERT INTO organization_members (id, organization_id, user_id, role, created_at) ` +
    `VALUES ('om_smoke_' || substr(md5(random()::text), 1, 16), '${HOUSE_ORG_ID}', '${userId}', 'OWNER', NOW()) ` +
    `ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
  );
  return userId;
}

// Per-run timestamped output dir so back-to-back runs don't trample each other.
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const ROOT  = `/tmp/admin-member-smoke/${STAMP}`;
const MEMBER_URL = "http://localhost:3000";
const ADMIN_URL  = "http://localhost:3003";
const ACCOUNTS_URL = "http://localhost:3002";

const userEmail = `smoke+${Date.now()}@example.com`;
const userPassword = "smokepw123!";
const userName  = "Smoke User";

const slugBase = `smoke-${Date.now().toString(36)}`;
// Names include slugBase so older runs' leftover rows can't collide with
// selectOption({ label: ... }) in the create-event form.
const labelOriginal = { name: `Smoke Label ${slugBase}`,   slug: slugBase };
const labelRenamed  = { name: `Smoke Renamed ${slugBase}`, slug: `${slugBase}-r` };

const steps = [];
function record(status, msg, extra) {
  const line = { status, msg, ...(extra ? { extra } : {}) };
  steps.push(line);
  const icon = { pass: "✅", fail: "❌", probe: "🔍", warn: "⚠️" }[status] || "•";
  console.log(`${icon} ${msg}${extra ? `  -- ${JSON.stringify(extra)}` : ""}`);
}

async function shot(page, name) {
  const path = join(ROOT, `${name}.png`);
  try { await page.screenshot({ path, fullPage: true }); }
  catch (err) { console.warn(`  (screenshot ${name} failed: ${err.message})`); }
  return path;
}

async function waitForUrlMatching(page, predicate, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate(page.url())) return;
    await page.waitForTimeout(150);
  }
  throw new Error(`URL never matched predicate; last=${page.url()}`);
}

// ---- Signup via accounts (member client triggers the OIDC interaction) ----
async function signUpOnMember(page) {
  await page.goto(`${MEMBER_URL}/auth/login`, { waitUntil: "networkidle" });
  // Expect to be on accounts at /interaction/<uid>
  await waitForUrlMatching(page, (u) => u.startsWith(`${ACCOUNTS_URL}/interaction/`));
  const interactionUrl = page.url();
  if (!/\/interaction\/[^/]+$/.test(interactionUrl)) {
    throw new Error(`unexpected interaction url: ${interactionUrl}`);
  }
  record("pass", `member /auth/login redirected to ${new URL(interactionUrl).pathname}`);
  // Click "Create an account"
  await page.click('a[href*="/signup"]');
  await page.waitForLoadState("domcontentloaded");
  // Fill signup form
  await page.fill('input[name="name"]', userName);
  await page.fill('input[name="email"]', userEmail);
  await page.fill('input[name="password"]', userPassword);
  await shot(page, "01-signup-form");
  await Promise.all([
    page.waitForLoadState("networkidle"),
    page.click('button[type="submit"]'),
  ]);
  // After signup OIDC completes -> redirected back to member /
  await waitForUrlMatching(page, (u) => u.startsWith(MEMBER_URL), 20000);
  record("pass", `signup completed -> ${new URL(page.url()).pathname} on member`);
  await shot(page, "02-member-after-signup");
}

// ---- Sign in on admin in a separate context (cookie isolation guaranteed) ----
async function signInOnAdmin(page) {
  await page.goto(`${ADMIN_URL}/auth/login`, { waitUntil: "networkidle" });
  await waitForUrlMatching(page, (u) => u.startsWith(`${ACCOUNTS_URL}/interaction/`));
  record("pass", `admin /auth/login redirected to accounts interaction`);
  // Login form
  await page.fill('input[name="email"]', userEmail);
  await page.fill('input[name="password"]', userPassword);
  await shot(page, "10-admin-login-form");
  await Promise.all([
    page.waitForLoadState("networkidle"),
    page.click('button[type="submit"]'),
  ]);
  // Wait for landing on admin (after possible consent step)
  // The OIDC provider may also need a consent submit -- handle that defensively.
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const url = page.url();
    if (url.startsWith(ADMIN_URL)) break;
    if (/\/interaction\/[^/]+$/.test(url)) {
      // Could be a consent screen -- try to submit any visible form/button.
      const btn = await page.$('button[type="submit"]');
      if (btn) {
        await Promise.all([page.waitForLoadState("networkidle"), btn.click()]).catch(() => {});
        continue;
      }
    }
    await page.waitForTimeout(200);
  }
  if (!page.url().startsWith(ADMIN_URL)) {
    throw new Error(`admin sign-in never landed on admin; last=${page.url()}`);
  }
  record("pass", `admin sign-in landed at ${new URL(page.url()).pathname}`);
  await shot(page, "11-admin-after-login");
}

// ---- Member dashboard cards ----
async function checkMemberDashboard(page) {
  await page.goto(`${MEMBER_URL}/dashboard`, { waitUntil: "networkidle" });
  const html = await page.content();
  const hasMembership = /Membership/.test(html);
  const hasRequests   = /My requests/i.test(html);
  const hasBrowse     = /Browse/.test(html);
  await shot(page, "03-member-dashboard");
  if (hasMembership && hasRequests && hasBrowse) {
    record("pass", "member /dashboard renders Membership + My requests + Browse cards");
  } else {
    record("fail", "missing one or more dashboard cards", { hasMembership, hasRequests, hasBrowse });
  }
}

// ---- Member events filter chip ----
async function checkMemberEventsChip(page) {
  await page.goto(`${MEMBER_URL}/events`, { waitUntil: "networkidle" });
  await shot(page, "04-member-events-all");
  // Click the "Concerts" chip (seeded label)
  const concerts = await page.$('a:has-text("Concerts")');
  if (!concerts) {
    record("fail", "Concerts chip not found on /events");
    return;
  }
  // Next.js client-side navigation never fires the load event, so wait on URL.
  await Promise.all([page.waitForURL(/labelId=/, { timeout: 10000 }), concerts.click()]);
  if (!page.url().includes("labelId=")) {
    record("fail", `clicking Concerts did not set labelId=; url=${page.url()}`);
    return;
  }
  record("pass", `clicking Concerts -> ${new URL(page.url()).pathname + new URL(page.url()).search}`);
  await shot(page, "05-member-events-concerts");
}

// ---- Admin: label CRUD ----
async function adminLabelCrud(page) {
  await page.goto(`${ADMIN_URL}/labels`, { waitUntil: "networkidle" });
  await shot(page, "12-admin-labels-initial");

  // Create
  await page.fill('input[name="name"]', labelOriginal.name);
  await page.fill('input[name="slug"]', labelOriginal.slug);
  await Promise.all([
    page.waitForLoadState("networkidle"),
    page.click('button:has-text("Add label")'),
  ]);
  if (!(await page.locator(`text=${labelOriginal.slug}`).first().isVisible())) {
    record("fail", `created label "${labelOriginal.slug}" not visible after create`);
    return;
  }
  record("pass", `created label "${labelOriginal.slug}"`);

  // Duplicate-slug -- expect inline error
  await page.fill('input[name="name"]', `${labelOriginal.name} dup`);
  await page.fill('input[name="slug"]', labelOriginal.slug);
  await Promise.all([
    page.waitForLoadState("networkidle"),
    page.click('button:has-text("Add label")'),
  ]);
  const dupErr = await page.locator('text=A label with that slug already exists').first();
  if (await dupErr.isVisible()) {
    record("probe", "duplicate-slug create surfaces inline 'already exists' error");
  } else {
    record("fail", "duplicate-slug create did not show expected inline error");
  }
  await shot(page, "13-admin-labels-duplicate");

  // Rename. The view-mode row matches hasText: slug. After clicking Rename,
  // the slug moves into an <input value=...> so hasText no longer matches —
  // re-locate the edit-mode row by the Save button.
  await page.locator("li", { hasText: labelOriginal.slug }).first()
    .locator('button:has-text("Rename")').click();
  const editingRow = page
    .locator("li")
    .filter({ has: page.locator('button:has-text("Save")') })
    .first();
  await editingRow.locator('input[name="name"]').fill(labelRenamed.name);
  await editingRow.locator('input[name="slug"]').fill(labelRenamed.slug);
  await editingRow.locator('button:has-text("Save")').click();
  await page.waitForLoadState("networkidle");
  if (await page.locator(`text=${labelRenamed.slug}`).first().isVisible()) {
    record("pass", `renamed label to "${labelRenamed.slug}"`);
  } else {
    record("fail", `rename did not persist; expected slug ${labelRenamed.slug}`);
  }
  await shot(page, "14-admin-labels-renamed");
}

// ---- Admin: create event with the (now renamed) smoke label, capture id ----
async function adminCreateEvent(page) {
  // Need a label for the new event. The renamed one is still unused so it's valid.
  await page.goto(`${ADMIN_URL}/events/new`, { waitUntil: "networkidle" });
  const title = `Smoke Event ${Date.now()}`;
  // startsAt is datetime-local; use ISO-like "YYYY-MM-DDTHH:MM" 1h from now
  const future = new Date(Date.now() + 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  const startsAt = `${future.getFullYear()}-${pad(future.getMonth()+1)}-${pad(future.getDate())}T${pad(future.getHours())}:${pad(future.getMinutes())}`;

  await page.fill('input[name="title"]', title);
  await page.fill('input[name="startsAt"]', startsAt);
  // pick our renamed label by visible text
  await page.selectOption('select[name="labelId"]', { label: labelRenamed.name });
  await shot(page, "15-admin-event-new-form");
  // Server action returns to /events/<id> via redirect on success, or
  // re-renders /events/new with field errors on failure. Wait for the
  // redirect specifically (not /events/new, which matched the old predicate).
  await Promise.all([
    page.waitForURL(
      (url) => /\/events\/[^/]+$/.test(url.pathname) && url.pathname !== "/events/new",
      { timeout: 20000 },
    ),
    page.click('button[type="submit"]'),
  ]);
  const eventId = page.url().split("/").pop().split("?")[0];
  record("pass", `created event id=${eventId} with label "${labelRenamed.name}"`);
  await shot(page, "16-admin-event-detail");

  // Publish so the member's public route can render it.
  const publishBtn = page.locator('button:has-text("Publish")').first();
  if (await publishBtn.count()) {
    await publishBtn.click();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);
    await shot(page, "16b-admin-event-published");
    record("pass", `published event ${eventId}`);
  } else {
    record("warn", "no Publish button on event detail; member visit will likely 404");
  }

  return { eventId, title };
}

// ---- Member: see the badge on the created event ----
async function memberSeeBadge(page, eventId, title) {
  await page.goto(`${MEMBER_URL}/events/${eventId}`, { waitUntil: "networkidle" });
  const html = await page.content();
  const hasTitle = html.includes(title);
  const hasBadge = html.includes(labelRenamed.name);
  await shot(page, "06-member-event-detail-badge");
  if (hasTitle && hasBadge) {
    record("pass", `member /events/${eventId} shows title + label badge "${labelRenamed.name}"`);
  } else {
    record("fail", "member event detail missing title or badge", { hasTitle, hasBadge });
  }
}

// ---- Cookie isolation ----
async function checkCookieIsolation(memberCtx, adminCtx) {
  const memberCookies = await memberCtx.cookies();
  const adminCookies  = await adminCtx.cookies();
  const memberOnHost = memberCookies.filter((c) => c.domain === "localhost" && c.path === "/" || c.domain === "localhost");
  // Just inspect what each context sees on its app host:
  const memHasMember = memberCookies.some((c) => c.name.startsWith("oh_member_"));
  const memHasAdmin  = memberCookies.some((c) => c.name.startsWith("oh_admin_"));
  const admHasMember = adminCookies.some((c) => c.name.startsWith("oh_member_"));
  const admHasAdmin  = adminCookies.some((c) => c.name.startsWith("oh_admin_"));
  record(
    memHasMember && !memHasAdmin ? "pass" : "fail",
    `member context cookies: oh_member_*=${memHasMember} oh_admin_*=${memHasAdmin}`,
  );
  record(
    admHasAdmin && !admHasMember ? "pass" : "fail",
    `admin  context cookies: oh_member_*=${admHasMember} oh_admin_*=${admHasAdmin}`,
  );
}

// ---- Delete an unused label (probe), then attempt to delete the in-use one ----
async function checkDeleteFlows(page) {
  await page.goto(`${ADMIN_URL}/labels`, { waitUntil: "networkidle" });
  // 1. Create an extra label that no event references and delete it.
  const unusedSlug = `${slugBase}-unused`;
  await page.fill('input[name="name"]', `Unused ${slugBase}`);
  await page.fill('input[name="slug"]', unusedSlug);
  await Promise.all([
    page.waitForLoadState("networkidle"),
    page.click('button:has-text("Add label")'),
  ]);
  page.once("dialog", (d) => d.accept());
  await page.locator("li", { hasText: unusedSlug }).first()
    .locator('button:has-text("Delete")').click();
  await page.waitForLoadState("networkidle");
  if (await page.locator(`text=${unusedSlug}`).count() === 0) {
    record("probe", `deleted unused label "${unusedSlug}" cleanly`);
  } else {
    record("fail", `deleting unused label ${unusedSlug} did not remove it`);
  }

  // 2. Attempt to delete the renamed label that the published event references.
  //    The API returns 409 ("Label is referenced by events") and the UI must
  //    surface that without removing the row.
  page.once("dialog", (d) => d.accept());
  await page.locator("li", { hasText: labelRenamed.slug }).first()
    .locator('button:has-text("Delete")').click();
  await page.waitForLoadState("networkidle");
  if (await page.locator(`text=${labelRenamed.slug}`).count() > 0) {
    record("probe", `in-use label "${labelRenamed.slug}" survived delete attempt (expected 409)`);
  } else {
    record("fail", `in-use label ${labelRenamed.slug} was deleted while referenced by an event`);
  }
  await shot(page, "17-admin-labels-after-delete-attempts");
}

// ---- main ----
(async () => {
  await mkdir(ROOT, { recursive: true });
  console.log(`Screenshots -> ${ROOT}`);
  const browser = await chromium.launch({ headless: false, slowMo: 250 });
  const memberCtx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  const adminCtx  = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  const memberPage = await memberCtx.newPage();
  const adminPage  = await adminCtx.newPage();
  memberPage.on("pageerror", (e) => console.warn(`[member pageerror] ${e.message}`));
  adminPage.on("pageerror",  (e) => console.warn(`[admin pageerror]  ${e.message}`));

  let exitCode = 0;
  let createdEvent = null;
  try {
    await signUpOnMember(memberPage);
    // Grant smoke user OWNER role on house org so admin writes can proceed.
    const userId = grantHouseOwner(userEmail);
    record("probe", `granted OWNER role to user ${userId} on ${HOUSE_ORG_ID} (psql)`);
    await checkMemberDashboard(memberPage);
    await checkMemberEventsChip(memberPage);

    await signInOnAdmin(adminPage);
    await adminLabelCrud(adminPage);
    createdEvent = await adminCreateEvent(adminPage);

    await memberSeeBadge(memberPage, createdEvent.eventId, createdEvent.title);

    await checkCookieIsolation(memberCtx, adminCtx);
    await checkDeleteFlows(adminPage);
  } catch (err) {
    record("fail", `unhandled error: ${err.message}`);
    exitCode = 1;
    console.error(err.stack);
  } finally {
    console.log("\n--- SUMMARY ---");
    for (const s of steps) {
      const icon = { pass: "✅", fail: "❌", probe: "🔍", warn: "⚠️" }[s.status] || "•";
      console.log(`${icon} ${s.msg}`);
    }
    const fails = steps.filter((s) => s.status === "fail").length;
    console.log(`\n${fails === 0 ? "PASS" : `FAIL (${fails} failed steps)`}`);
    if (fails > 0) exitCode = 1;
    await browser.close();
    process.exit(exitCode);
  }
})();
