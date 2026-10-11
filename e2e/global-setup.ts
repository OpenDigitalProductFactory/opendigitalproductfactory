import { chromium, FullConfig } from "@playwright/test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";

import { dirname } from "node:path";

/**
 * Runs once before all tests. Logs in and saves auth storage state
 * so individual tests don't need to re-authenticate.
 */
export default async function globalSetup(_config: FullConfig) {
  const login = resolveE2eLoginConfig();
  const preview = assertPreviewAuthenticationContext();
  // A previous run cannot supply source evidence for a new session.
  rmSync("e2e/.auth/preview-identity.json", { force: true });
  rmSync("e2e/.auth/state.json", { force: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    if (login.password && !preview) {
      // Explicit test credentials remain available for credential-form tests.
      await page.goto(`${login.baseUrl}/login`);
      await page.waitForSelector('input[name="email"]', { timeout: 15_000 });
      await page.fill('input[name="email"]', login.email);
      await page.fill('input[name="password"]', login.password);
      await Promise.all([
        page.waitForURL(url => !url.pathname.includes("/login"), { timeout: 20_000 }),
        page.click('button[type="submit"]'),
      ]);
    } else {
      let signInUrl = process.env.DPF_AUTOMATION_SIGN_IN_URL;
      let previewIdentity: unknown;
      if (!signInUrl) {
        const { mcpCall } = await import("../scripts/lib/mcp-client.mjs");
        const { resolveMcpCredential } = await import("../scripts/lib/mcp-credential.mjs");
        const mcpUrl = process.env.DPF_MCP_URL || "http://127.0.0.1:3000/api/mcp/v1";
        const result = await mcpCall("issue_ux_verification_sign_in", {
          nextPath: "/", reason: "UX route sweep", previewLeaseId: process.env.DPF_DEV_PORTAL_LEASE_ID,
          ownerSessionId: process.env.DPF_DEV_PORTAL_OWNER_SESSION_ID,
        }, { mcpUrl, bearerToken: resolveMcpCredential({ mcpUrl }).bearer });
        if (!result.success) throw new Error("Platform automation sign-in was refused");
        signInUrl = result.data?.url;
        previewIdentity = result.data?.previewIdentity;
      }
      assertAutomationSignInOrigin(signInUrl, login.baseUrl);
      await page.goto(signInUrl!);
      await page.waitForURL(url => url.origin === new URL(login.baseUrl).origin
        && !url.pathname.includes("/login") && !url.pathname.includes("/api/automation/sign-in"), { timeout: 20_000 });
      const session = await page.request.get(`${login.baseUrl}/api/auth/session`);
      const sessionBody = await session.json();
      if (!session.ok() || sessionBody?.user?.email !== "automation@dpf.local") throw new Error("Preview automation session was not established");
      if (previewIdentity) {
        mkdirSync("e2e/.auth", { recursive: true });
        writeFileSync("e2e/.auth/preview-identity.json", JSON.stringify(previewIdentity));
      }
    }
  console.log("[global-setup] Login successful, auth state saved");
  // e2e/.auth/ is gitignored (not committed — Playwright regenerates it on every
  // run), so a fresh clone won't have the directory yet. Create it before writing.
  const authStatePath = "e2e/.auth/state.json";
  mkdirSync(dirname(authStatePath), { recursive: true });
  await context.storageState({ path: authStatePath });
  } finally { await browser.close(); }
}

export function resolveE2eLoginConfig(env: NodeJS.ProcessEnv = process.env): {
  baseUrl: string;
  email: string;
  password: string;
} {
  const baseUrl = (env.E2E_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
  return {
    baseUrl,
    email: env.E2E_USER_EMAIL || "admin@dpf.local",
    password: new URL(baseUrl).port === "3001" || env.DPF_DEV_PORTAL_LEASE_ID ? "" : env.E2E_USER_PASSWORD || "",
  };
}

export function assertPreviewAuthenticationContext(env: NodeJS.ProcessEnv = process.env): boolean {
  const url = new URL(resolveE2eLoginConfig(env).baseUrl);
  const requested = url.port === "3001" || Boolean(env.DPF_DEV_PORTAL_LEASE_ID);
  if (requested && (!env.DPF_DEV_PORTAL_LEASE_ID || !env.DPF_DEV_PORTAL_OWNER_SESSION_ID
      || url.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(url.hostname)
      || url.port !== "3001" || url.username || url.password || url.pathname !== "/" || url.search || url.hash)) {
    throw new Error("Passwordless authentication requires the admitted preview origin, lease and owning session");
  }
  return requested;
}

export function assertAutomationSignInOrigin(signInUrl: string | undefined, baseUrl: string) {
  if (!signInUrl || new URL(signInUrl).origin !== new URL(baseUrl).origin
      || new URL(signInUrl).pathname !== "/api/automation/sign-in") {
    throw new Error("Automation session does not belong to the served preview");
  }
}
