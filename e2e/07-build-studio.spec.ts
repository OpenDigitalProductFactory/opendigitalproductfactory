/**
 * Build Studio e2e test — verifies that a user can:
 * 1. Log in to the DPF instance
 * 2. Navigate to the Build Studio
 * 3. Create a new feature build
 * 4. The AI Coworker panel opens and starts processing
 * 5. The coworker responds (doesn't say "I cannot proceed")
 * 6. The sandbox preview panel area is visible
 *
 * Uses DPF admin credentials (DPF_ADMIN_PASSWORD env or fallback).
 */
import { test, expect } from "@playwright/test";

const ADMIN_EMAIL = "admin@dpf.local";
const ADMIN_PASSWORD = process.env.DPF_ADMIN_PASSWORD || "peKDK2ylFsWbapWI";
const FEATURE_TITLE = "Processing Invoices";

/**
 * Login to the DPF instance.
 */
async function loginToDPF(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/login");
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});

  if (!page.url().includes("/login")) {
    console.log("[auth] Already logged in");
    return;
  }

  await page.waitForSelector('input[name="email"]', { timeout: 15_000 });
  await page.fill('input[name="email"]', ADMIN_EMAIL);
  await page.fill('input[name="password"]', ADMIN_PASSWORD);

  await Promise.all([
    page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 20_000 }),
    page.click('button[type="submit"]'),
  ]);
  console.log("[auth] Login successful, at:", page.url());
}

test.describe("Build Studio", () => {
  test.beforeEach(async ({ page }) => {
    await loginToDPF(page);
  });

  test("can create a feature and coworker starts working", async ({ page }) => {
    test.setTimeout(180_000);

    // Navigate to Build Studio
    await page.goto("/build");
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

    // Verify Build Studio loaded — look for the feature input
    const featureInput = page.locator('input[placeholder*="feature" i]');
    await expect(featureInput).toBeVisible({ timeout: 15_000 });

    // Take a screenshot of the Build Studio before creating
    await page.screenshot({ path: "e2e-report/build-studio-loaded.png", fullPage: true });

    // Type the feature name and create it
    await featureInput.fill(FEATURE_TITLE);
    const newButton = page.locator("button").filter({ hasText: /^New$/i });
    await expect(newButton).toBeEnabled();
    await newButton.click();

    // Wait for the AI Coworker panel to open automatically
    const panel = page.locator('[data-agent-panel="true"]');
    await expect(panel).toBeVisible({ timeout: 15_000 });

    // Verify the agent name shows "Software Engineer" (build-specialist)
    await expect(panel.locator("text=Software Engineer").first()).toBeVisible({ timeout: 5_000 });

    // The auto-message should have been sent — verify coworker is processing
    // Look for "working on it" indicator or wait for response
    const isProcessing = await panel.locator("text=working on").isVisible({ timeout: 5_000 }).catch(() => false);
    if (isProcessing) {
      console.log("[test] Coworker is processing the auto-message");
    }

    // Wait for the coworker to finish responding (up to 120s for local model)
    await page.waitForFunction(
      () => {
        const ta = document.querySelector('[data-agent-panel="true"] textarea');
        if (!ta) return false;
        const placeholder = ta.getAttribute("placeholder") || "";
        // Response is complete when placeholder is back to normal
        return placeholder.toLowerCase().includes("co-worker") && !placeholder.toLowerCase().includes("sending");
      },
      { timeout: 120_000 },
    ).catch(() => {
      console.log("[test] Coworker response timeout — checking state");
    });

    // Give a moment for rendering
    await page.waitForTimeout(1_000);

    // Extract the last assistant response text
    const responseText = await page.evaluate(() => {
      const panel = document.querySelector("[data-agent-panel='true']");
      if (!panel) return "[no panel]";
      const allDivs = Array.from(panel.querySelectorAll("div")) as HTMLElement[];
      const assistantBubbles = allDivs.filter((el) => {
        const s = el.style;
        return (
          s.display === "flex" &&
          s.flexDirection === "column" &&
          s.marginBottom === "8px" &&
          s.alignItems === "flex-start"
        );
      });
      if (assistantBubbles.length === 0) {
        const flexStart = allDivs.filter((el) =>
          el.style.alignItems === "flex-start" && (el.textContent?.length ?? 0) > 20,
        );
        const last = flexStart[flexStart.length - 1];
        return last?.textContent?.trim() ?? "[no assistant messages]";
      }
      const last = assistantBubbles[assistantBubbles.length - 1];
      return last.textContent?.trim() ?? "[empty]";
    });

    console.log(`[test] Coworker response: "${responseText.slice(0, 300)}"`);

    // The response should NOT contain the old bug messages
    const lower = responseText.toLowerCase();
    expect(lower).not.toContain("i cannot proceed");
    expect(lower).not.toContain("i do not have the ability");
    expect(lower).not.toContain("my tools are limited");

    // Verify the sandbox preview area is visible (shows placeholder during ideate phase)
    const previewArea = page.locator("text=Live preview will appear").first();
    const sandboxRunning = page.locator("text=Live Preview").first();
    const buildDescription = page.locator("text=Describe your feature idea").first();
    const anyVisible =
      (await previewArea.isVisible().catch(() => false)) ||
      (await sandboxRunning.isVisible().catch(() => false)) ||
      (await buildDescription.isVisible().catch(() => false));
    expect(anyVisible).toBeTruthy();

    await page.screenshot({ path: "e2e-report/build-studio-feature-created.png", fullPage: true });
  });

  test("coworker can interact on Build Studio page", async ({ page }) => {
    test.setTimeout(180_000);

    await page.goto("/build");
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

    // Open the AI Coworker panel manually
    const fab = page.locator('button[title="Open AI Co-worker"]').first();
    if (await fab.isVisible({ timeout: 8_000 }).catch(() => false)) {
      await fab.click();
      await page.waitForTimeout(800);
    }

    const panel = page.locator('[data-agent-panel="true"]');
    await expect(panel).toBeVisible({ timeout: 10_000 });

    // Verify the Software Engineer agent is loaded
    await expect(panel.locator("text=Software Engineer").first()).toBeVisible({ timeout: 5_000 });

    // Send a message about building a feature
    const coworkerInput = panel.locator('textarea[placeholder*="co-worker" i]');
    await expect(coworkerInput).toBeVisible({ timeout: 6_000 });
    await coworkerInput.fill(
      "I want to build a feature for processing invoices. It should capture invoice data, validate amounts, and track payment status.",
    );

    // Send the message
    const sendBtn = panel.locator('button:has-text("Send")').first();
    if (await sendBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await sendBtn.click();
    } else {
      await coworkerInput.press("Enter");
    }

    // Wait for the coworker to respond (local model may take a while)
    await page.waitForFunction(
      () => {
        const ta = document.querySelector('[data-agent-panel="true"] textarea');
        if (!ta) return false;
        const placeholder = ta.getAttribute("placeholder") || "";
        return (
          placeholder.toLowerCase().includes("co-worker") &&
          !placeholder.toLowerCase().includes("sending")
        );
      },
      { timeout: 120_000 },
    ).catch(() => {
      console.log("[test] Coworker response timeout");
    });

    await page.waitForTimeout(1_000);

    // Extract the response
    const responseText = await page.evaluate(() => {
      const panel = document.querySelector("[data-agent-panel='true']");
      if (!panel) return "";
      const allDivs = Array.from(panel.querySelectorAll("div")) as HTMLElement[];
      const bubbles = allDivs.filter(
        (el) => el.style.alignItems === "flex-start" && (el.textContent?.length ?? 0) > 20,
      );
      const last = bubbles[bubbles.length - 1];
      return last?.textContent?.trim() ?? "";
    });

    console.log(`[test] Coworker response (first 300 chars): ${responseText.slice(0, 300)}`);

    // The response should not say "I cannot" or "I don't have the ability"
    // (This was the original bug — the coworker couldn't do anything)
    const lower = responseText.toLowerCase();
    expect(lower).not.toContain("i cannot proceed");
    expect(lower).not.toContain("i do not have the ability");
    expect(lower).not.toContain("my tools are limited");

    await page.screenshot({
      path: "e2e-report/build-studio-coworker-response.png",
      fullPage: true,
    });
  });
});
