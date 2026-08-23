import { chromium, FullConfig } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

/**
 * Runs once before all tests. Logs in and saves auth storage state
 * so individual tests don't need to re-authenticate.
 */
export default async function globalSetup(_config: FullConfig) {
  const login = resolveE2eLoginConfig();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(`${login.baseUrl}/login`);
  // Wait for Next.js to hydrate the form
  await page.waitForSelector('input[name="email"]', { timeout: 15_000 });

  await page.fill('input[name="email"]', login.email);
  await page.fill('input[name="password"]', login.password);

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

export function resolveE2eLoginConfig(env: NodeJS.ProcessEnv = process.env): {
  baseUrl: string;
  email: string;
  password: string;
} {
  return {
    baseUrl: (env.E2E_BASE_URL || "http://localhost:3000").replace(/\/+$/, ""),
    email: env.E2E_USER_EMAIL || "admin@dpf.local",
    password: env.E2E_USER_PASSWORD || resolveAdminPassword(env),
  };
}

function resolveAdminPassword(env: NodeJS.ProcessEnv): string {
  return (
    env.ADMIN_PASSWORD ||
    readRootEnvValue("ADMIN_PASSWORD") ||
    env.DPF_ADMIN_PASSWORD ||
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
