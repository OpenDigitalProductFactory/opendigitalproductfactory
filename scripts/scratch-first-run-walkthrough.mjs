#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";

import { parseWalkthroughArgs } from "./lib/scratch-first-run-walkthrough-options.mjs";

const config = parseWalkthroughArgs(process.argv.slice(2));
const resultPath = path.join(config.evidencePath, "first-run-walkthrough-result.json");
const steps = [];
const artifacts = [];
const startedAt = new Date();

await mkdir(config.evidencePath, { recursive: true });

let browser;
let page;

try {
  browser = await chromium.launch({ headless: !config.headed });
  const context = await browser.newContext({
    baseURL: config.portalUrl,
    ignoreHTTPSErrors: true,
  });
  page = await context.newPage();

  await recordStep("health endpoint responds", async () => {
    const response = await page.request.get(`${config.portalUrl}/api/health`, {
      timeout: config.timeoutMs,
    });
    if (!response.ok()) {
      throw new Error(`Health endpoint returned ${response.status()}.`);
    }
    return { status: response.status() };
  });

  await recordStep("setup form is reachable on an empty install", async () => {
    await page.goto("/setup", { waitUntil: "domcontentloaded", timeout: config.timeoutMs });
    await page.locator('input[type="text"]').first().waitFor({ timeout: config.timeoutMs });
    await capture(page, "setup-form");
    const text = await compactBodyText(page);
    assertIncludes(text, "Welcome to your platform", "setup page heading");
    return { url: page.url(), textSample: text };
  });

  await recordStep("bootstrap organization and owner account", async () => {
    await page.locator('input[type="text"]').first().fill(config.orgName);
    await page.locator('input[type="email"]').first().fill(config.email);
    await page.locator('input[type="password"]').first().fill(config.password);

    const navigation = page
      .waitForURL((url) => !url.pathname.startsWith("/setup"), { timeout: Math.min(config.timeoutMs, 15_000) })
      .catch(() => null);
    await page.getByRole("button", { name: /get started/i }).click();
    await navigation;
    await continueAfterStaleSetup(page, config.timeoutMs);
    await page.waitForLoadState("domcontentloaded", { timeout: config.timeoutMs }).catch(() => {});

    const current = new URL(page.url());
    if (current.pathname.startsWith("/setup")) {
      await capture(page, "setup-still-visible");
      throw new Error("Setup form remained visible after account bootstrap.");
    }
    if (current.pathname.startsWith("/login")) {
      await capture(page, "login-after-bootstrap");
      throw new Error("First-run bootstrap redirected to login instead of keeping the new owner signed in.");
    }
    return { url: page.url(), email: config.email, passwordRecorded: false };
  });

  await recordStep("AI provider setup surface is reachable", async () => {
    await page.goto("/platform/ai/providers", { waitUntil: "domcontentloaded", timeout: config.timeoutMs });
    await expect(page.getByRole("heading", { name: /Providers & Routing/i })).toBeVisible({
      timeout: config.timeoutMs,
    });
    await capture(page, "ai-providers");
    const text = await compactBodyText(page);
    assertIncludes(text, "Providers", "provider setup section");
    return { url: page.url(), textSample: text };
  });

  await recordStep("Work Control surface is reachable after first login", async () => {
    await page.goto("/build/work", { waitUntil: "domcontentloaded", timeout: config.timeoutMs });
    await expect(page.getByRole("heading", { name: /Work Control/i })).toBeVisible({
      timeout: config.timeoutMs,
    });
    await capture(page, "work-control");
    const text = await compactBodyText(page);
    assertIncludes(text, "Active capsules", "work capsule summary");
    return { url: page.url(), textSample: text };
  });

  await writeResult("passed");
} catch (error) {
  if (page) {
    await capture(page, "failure").catch(() => {});
  }
  await writeResult("failed", error);
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await browser?.close();
}

async function recordStep(name, action) {
  const started = new Date();
  try {
    const detail = await action();
    steps.push({
      name,
      status: "passed",
      startedAt: started.toISOString(),
      completedAt: new Date().toISOString(),
      detail,
    });
  } catch (error) {
    steps.push({
      name,
      status: "failed",
      startedAt: started.toISOString(),
      completedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function capture(activePage, name) {
  const fileName = `${String(artifacts.length + 1).padStart(2, "0")}-${name}.png`;
  const filePath = path.join(config.evidencePath, fileName);
  await activePage.screenshot({ path: filePath, fullPage: true });
  artifacts.push({ name, path: filePath });
}

async function compactBodyText(activePage) {
  const text = await activePage.locator("body").innerText({ timeout: config.timeoutMs });
  return text.replace(/\s+/g, " ").trim().slice(0, 1600);
}

async function continueAfterStaleSetup(activePage, timeoutMs) {
  const current = new URL(activePage.url());
  if (!current.pathname.startsWith("/setup")) return;

  const continueLink = activePage.getByRole("link", { name: /^continue$/i });
  const visible = await continueLink
    .waitFor({ state: "visible", timeout: Math.min(timeoutMs, 15_000) })
    .then(() => true)
    .catch(() => false);

  if (visible) {
    const recoveryNavigation = activePage
      .waitForURL((url) => !url.pathname.startsWith("/setup"), { timeout: timeoutMs })
      .catch(() => null);
    await continueLink.click();
    await recoveryNavigation;
    return;
  }

  await activePage.goto("/setup", { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await activePage
    .waitForURL((url) => !url.pathname.startsWith("/setup"), { timeout: Math.min(timeoutMs, 30_000) })
    .catch(() => null);
}

function assertIncludes(text, expected, label) {
  if (!text.includes(expected)) {
    throw new Error(`Expected ${label} text to include "${expected}".`);
  }
}

async function writeResult(status, error = null) {
  const payload = {
    status,
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    portalUrl: config.portalUrl,
    orgName: config.orgName,
    email: config.email,
    passwordRecorded: false,
    evidencePath: config.evidencePath,
    currentUrl: page?.url() ?? null,
    steps,
    artifacts,
    error: error ? (error instanceof Error ? error.message : String(error)) : null,
  };
  await writeFile(resultPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}
