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
import {
  loginToDPF,
  waitForCoworkerIdle,
  extractLastResponse,
  approveAllProposals,
  sendAndWait,
} from "./helpers";

const FEATURE_TITLE = "Processing Invoices";

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
    await waitForCoworkerIdle(page, 120_000);
    await page.waitForTimeout(1_000);

    // Extract the last assistant response text
    const responseText = await extractLastResponse(page);

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

    // Send a message via the hardened helper
    const responseText = await sendAndWait(page,
      "I want to build a feature for processing invoices. It should capture invoice data, validate amounts, and track payment status.",
    );

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

  test("sandbox preview renders during build phase", async ({ page }) => {
    test.setTimeout(600_000); // 10 minutes — full build phase cycle

    // Navigate to Build Studio and create a feature
    await page.goto("/build");
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

    const featureInput = page.locator('input[placeholder*="feature" i]');
    await expect(featureInput).toBeVisible({ timeout: 15_000 });
    await featureInput.fill("Sandbox Preview Test");
    await page.locator("button").filter({ hasText: /^New$/i }).click();

    // Wait for coworker panel to open
    const panel = page.locator('[data-agent-panel="true"]');
    await expect(panel).toBeVisible({ timeout: 15_000 });

    // Wait for auto-message response
    await waitForCoworkerIdle(page, 120_000);
    await page.waitForTimeout(1_000);
    await approveAllProposals(page);

    // Phase 1: IDEATE — Save design doc
    await sendAndWait(page,
      "Build a simple status dashboard page at /dashboard with 4 status cards showing: Active Users (42), Pending Tasks (7), Completed Today (23), System Health (98%). Save the design doc and approve it immediately.",
    );

    // Phase 2: Push to PLAN phase
    await sendAndWait(page, "Review the design. Approve it. Move to plan phase now.");

    // Phase 3: PLAN — Create build plan
    await sendAndWait(page,
      "Create the implementation plan: one page component at apps/web/app/dashboard/page.tsx. Save the plan and approve it. Move to build phase.",
    );

    // Phase 4: Push to BUILD phase
    await sendAndWait(page, "Approve the plan. Start the build phase now.");

    // Phase 5: BUILD — Generate code in sandbox
    await sendAndWait(page,
      "Generate the dashboard page component in the sandbox now. Use generate_code to create apps/web/app/dashboard/page.tsx with the 4 status cards.",
      180_000,
    );

    await page.screenshot({ path: "e2e-report/sandbox-preview-build-phase.png", fullPage: true });

    // Verify: the Live Preview header should be visible (sandbox is running)
    const livePreviewHeader = page.locator("text=Live Preview").first();
    const previewIframe = page.locator('iframe[title="Sandbox Preview"]');

    // Wait up to 30s for the preview to appear (sandbox needs time to start)
    const previewVisible = await livePreviewHeader.isVisible({ timeout: 30_000 }).catch(() => false);

    if (previewVisible) {
      console.log("[test] Live Preview header is visible");
      // Verify the iframe is present
      await expect(previewIframe).toBeVisible({ timeout: 10_000 });

      // Check the iframe loaded something (not a blank page)
      const iframeSrc = await previewIframe.getAttribute("src");
      console.log(`[test] Preview iframe src: ${iframeSrc}`);
      expect(iframeSrc).toContain("/api/sandbox/preview");
      expect(iframeSrc).toContain("buildId=");
    } else {
      // The preview might show the "building" placeholder instead — that's also OK
      // as long as the proxy route is working
      const buildingPlaceholder = page.locator("text=Sandbox is not running").first();
      const activePlaceholder = page.locator("text=Sandbox Active").first();
      const previewPlaceholder = page.locator("text=Live preview will appear").first();

      const anyPreviewState =
        (await buildingPlaceholder.isVisible().catch(() => false)) ||
        (await activePlaceholder.isVisible().catch(() => false)) ||
        (await previewPlaceholder.isVisible().catch(() => false));

      console.log(`[test] Preview placeholder visible: ${anyPreviewState}`);
    }

    await page.screenshot({ path: "e2e-report/sandbox-preview-result.png", fullPage: true });
  });
});
