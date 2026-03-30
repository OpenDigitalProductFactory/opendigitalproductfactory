import { Page } from "@playwright/test";

export const ADMIN_EMAIL = "admin@dpf.local";
export const ADMIN_PASSWORD = process.env.DPF_ADMIN_PASSWORD || "changeme123";
export const BASE_URL = "http://localhost:3000";

export async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.waitForLoadState("networkidle");

  const emailInput = page.locator('input[type="email"], input[name="email"]').first();
  const passwordInput = page.locator('input[type="password"]').first();
  const submitButton = page.locator('button[type="submit"]').first();

  await emailInput.fill(ADMIN_EMAIL);
  await passwordInput.fill(ADMIN_PASSWORD);
  await submitButton.click();

  // Wait for redirect away from login
  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 10_000 });
}

export async function ensureLoggedIn(page: Page): Promise<void> {
  // Storage state is pre-loaded via playwright.config.ts globalSetup.
  // Only re-login if session has expired (redirected back to /login).
  await page.goto("/workspace");
  await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => {});
  if (page.url().includes("/login")) {
    await login(page);
  }
}
