import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 0,
  workers: 1, // serial — portal has shared DB state
  globalSetup: "./e2e/global-setup.ts",
  reporter: [["list"], ["html", { outputFolder: "e2e-report", open: "never" }]],
  use: {
    baseURL: "http://localhost:3000",
    headless: true,
    screenshot: "on",
    video: "retain-on-failure",
    trace: "retain-on-failure",
    ignoreHTTPSErrors: true,
    storageState: "e2e/.auth/state.json",
  },
  projects: [
    {
      name: "chromium",
      // ai-routing specs run under their own projects; the storefront owner
      // and catalog mobile smokes run only under the 390px project below.
      testIgnore: [
        /.*ai-routing-.*\.spec\.ts/,
        /.*storefront-owner-mobile\.spec\.ts/,
        /.*coworker-catalog-mobile\.spec\.ts/,
      ],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // Phone-width usability contracts. Same seeded-admin auth as the desktop
      // project, viewport pinned to 390x844.
      name: "mobile-390",
      testMatch:
        /.*(?:storefront-owner-mobile|coworker-catalog-mobile|self-upgrade-purpose)\.spec\.ts/,
      use: {
        ...devices["iPhone 13"],
        storageState: "e2e/.auth/state.json",
      },
    },
    {
      name: "build-studio",
      testMatch: /.*ai-routing-build-studio\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/state.json" },
    },
    {
      name: "discovery",
      testMatch: /.*ai-routing-discovery\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/state.json" },
    },
    {
      name: "ops-backlog",
      testMatch: /.*ai-routing-ops-backlog\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/state.json" },
    },
  ],
});
