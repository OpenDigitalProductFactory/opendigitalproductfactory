/**
 * Build Studio interactive driver — step-by-step lifecycle execution.
 * NOT a test — a script that drives Build Studio through each phase,
 * waits for completion, and reports status at each checkpoint.
 *
 * Usage: npx playwright test e2e/build-studio-drive.ts --project=chromium --timeout 1800000
 */
import { test, Page } from "@playwright/test";
import { loginToDPF, waitForCoworkerIdle, sendAndWait, extractLastResponse } from "./helpers";

const FEATURE = "Add a /api/v1/health endpoint that returns JSON with service status, uptime, and version";

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `e2e-report/drive/${name}.png`, fullPage: true });
  console.log(`[shot] ${name}`);
}

async function getPhase(page: Page): Promise<string> {
  return page.evaluate(() => {
    // Read from the phase indicator nav
    const nav = document.querySelector('nav[aria-label="Build phase progress"]');
    if (!nav) return "no-nav";
    const items = Array.from(nav.querySelectorAll("[aria-label]"));
    for (const item of items) {
      const label = item.getAttribute("aria-label") ?? "";
      if (label.includes("current")) return label.replace(": current", "").trim().toLowerCase();
    }
    // Fallback: check text content
    const all = nav.textContent ?? "";
    return `raw:${all.slice(0, 50)}`;
  });
}

async function waitForAgent(page: Page, timeoutMs = 300_000) {
  try {
    await waitForCoworkerIdle(page, timeoutMs);
  } catch {
    console.log(`[drive] Agent still busy after ${timeoutMs / 1000}s — continuing`);
  }
  await page.waitForTimeout(2_000);
}

test("drive build studio lifecycle", async ({ page }) => {
  test.setTimeout(1_800_000); // 30 minutes

  await loginToDPF(page);
  await page.goto("/build");
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  await shot(page, "01-loaded");

  // ── CREATE FEATURE ────────────────────────────────────────────
  console.log("\n=== PHASE: CREATE ===");
  const input = page.locator('input[placeholder*="feature" i]');
  await input.fill(FEATURE);
  await page.locator("button").filter({ hasText: /^New$/i }).click();

  const panel = page.locator('[data-agent-panel="true"]');
  const panelOpen = await panel.isVisible({ timeout: 15_000 }).catch(() => false);
  if (!panelOpen) {
    const fab = page.locator('button:has-text("AI Coworker")').first();
    if (await fab.isVisible({ timeout: 5_000 }).catch(() => false)) await fab.click();
  }
  await panel.waitFor({ state: "visible", timeout: 15_000 });
  console.log("[drive] Panel open, waiting for initial response...");

  await waitForAgent(page, 120_000);
  const initial = await extractLastResponse(page);
  console.log(`[drive] Initial: ${initial.slice(0, 200)}`);
  await shot(page, "02-initial-response");

  // ── IDEATE: WAIT FOR RESEARCH ─────────────────────────────────
  console.log("\n=== PHASE: IDEATE (research) ===");
  let phase = await getPhase(page);
  console.log(`[drive] Phase: ${phase}`);

  // Wait for design doc to appear (background research takes 3-5 min)
  console.log("[drive] Waiting for research to complete...");
  let hasDesign = false;
  const deadline = Date.now() + 420_000; // 7 min
  while (Date.now() < deadline) {
    // Click Details tab if available
    const detailsTab = page.locator('button[role="tab"]:has-text("Details")').first();
    if (await detailsTab.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await detailsTab.click();
      await page.waitForTimeout(500);
    }

    hasDesign = await page.locator("text=Design Research").first().isVisible({ timeout: 2_000 }).catch(() => false);
    if (hasDesign) break;

    // Reload to pick up background changes
    await page.reload({ waitUntil: "networkidle", timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(10_000);
    console.log(`[drive] Polling for design doc... (${Math.round((deadline - Date.now()) / 1000)}s left)`);
  }

  console.log(`[drive] Design doc visible: ${hasDesign}`);
  await shot(page, "03-design-doc");

  if (!hasDesign) {
    console.log("[drive] STUCK: No design doc after 7 min. Check portal logs.");
    return;
  }

  // ── IDEATE: REVIEW ────────────────────────────────────────────
  console.log("\n=== PHASE: IDEATE (review) ===");
  const reviewBadge = page.locator("text=/Review:.*/i").first();
  const hasReview = await reviewBadge.isVisible({ timeout: 5_000 }).catch(() => false);
  const reviewText = hasReview ? await reviewBadge.textContent() : "none";
  console.log(`[drive] Review: ${reviewText}`);
  await shot(page, "04-review-result");

  // If review failed, ask agent to fix and resubmit
  if (hasReview && reviewText?.includes("Needs revision")) {
    console.log("[drive] Review failed — asking agent to fix...");

    // Re-open panel if closed after reload
    if (!await panel.isVisible({ timeout: 3_000 }).catch(() => false)) {
      const fab = page.locator('button:has-text("AI Coworker")').first();
      if (await fab.isVisible({ timeout: 3_000 }).catch(() => false)) await fab.click();
      await panel.waitFor({ state: "visible", timeout: 10_000 });
    }

    const fixResponse = await sendAndWait(page,
      "The design review failed. Fix ALL the critical and important issues in the design document — " +
      "address timezone handling, privacy/opt-out, alternatives considered, and parameterization. " +
      "Then save the updated design doc and resubmit for review.",
      300_000,
    );
    console.log(`[drive] Fix response: ${fixResponse.slice(0, 200)}`);
    await shot(page, "05-after-fix");

    // Wait and check if review now passes
    await page.reload({ waitUntil: "networkidle", timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(3_000);
    const detailsTab2 = page.locator('button[role="tab"]:has-text("Details")').first();
    if (await detailsTab2.isVisible({ timeout: 2_000 }).catch(() => false)) await detailsTab2.click();

    const newReview = page.locator("text=/Review:.*/i").first();
    const newReviewText = await newReview.textContent().catch(() => "not found");
    console.log(`[drive] Review after fix: ${newReviewText}`);
    await shot(page, "06-review-after-fix");
  }

  // ── IDEATE → PLAN ADVANCE ────────────────────────────────────
  console.log("\n=== PHASE: ADVANCE ideate → plan ===");
  phase = await getPhase(page);
  console.log(`[drive] Current phase: ${phase}`);

  if (phase.includes("ideate")) {
    // Re-open panel
    if (!await panel.isVisible({ timeout: 3_000 }).catch(() => false)) {
      const fab = page.locator('button:has-text("AI Coworker")').first();
      if (await fab.isVisible({ timeout: 3_000 }).catch(() => false)) await fab.click();
      await panel.waitFor({ state: "visible", timeout: 10_000 });
    }

    const advResponse = await sendAndWait(page,
      "Complete all remaining intake steps (taxonomy placement, backlog item, epic) and advance to the plan phase.",
      300_000,
    );
    console.log(`[drive] Advance response: ${advResponse.slice(0, 300)}`);
    await shot(page, "07-advance-attempt");
  }

  // ── PLAN PHASE ────────────────────────────────────────────────
  await page.reload({ waitUntil: "networkidle", timeout: 15_000 }).catch(() => {});
  phase = await getPhase(page);
  console.log(`\n=== PHASE: ${phase} ===`);

  if (phase.includes("plan")) {
    if (!await panel.isVisible({ timeout: 3_000 }).catch(() => false)) {
      const fab = page.locator('button:has-text("AI Coworker")').first();
      if (await fab.isVisible({ timeout: 3_000 }).catch(() => false)) await fab.click();
      await panel.waitFor({ state: "visible", timeout: 10_000 });
    }

    const planResponse = await sendAndWait(page,
      "Create the implementation plan with specific tasks, file paths, and test-first steps. Then submit for review and advance to build.",
      300_000,
    );
    console.log(`[drive] Plan response: ${planResponse.slice(0, 300)}`);
    await shot(page, "08-plan-phase");
  }

  // ── BUILD PHASE ───────────────────────────────────────────────
  await page.reload({ waitUntil: "networkidle", timeout: 15_000 }).catch(() => {});
  phase = await getPhase(page);
  console.log(`\n=== PHASE: ${phase} ===`);

  if (phase.includes("build")) {
    console.log("[drive] Build phase! Waiting for orchestrator to complete...");
    await waitForAgent(page, 600_000); // 10 min for build
    await shot(page, "09-build-phase");
  }

  // ── REVIEW PHASE ──────────────────────────────────────────────
  await page.reload({ waitUntil: "networkidle", timeout: 15_000 }).catch(() => {});
  phase = await getPhase(page);
  console.log(`\n=== PHASE: ${phase} ===`);

  if (phase.includes("review")) {
    if (!await panel.isVisible({ timeout: 3_000 }).catch(() => false)) {
      const fab = page.locator('button:has-text("AI Coworker")').first();
      if (await fab.isVisible({ timeout: 3_000 }).catch(() => false)) await fab.click();
      await panel.waitFor({ state: "visible", timeout: 10_000 });
    }

    const reviewResponse = await sendAndWait(page,
      "Approve the build and advance to ship.",
      120_000,
    );
    console.log(`[drive] Review response: ${reviewResponse.slice(0, 300)}`);
    await shot(page, "10-review-phase");
  }

  // ── SHIP PHASE ────────────────────────────────────────────────
  await page.reload({ waitUntil: "networkidle", timeout: 15_000 }).catch(() => {});
  phase = await getPhase(page);
  console.log(`\n=== PHASE: ${phase} ===`);

  if (phase.includes("ship")) {
    if (!await panel.isVisible({ timeout: 3_000 }).catch(() => false)) {
      const fab = page.locator('button:has-text("AI Coworker")').first();
      if (await fab.isVisible({ timeout: 3_000 }).catch(() => false)) await fab.click();
      await panel.waitFor({ state: "visible", timeout: 10_000 });
    }

    const shipResponse = await sendAndWait(page,
      "Deploy the feature and create the pull request.",
      300_000,
    );
    console.log(`[drive] Ship response: ${shipResponse.slice(0, 300)}`);
    await shot(page, "11-ship-phase");
  }

  // ── FINAL STATUS ──────────────────────────────────────────────
  await page.reload({ waitUntil: "networkidle", timeout: 15_000 }).catch(() => {});
  phase = await getPhase(page);
  await shot(page, "12-final");

  console.log("\n========================================");
  console.log(`FINAL PHASE: ${phase}`);
  console.log("========================================\n");
});
