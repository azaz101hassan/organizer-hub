import { defineConfig, devices } from '@playwright/test';
import { join } from 'node:path';

const repoRoot = join(__dirname, '..');

export default defineConfig({
  testDir: '.',
  testMatch: ['member/**/*.spec.ts', 'admin/**/*.spec.ts'],
  globalSetup: './global-setup.ts',
  fullyParallel: false,
  reporter: [['list'], ['html', { open: 'never' }]],
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'member',
      testDir: './member',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
        storageState: join(__dirname, '.auth', 'member.json'),
      },
    },
    {
      name: 'admin',
      testDir: './admin',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.ADMIN_ORIGIN ?? 'http://localhost:3003',
        storageState: join(__dirname, '.auth', 'admin.json'),
      },
    },
  ],
  outputDir: 'test-results',
  metadata: {
    repoRoot,
  },
});
