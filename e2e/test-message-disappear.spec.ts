/**
 * Reproduce: Message disappears after answering coworker question in Build Studio.
 *
 * Steps:
 * 1. Log in
 * 2. Create a feature
 * 3. Coworker asks a question
 * 4. User answers the question
 * 5. Check if the message/response persists
 */
import { test, expect } from "@playwright/test";
import { loginToDPF, waitForCoworkerIdle, sendAndWait } from "./helpers";

test("Build Studio: message should persist after answering coworker question", async ({ page }) => {
  test.setTimeout(180_000);

  await loginToDPF(page);

  // Navigate to Build Studio
  await page.goto("/build");
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

  // Create a feature
  const featureInput = page.locator('input[placeholder*="feature" i]');
  await expect(featureInput).toBeVisible({ timeout: 15_000 });

  await featureInput.fill("Test Feature for Message Persistence");
  const newButton = page.locator("button").filter({ hasText: /^New$/i });
  await newButton.click();

  // Wait for coworker panel
  const panel = page.locator('[data-agent-panel="true"]');
  await expect(panel).toBeVisible({ timeout: 15_000 });

  // Wait for the coworker to ask the initial question
  await waitForCoworkerIdle(page, 60_000);

  // Take screenshot of coworker's initial question
  const messagesBeforeAnswer = await page.locator('[data-agent-panel="true"] [role="article"]').count();
  console.log(`[test] Messages before answer: ${messagesBeforeAnswer}`);
  await page.screenshot({ path: "e2e-report/before-answer.png" });

  // Send a response to the coworker's question
  const response = await sendAndWait(page, "Yes, I'd like to embed the site as-is.", 60_000);
  console.log(`[test] Response from coworker: ${response.substring(0, 100)}...`);

  // Take screenshot immediately after response
  await page.screenshot({ path: "e2e-report/after-answer.png" });

  // Count messages after — should have more than before
  const messagesAfterAnswer = await page.locator('[data-agent-panel="true"] [role="article"]').count();
  console.log(`[test] Messages after answer: ${messagesAfterAnswer}`);

  // Verify our answer is still visible in the panel
  const panelText = await panel.textContent();
  expect(panelText).toContain("embed the site as-is");

  // Verify coworker responded (new messages added)
  expect(messagesAfterAnswer).toBeGreaterThan(messagesBeforeAnswer);
});
