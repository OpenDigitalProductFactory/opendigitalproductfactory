import { chromium, FullConfig } from "@playwright/test";

/**
 * Runs once before all tests. Logs in and saves auth storage state
 * so individual tests don't need to re-authenticate.
 */
export default async function globalSetup(_config: FullConfig) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto("http://localhost:3000/login");
  // Wait for Next.js to hydrate the form
  await page.waitForSelector('input[name="email"]', { timeout: 15_000 });

  await page.fill('input[name="email"]', "admin@dpf.local");
  await page.fill('input[name="password"]', process.env.DPF_ADMIN_PASSWORD || "changeme123");

  // Click the Sign in button and wait for navigation away from /login
  await Promise.all([
    page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 20_000 }),
    page.click('button[type="submit"]'),
  ]);

  console.log("[global-setup] Login successful, auth state saved");
  await context.storageState({ path: "e2e/.auth/state.json" });
  await browser.close();
}
