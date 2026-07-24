import { chromium, FullConfig } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

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
  await page.fill('input[name="password"]', resolveAdminPassword());

  // Click the Sign in button and wait for navigation away from /login
  await Promise.all([
    page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 20_000 }),
    page.click('button[type="submit"]'),
  ]);

  console.log("[global-setup] Login successful, auth state saved");
  // e2e/.auth/ is gitignored (not committed — Playwright regenerates it on every
  // run), so a fresh clone won't have the directory yet. Create it before writing.
  const authStatePath = "e2e/.auth/state.json";
  mkdirSync(dirname(authStatePath), { recursive: true });
  await context.storageState({ path: authStatePath });
  await browser.close();
}

function resolveAdminPassword(): string {
  return (
    process.env.ADMIN_PASSWORD ||
    readRootEnvValue("ADMIN_PASSWORD") ||
    process.env.DPF_ADMIN_PASSWORD ||
    "changeme123"
  );
}

function readRootEnvValue(key: string): string | null {
  const envPath = findRootEnvPath();
  if (!existsSync(envPath)) return null;

  const prefix = `${key}=`;
  const line = readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .find((entry) => entry.startsWith(prefix));

  if (!line) return null;
  return line.slice(prefix.length).trim().replace(/^["']|["']$/g, "") || null;
}

function findRootEnvPath(): string {
  const candidates = [
    resolve(process.cwd(), ".env"),
    process.env.DPF_ROOT ? resolve(process.env.DPF_ROOT, ".env") : null,
    process.platform === "win32" ? "D:\\DPF\\.env" : null,
    resolve(homedir(), "dpf", ".env"),
  ].filter((entry): entry is string => Boolean(entry));

  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}
