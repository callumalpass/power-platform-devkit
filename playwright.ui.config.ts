import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './test/e2e/ui',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop-electron',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
