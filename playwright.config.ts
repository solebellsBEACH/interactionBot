import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  timeout: 30_000,
  expect: {
    timeout: 5_000
  },
  use: {
    headless: false,
    viewport: { width: 1280, height: 800 },
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure'
  },
  projects: [
    {
      name: 'Chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ]
});
