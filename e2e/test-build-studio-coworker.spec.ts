/**
 * Test: Build Studio coworker message persistence
 *
 * Reproduces user's issue: when answering a coworker question,
 * the message disappears from the conversation.
 */
import { test, expect } from "@playwright/test";

const ADMIN_EMAIL = "admin@dpf.local";
const ADMIN_PASSWORD = process.env.DPF_ADMIN_PASSWORD || "N7YY1tktO9JOndnJ";

async function login(page: any) {
  await page.goto("http://localhost:3000/login");
  await page.waitForSelector('input[name="email"]', { timeout: 15_000 });

  await page.fill('input[name="email"]', ADMIN_EMAIL);
  await page.fill('input[name="password"]', ADMIN_PASSWORD);

  const submitBtn = page.locator('button[type="submit"]');
  await submitBtn.click();

  await page.waitForURL(url => !url.pathname.includes("/login"), { timeout: 20_000 });
  console.log(`[test] Logged in as ${ADMIN_EMAIL}`);
}

test("Build Studio: coworker message should persist after answering", async ({ page }) => {
  test.setTimeout(180_000);

  // Log in
  await login(page);

  // Navigate to Build Studio
  await page.goto("http://localhost:3000/build");
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

  console.log("[test] At Build Studio");

  // Check if setup is still active
  const setupActive = await page.evaluate(() => {
    return document.documentElement.getAttribute("data-setup-active");
  });
  console.log(`[test] Setup active: ${setupActive}`);

  // Open coworker panel
  await page.locator('button[title*="coworker" i], button[title*="ai" i]').first().click().catch(() => {});

  // Wait for coworker panel
  const panel = page.locator('[data-agent-panel="true"]');
  const isPanelOpen = await panel.isVisible({ timeout: 10_000 }).catch(() => false);

  if (!isPanelOpen) {
    console.log("[test] Panel not opening - trying to open via event");
    await page.evaluate(() => {
      document.dispatchEvent(new CustomEvent("open-agent-panel", {
        detail: { autoMessage: "Hello, can you help me understand how Build Studio works?" }
      }));
    });
  }

  // Wait for panel to be visible
  await expect(panel).toBeVisible({ timeout: 15_000 });
  console.log("[test] Coworker panel opened");

  // Wait for coworker to respond (textarea enabled)
  await page.waitForFunction(
    () => {
      const ta = document.querySelector('[data-agent-panel="true"] textarea') as HTMLTextAreaElement;
      return ta && !ta.disabled;
    },
    { timeout: 60_000 }
  );

  console.log("[test] Coworker idle");

  // Get message count before answer (try multiple selectors)
  let msgCountBefore = await panel.locator('[data-testid="agent-message"]').count();
  if (msgCountBefore === 0) {
    msgCountBefore = await panel.locator('[role="article"]').count();
  }
  if (msgCountBefore === 0) {
    msgCountBefore = await panel.locator('[class*="message"]').count();
  }
  console.log(`[test] Messages before: ${msgCountBefore}`);

  // Get panel text before
  let panelTextBefore = await panel.textContent() || "";
  console.log(`[test] Panel content before (first 300 chars): ${panelTextBefore.substring(0, 300)}`);

  // Take screenshot before answer
  await page.screenshot({ path: "e2e-report/build-studio-before.png" });

  // Answer the coworker
  const textarea = panel.locator("textarea");
  await textarea.fill("I'd like to learn more about the ideate phase.");

  console.log("[test] Looking for send button");
  const sendBtn = panel.locator('button:has-text("Send")').first();
  const btnExists = await sendBtn.isVisible({ timeout: 5_000 }).catch(() => false);
  console.log(`[test] Send button exists: ${btnExists}`);

  // Listen for console messages
  page.on('console', msg => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      console.log(`[browser ${msg.type()}] ${msg.text()}`);
    }
  });

  if (btnExists) {
    await sendBtn.click();
    console.log("[test] Send button clicked");
  } else {
    // Try to find any enabled button
    const buttons = await panel.locator("button").all();
    console.log(`[test] Found ${buttons.length} buttons, trying first enabled one`);
    for (const btn of buttons) {
      const enabled = await btn.isEnabled().catch(() => false);
      const text = await btn.textContent().catch(() => "");
      console.log(`[test]   Button: "${text}", enabled=${enabled}`);
      if (enabled) {
        await btn.click();
        console.log(`[test] Clicked button: "${text}"`);
        break;
      }
    }
  }

  // Wait for processing - check DOM state
  const maxWait = 120_000;
  const startTime = Date.now();
  let isThinking = true;

  while (isThinking && (Date.now() - startTime) < maxWait) {
    const state = await page.evaluate(() => {
      const ta = document.querySelector('[data-agent-panel="true"] textarea') as HTMLTextAreaElement;
      const thinkingIndicator = document.querySelector('[data-agent-panel="true"] [class*="thinking"]') ||
                               document.querySelector('[data-agent-panel="true"] [class*="Loading"]') ||
                               document.querySelector('[data-agent-panel="true"] [class*="processing"]');
      const isBusy = ta?.disabled;
      return {
        textareaDisabled: isBusy,
        hasThinkingIndicator: !!thinkingIndicator,
        panelHTML: document.querySelector('[data-agent-panel="true"]')?.innerHTML.substring(0, 500),
      };
    });

    console.log(`[test] DOM state: textarea=${state.textareaDisabled}, thinking=${state.hasThinkingIndicator}`);

    // Done when textarea is enabled AND no thinking indicator
    isThinking = state.textareaDisabled || state.hasThinkingIndicator;

    if (isThinking) {
      await page.waitForTimeout(1_000);
    }
  }

  console.log("[test] Response received");

  // Wait to see if messages disappear (check multiple times)
  await page.waitForTimeout(2_000);

  // Take screenshot after
  await page.screenshot({ path: "e2e-report/build-studio-after.png" });

  // Check again after 3 more seconds
  await page.waitForTimeout(3_000);
  await page.screenshot({ path: "e2e-report/build-studio-delayed.png" });

  // Get panel text after
  let panelTextAfter = await panel.textContent() || "";
  console.log(`[test] Panel content after (first 300 chars): ${panelTextAfter.substring(0, 300)}`);

  // CRITICAL TEST: The answer should still be visible
  expect(panelTextAfter).toContain("ideate phase");

  // Message count should have increased
  let msgCountAfter = await panel.locator('[data-testid="agent-message"]').count();
  if (msgCountAfter === 0) {
    msgCountAfter = await panel.locator('[role="article"]').count();
  }
  if (msgCountAfter === 0) {
    msgCountAfter = await panel.locator('[class*="message"]').count();
  }
  console.log(`[test] Messages after: ${msgCountAfter}`);
  expect(msgCountAfter).toBeGreaterThan(msgCountBefore);

  console.log("[test] ✓ PASS: Message persisted, coworker responded");
});
