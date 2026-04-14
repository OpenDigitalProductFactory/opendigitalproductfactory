/**
 * Build Studio lifecycle test — automated iteration loop.
 * Walks through: create → ideate → design review → plan advance.
 * Takes screenshots at every checkpoint for diagnostic review.
 * Timeouts are generous (5-10 min per phase) because the agent does real work.
 */
import { test, expect, Page } from "@playwright/test";
import {
  loginToDPF,
  waitForCoworkerIdle,
  extractLastResponse,
  sendAndWait,
} from "./helpers";

const SCREENSHOTS = "e2e-report/lifecycle";
let step = 0;

async function screenshot(page: Page, name: string) {
  step++;
  const path = `${SCREENSHOTS}/${String(step).padStart(2, "0")}-${name}.png`;
  await page.screenshot({ path, fullPage: true });
  console.log(`[screenshot] ${path}`);
}

async function getPhaseFromUI(page: Page): Promise<string> {
  return page.evaluate(() => {
    const nav = document.querySelector('nav[aria-label="Build phase progress"]');
    if (!nav) return "unknown";
    const current = nav.querySelector('[class*="current"], [aria-current]');
    if (current) {
      const label = current.closest("[class]")?.textContent?.trim();
      if (label) return label.toLowerCase();
    }
    // Fallback: find the phase with "current" in its aria description
    const items = nav.querySelectorAll("[role], [class]");
    for (const item of items) {
      const text = item.textContent?.trim() ?? "";
      const ariaLabel = item.getAttribute("aria-label") ?? "";
      if (ariaLabel.includes("current") || text.includes("current")) {
        return text.replace(/\d+/g, "").replace("current", "").trim().toLowerCase();
      }
    }
    return "unknown";
  });
}

test.describe("Build Studio Lifecycle", () => {
  test("full ideate → plan lifecycle", async ({ page }) => {
    test.setTimeout(600_000); // 10 minutes total

    // ── Step 1: Login and navigate ─────────────────────────────────
    await loginToDPF(page);
    await page.goto("/build");
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await screenshot(page, "build-studio-loaded");

    // ── Step 2: Create a simple feature ────────────────────────────
    const featureInput = page.locator('input[placeholder*="feature" i]');
    await expect(featureInput).toBeVisible({ timeout: 10_000 });
    await featureInput.fill("Add employee birthday reminder notifications");

    const newButton = page.locator("button").filter({ hasText: /^New$/i });
    await expect(newButton).toBeEnabled({ timeout: 5_000 });
    await newButton.click();
    console.log("[lifecycle] Feature created, waiting for panel...");

    // ── Step 3: Wait for coworker panel ────────────────────────────
    const panel = page.locator('[data-agent-panel="true"]');
    // If panel doesn't auto-open, click the FAB
    const panelVisible = await panel.isVisible({ timeout: 10_000 }).catch(() => false);
    if (!panelVisible) {
      const fab = page.locator('button[title="Open AI Co-worker"], button:has-text("AI Coworker")').first();
      if (await fab.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await fab.click();
        await page.waitForTimeout(1_000);
      }
    }
    await expect(panel).toBeVisible({ timeout: 15_000 });
    console.log("[lifecycle] Panel opened");

    // Erase old conversation to avoid context pollution from prior test runs.
    // With thread-per-build, new builds get a fresh thread so Erase may be disabled.
    const eraseBtn = panel.locator('button:has-text("Erase")').first();
    const eraseVisible = await eraseBtn.isVisible({ timeout: 3_000 }).catch(() => false);
    const eraseEnabled = eraseVisible && await eraseBtn.isEnabled().catch(() => false);
    if (eraseEnabled) {
      await eraseBtn.click();
      // Confirm erase if there's a dialog
      const confirmBtn = page.locator('button:has-text("Confirm"), button:has-text("Yes"), button:has-text("Erase")').last();
      if (await confirmBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await confirmBtn.click();
      }
      await page.waitForTimeout(2_000);
      console.log("[lifecycle] Conversation erased");
    }

    // Send the initial message manually (since erase cleared auto-message)
    const ta = panel.locator("textarea");
    await ta.waitFor({ state: "visible", timeout: 10_000 });
    await ta.fill("I want to build a feature: employee birthday reminder notifications. Simple background job that sends email 7 days before each employee birthday. Use existing Employee model dateOfBirth field and platform notification system. No new UI needed.");
    const sendBtn = panel.locator('button:has-text("Send")').first();
    if (await sendBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await sendBtn.click();
    } else {
      await ta.press("Enter");
    }
    console.log("[lifecycle] Initial message sent manually");

    // Wait for the auto-message response
    await waitForCoworkerIdle(page, 300_000); // 5 min for initial response
    await page.waitForTimeout(1_000);
    await screenshot(page, "initial-response");

    const initialResponse = await extractLastResponse(page);
    console.log(`[lifecycle] Initial response: ${initialResponse.slice(0, 300)}`);

    // Verify not stuck
    const lower = initialResponse.toLowerCase();
    expect(lower).not.toContain("i cannot proceed");
    expect(lower).not.toContain("i called");
    expect(lower).not.toContain("got stuck");

    // ── Step 4: Wait for background research to complete ──────────
    // The agent dispatches ideate research in the background (takes 2-5 min).
    // The agentic loop returns early ("researching...") while research runs.
    // Poll by switching to the docs view and checking for "Design Research" header.
    console.log("[lifecycle] Waiting for background research to complete (up to 6 min)...");

    // The default view is "Graph" — FeatureBriefPanel is only visible in non-graph view.
    // Click the Graph tab area to switch away, or look for a non-graph tab.
    let hasDesign = false;
    const researchDeadline = Date.now() + 360_000; // 6 min (research takes 3-5 min)
    while (Date.now() < researchDeadline) {
      // Reload to pick up any DB changes from background research
      await page.reload({ waitUntil: "networkidle", timeout: 15_000 }).catch(() => {});
      await page.waitForTimeout(2_000);

      // Switch to Details tab to see FeatureBriefPanel (design doc)
      const detailsTab = page.locator('button[role="tab"]:has-text("Details")').first();
      if (await detailsTab.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await detailsTab.click();
        await page.waitForTimeout(500);
      }

      const designHeader = page.locator("text=Design Research").first();
      hasDesign = await designHeader.isVisible({ timeout: 2_000 }).catch(() => false);
      if (hasDesign) break;

      // Also check brief (may show before design doc)
      const briefHeader = page.locator("text=Feature Brief").first();
      const hasBrief = await briefHeader.isVisible({ timeout: 1_000 }).catch(() => false);
      if (hasBrief) {
        console.log("[lifecycle] Feature Brief visible (design doc not yet saved)");
      }

      console.log(`[lifecycle] Polling... design=${hasDesign} (${Math.round((researchDeadline - Date.now()) / 1000)}s remaining)`);
      await page.waitForTimeout(10_000); // poll every ~15s total with reload
    }
    const briefHeader = page.locator("text=Feature Brief").first();
    const hasBrief = await briefHeader.isVisible({ timeout: 2_000 }).catch(() => false);
    console.log(`[lifecycle] Design doc visible: ${hasDesign}, Brief visible: ${hasBrief}`);
    await screenshot(page, "design-check");

    // ── Step 5: Refresh page and check review result ───────────────
    // The design review runs in the background after research. Reload to pick up DB changes.
    await page.reload({ waitUntil: "networkidle", timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(2_000);

    // Re-check design doc after reload
    const designAfterReload = page.locator("text=Design Research").first();
    const hasDesignAfterReload = await designAfterReload.isVisible({ timeout: 5_000 }).catch(() => false);
    console.log(`[lifecycle] Design doc after reload: ${hasDesignAfterReload}`);

    // Check for review badge — multiple text patterns
    const reviewBadge = page.locator("text=/Review:.*(Passed|Needs revision)/i").first();
    const hasReview = await reviewBadge.isVisible({ timeout: 10_000 }).catch(() => false);
    console.log(`[lifecycle] Review badge visible: ${hasReview}`);
    if (hasReview) {
      const reviewText = await reviewBadge.textContent();
      console.log(`[lifecycle] Review result: ${reviewText}`);
    }

    // Also check for critical issues block (indicates review ran and failed)
    const criticalIssues = page.locator("text=Critical issues to resolve").first();
    const hasCritical = await criticalIssues.isVisible({ timeout: 3_000 }).catch(() => false);
    console.log(`[lifecycle] Critical issues visible: ${hasCritical}`);
    await screenshot(page, "review-result");

    // ── Step 6: Extract build ID and report ────────────────────────
    const buildId = await page.evaluate(() => {
      const text = document.body.innerText;
      const match = text.match(/FB-[A-F0-9]{8}/);
      return match?.[0] ?? null;
    });

    const reviewText2 = hasReview ? await reviewBadge.textContent() : "";
    const reviewPassed = reviewText2?.includes("Passed") ?? false;

    await screenshot(page, "final-state");

    // ── REPORT ───────────────────────────────────────────────────
    console.log("\n=== IDEATE LIFECYCLE TEST SUMMARY ===");
    console.log(`Build ID:             ${buildId}`);
    console.log(`Design doc visible:   ${hasDesign}`);
    console.log(`Review badge visible: ${hasReview}`);
    console.log(`Review result:        ${reviewText2 || "not found"}`);
    console.log(`Critical issues:      ${hasCritical}`);
    console.log(`Review passed:        ${reviewPassed}`);
    console.log("=====================================\n");

    // ── ASSERTIONS ───────────────────────────────────────────────
    // The ideate cycle is complete if: design doc rendered + review ran
    expect(hasDesign, "Design Research panel should be visible").toBeTruthy();
    expect(hasReview, "Review badge should be visible after dual-LLM review").toBeTruthy();
  });
});
