import { defineConfig, devices } from "@playwright/test";

/**
 * Demo config — headed browser, slow-mo for visibility, video recording.
 * Used for demonstrating the Build Studio lifecycle.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 600_000, // 10 minutes — AI inference is slow
  retries: 0,
  workers: 1,
  reporter: [["list"], ["html", { outputFolder: "e2e-report", open: "never" }]],
  use: {
    baseURL: "http://localhost:3000",
    headless: false,  // Visible browser
    slowMo: 300,      // Slow down for visibility
    screenshot: "on",
    video: "on",      // Always record video
    trace: "on",
    ignoreHTTPSErrors: true,
    viewport: { width: 1920, height: 1080 },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1920, height: 1080 } },
    },
  ],
});
