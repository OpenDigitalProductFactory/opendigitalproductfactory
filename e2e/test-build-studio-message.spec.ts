/**
 * Test: Build Studio message disappearance bug
 *
 * Reproduces the issue where answering a coworker question causes the message to disappear.
 */
import { test, expect } from "@playwright/test";

const ADMIN_EMAIL = "admin@dpf.local";
const ADMIN_PASSWORD = process.env.DPF_ADMIN_PASSWORD || "changeme123";

async function login(page: any) {
  await page.goto("http://localhost:3000/login");
  await page.waitForSelector('input[name="email"]', { timeout: 15_000 });

  await page.fill('input[name="email"]', ADMIN_EMAIL);
  await page.fill('input[name="password"]', ADMIN_PASSWORD);

  const submitBtn = page.locator('button[type="submit"]');
  await submitBtn.click();

  // Wait for redirect away from login
  await page.waitForURL(url => !url.pathname.includes("/login"), { timeout: 20_000 });
  console.log(`[test] Logged in as ${ADMIN_EMAIL}`);
}

test("Build Studio: Answer to coworker question should persist", async ({ page, context }) => {
  test.setTimeout(180_000);

  // Try to use existing auth state first, fall back to login if needed
  const authStatePath = "e2e/.auth/state.json";
  try {
    await context.addInitScript(() => {
      // Pre-populate auth from state
    });
  } catch {
    // Fall back to login
  }

  // Navigate to workspace first to check if already authenticated
  await page.goto("http://localhost:3000/workspace", { waitUntil: "networkidle", timeout: 15_000 }).catch(() => {});

  // If still on login, log in
  if (page.url().includes("/login")) {
    await login(page);
  }

  // Navigate to Build Studio
  await page.goto("http://localhost:3000/build");
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

  console.log("[test] Navigated to Build Studio");

  // Debug: check page title and url
  console.log(`[test] Current URL: ${page.url()}`);
  console.log(`[test] Page title: ${await page.title()}`);

  // Debug: check if setup is required
  const setupRequired = await page.locator("text=/Platform Development requires setup/i").isVisible({ timeout: 3_000 }).catch(() => false);
  if (setupRequired) {
    console.log("[test] Platform Development requires setup — skipping test");
    test.skip();
  }

  // Look for feature creation input - try multiple selectors
  let featureInput = page.locator('input[placeholder*="feature" i]');

  // If first selector doesn't work, try others
  let isVisible = await featureInput.isVisible({ timeout: 5_000 }).catch(() => false);
  if (!isVisible) {
    // Try input with different placeholder
    featureInput = page.locator('input[placeholder*="Build" i]');
    isVisible = await featureInput.isVisible({ timeout: 5_000 }).catch(() => false);
  }

  if (!isVisible) {
    // Try any input in the main area
    featureInput = page.locator('[data-build-studio="true"] input').first();
    isVisible = await featureInput.isVisible({ timeout: 5_000 }).catch(() => false);
  }

  expect(isVisible).toBeTruthy();

  // Create a feature
  await featureInput.fill("Test Feature for Message");
  const createBtn = page.locator("button").filter({ hasText: /New|Create/i }).first();
  await expect(createBtn).toBeEnabled({ timeout: 5_000 });
  await createBtn.click();

  console.log("[test] Feature created, waiting for coworker panel...");

  // Wait for coworker panel
  const panel = page.locator('[data-agent-panel="true"]');
  await expect(panel).toBeVisible({ timeout: 15_000 });

  // Wait for initial message from coworker (wait for textarea to be enabled)
  await page.waitForFunction(
    () => {
      const ta = document.querySelector('[data-agent-panel="true"] textarea') as HTMLTextAreaElement;
      return ta && !ta.disabled;
    },
    { timeout: 60_000 }
  );

  console.log("[test] Coworker idle, taking screenshot of initial state...");
  await page.screenshot({ path: "e2e-report/build-studio-before-answer.png" });

  // Get the initial message count
  const msgCountBefore = await panel.locator('[role="article"]').count();
  console.log(`[test] Initial messages: ${msgCountBefore}`);

  // Get the text content before answering (to verify it's there)
  const panelTextBefore = await panel.textContent();
  console.log(`[test] Panel text before (first 200 chars): ${panelTextBefore?.substring(0, 200)}`);

  // Answer the coworker's question
  const textarea = panel.locator("textarea");
  await textarea.fill("I would like to embed the site as-is.");

  const sendBtn = panel.locator('button:has-text("Send")').first();
  await sendBtn.click();

  console.log("[test] Answer sent, waiting for response...");

  // Wait for the textarea to become disabled (coworker is processing)
  await page.waitForFunction(
    () => {
      const ta = document.querySelector('[data-agent-panel="true"] textarea') as HTMLTextAreaElement;
      return ta && ta.disabled;
    },
    { timeout: 10_000 }
  );

  console.log("[test] Coworker is processing...");

  // Wait for textarea to be enabled again (coworker response complete)
  await page.waitForFunction(
    () => {
      const ta = document.querySelector('[data-agent-panel="true"] textarea') as HTMLTextAreaElement;
      return ta && !ta.disabled;
    },
    { timeout: 60_000 }
  );

  console.log("[test] Coworker response received, taking screenshot...");
  await page.screenshot({ path: "e2e-report/build-studio-after-answer.png" });

  // Check that our message is still visible
  const panelTextAfter = await panel.textContent();
  console.log(`[test] Panel text after (first 200 chars): ${panelTextAfter?.substring(0, 200)}`);

  // Verify the answer is in the panel
  expect(panelTextAfter).toContain("embed the site as-is");

  // Verify we got a new message from the coworker
  const msgCountAfter = await panel.locator('[role="article"]').count();
  console.log(`[test] Messages after: ${msgCountAfter}`);

  expect(msgCountAfter).toBeGreaterThan(msgCountBefore);

  console.log("[test] TEST PASSED: Message persisted and coworker responded");
});
