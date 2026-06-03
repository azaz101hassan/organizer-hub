import { test, expect } from '@playwright/test';
import { join } from 'node:path';

test.describe('cookie isolation (cross-context)', () => {
  test('member and admin contexts each see only their own oh_*_ cookies', async ({ browser }) => {
    const memberStorageState = join(__dirname, '..', '.auth', 'member.json');
    const adminStorageState = join(__dirname, '..', '.auth', 'admin.json');
    const memberBaseUrl = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
    const adminBaseUrl = process.env.ADMIN_ORIGIN ?? 'http://localhost:3003';

    const memberContext = await browser.newContext({
      storageState: memberStorageState,
      baseURL: memberBaseUrl,
    });
    const adminContext = await browser.newContext({
      storageState: adminStorageState,
      baseURL: adminBaseUrl,
    });

    try {
      const memberCookies = await memberContext.cookies();
      const adminCookies = await adminContext.cookies();

      const memHasMember = memberCookies.some((c) => c.name.startsWith('oh_member_'));
      const memHasAdmin = memberCookies.some((c) => c.name.startsWith('oh_admin_'));
      const admHasMember = adminCookies.some((c) => c.name.startsWith('oh_member_'));
      const admHasAdmin = adminCookies.some((c) => c.name.startsWith('oh_admin_'));

      expect(memHasMember).toBe(true);
      expect(memHasAdmin).toBe(false);
      expect(admHasAdmin).toBe(true);
      expect(admHasMember).toBe(false);
    } finally {
      await memberContext.close();
      await adminContext.close();
    }
  });
});
