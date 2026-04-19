import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for fresh-install onboarding tests.
 *
 * Differs from the default playwright.config.ts in two ways:
 *   1. No globalSetup — the onboarding test creates its own admin user
 *      via the /setup bootstrap form, so preloading a login state would
 *      break the flow.
 *   2. No storageState — the test drives auth through the onboarding UI.
 *
 * Run with: npx playwright test --config playwright-onboarding.config.ts
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: /onboarding-.*\.spec\.ts/,
  timeout: 240_000, // 4 min per test — some steps include brand extract
  retries: 0,
  workers: 1,
  reporter: [["list"], ["html", { outputFolder: "e2e-onboarding-report", open: "never" }]],
  use: {
    baseURL: "http://localhost:3000",
    headless: true,
    screenshot: "on",
    video: "retain-on-failure",
    trace: "retain-on-failure",
    ignoreHTTPSErrors: true,
    // No storageState — this test creates its own auth via bootstrap.
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
