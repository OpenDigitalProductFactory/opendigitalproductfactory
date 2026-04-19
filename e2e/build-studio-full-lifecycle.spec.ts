/**
 * Build Studio FULL lifecycle test — ideate → plan → build → review → ship.
 *
 * Drives the coworker through every phase transition with generous timeouts
 * and observational logging. Intended as a long-running diagnostic (~45 min),
 * not a CI gate. Run manually to surface hidden phase-gate bugs.
 *
 * Uses the same patterns as build-studio-lifecycle.spec.ts (which stops at
 * ideate) and extends forward. Polls the UI for phase badges rather than
 * asserting hard transitions, because the coworker's autonomy means each
 * phase can take 3-10 min of real work.
 *
 * Run with:
 *   DPF_ADMIN_PASSWORD=<pw> npx playwright test \
 *     --config playwright-onboarding.config.ts \
 *     e2e/build-studio-full-lifecycle.spec.ts
 */
import { test, expect, Page } from "@playwright/test";
import {
  loginToDPF,
  waitForCoworkerIdle,
  extractLastResponse,
  sendAndWait,
  extractBuildId,
  approveAllProposals,
} from "./helpers";

const SCREENSHOTS = "e2e-report/full-lifecycle";
let step = 0;

async function screenshot(page: Page, name: string): Promise<void> {
  step++;
  const path = `${SCREENSHOTS}/${String(step).padStart(2, "0")}-${name}.png`;
  await page.screenshot({ path, fullPage: true });
  console.log(`[screenshot] ${path}`);
}

async function openDetailsTab(page: Page): Promise<void> {
  const detailsTab = page.locator('button[role="tab"]:has-text("Details")').first();
  if (await detailsTab.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await detailsTab.click();
    await page.waitForTimeout(500);
  }
}

/**
 * Poll for a specific section header to appear in the details panel.
 * Returns true if the section becomes visible within the deadline.
 */
async function waitForSection(
  page: Page,
  sectionText: string,
  deadlineMs: number,
  label: string,
): Promise<boolean> {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    await page.reload({ waitUntil: "networkidle", timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(1_500);
    await openDetailsTab(page);
    const header = page.locator(`text=${sectionText}`).first();
    const visible = await header.isVisible({ timeout: 2_000 }).catch(() => false);
    if (visible) return true;
    const remaining = Math.round((deadline - Date.now()) / 1000);
    console.log(`[poll:${label}] not yet visible (${remaining}s remaining)`);
    await page.waitForTimeout(10_000);
  }
  return false;
}

async function readPhase(page: Page): Promise<string> {
  return page.evaluate(() => {
    const text = document.body.innerText;
    // Look for the phase indicator strip — phases: ideate, plan, build, review, ship
    const match = text.match(/(Ideate|Plan|Build|Review|Ship)\s+current/i)
      ?? text.match(/current[:\s]+(Ideate|Plan|Build|Review|Ship)/i);
    return match?.[1]?.toLowerCase() ?? "unknown";
  });
}

async function readReviewBadge(page: Page, label: string): Promise<{ visible: boolean; passed: boolean; text: string }> {
  const badge = page.locator(`text=/Review:.*(Passed|Needs revision|Failed)/i`).first();
  const visible = await badge.isVisible({ timeout: 5_000 }).catch(() => false);
  if (!visible) return { visible: false, passed: false, text: "" };
  const txt = (await badge.textContent()) ?? "";
  const passed = /passed/i.test(txt);
  console.log(`[review:${label}] badge="${txt.trim()}" passed=${passed}`);
  return { visible, passed, text: txt };
}

test.describe("Build Studio FULL Lifecycle", () => {
  test("ideate → plan → build → review → ship", async ({ page }) => {
    // 45 min total — every phase runs real inference
    test.setTimeout(45 * 60 * 1000);

    await loginToDPF(page);
    await page.goto("/build");
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await screenshot(page, "studio-loaded");

    // ── Phase 0: Create a simple feature ──────────────────────────────
    const featureInput = page.locator('input[placeholder*="feature" i]');
    await expect(featureInput).toBeVisible({ timeout: 10_000 });
    await featureInput.fill("Add weekly build-studio activity digest email");

    const newBtn = page.locator("button").filter({ hasText: /^New$/i });
    await expect(newBtn).toBeEnabled({ timeout: 5_000 });
    await newBtn.click();

    const panel = page.locator('[data-agent-panel="true"]');
    await expect(panel).toBeVisible({ timeout: 15_000 });
    const buildId = await extractBuildId(page);
    console.log(`[lifecycle] Created feature, buildId=${buildId}`);
    await screenshot(page, "feature-created");

    // ── Phase 1: Ideate (research + design review) ────────────────────
    console.log("[lifecycle] === PHASE 1: IDEATE ===");
    const ideateResponse = await sendAndWait(
      page,
      "A simple scheduled job that runs every Monday at 9am, queries BuildActivity rows from the prior 7 days, summarises them per build, and sends each user an email with their build activity digest. Reuses existing notification infra. No new UI needed.",
      300_000,
    );
    console.log(`[ideate] first response: ${ideateResponse.slice(0, 200)}`);

    // Wait for background research to complete (3-5 min)
    const hasDesign = await waitForSection(page, "Design Research", 360_000, "design-doc");
    console.log(`[ideate] design-doc visible: ${hasDesign}`);
    await screenshot(page, "ideate-design-doc");

    // Wait for design review to land
    await page.waitForTimeout(5_000);
    await page.reload({ waitUntil: "networkidle", timeout: 15_000 }).catch(() => {});
    await openDetailsTab(page);
    const designReview = await readReviewBadge(page, "design");
    await screenshot(page, "ideate-design-review");

    if (!designReview.passed) {
      // If the review failed, ask the agent to revise + re-run. May loop
      // a few times in real runs; cap attempts.
      for (let attempt = 1; attempt <= 3; attempt++) {
        console.log(`[ideate] design-review failed — asking for revision (attempt ${attempt})`);
        await sendAndWait(page, "Address the review feedback and re-run the design review.", 300_000);
        await page.waitForTimeout(3_000);
        await page.reload({ waitUntil: "networkidle", timeout: 15_000 }).catch(() => {});
        await openDetailsTab(page);
        const again = await readReviewBadge(page, `design-retry-${attempt}`);
        if (again.passed) break;
      }
    }

    // ── Phase 2: Plan ─────────────────────────────────────────────────
    console.log("[lifecycle] === PHASE 2: PLAN ===");
    const phaseAfterIdeate = await readPhase(page);
    console.log(`[lifecycle] phase after ideate: ${phaseAfterIdeate}`);

    // Nudge the agent to draft the plan
    await sendAndWait(page, "Draft the implementation plan.", 300_000);
    const hasPlan = await waitForSection(page, "Build Plan", 300_000, "plan-doc");
    console.log(`[plan] plan-doc visible: ${hasPlan}`);
    await screenshot(page, "plan-doc");

    await page.waitForTimeout(5_000);
    await page.reload({ waitUntil: "networkidle", timeout: 15_000 }).catch(() => {});
    await openDetailsTab(page);
    const planReview = await readReviewBadge(page, "plan");
    await screenshot(page, "plan-review");

    if (!planReview.passed) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        console.log(`[plan] plan-review failed — asking for revision (attempt ${attempt})`);
        await sendAndWait(page, "Address the plan review feedback and re-run the plan review.", 300_000);
        await page.waitForTimeout(3_000);
        await page.reload({ waitUntil: "networkidle", timeout: 15_000 }).catch(() => {});
        await openDetailsTab(page);
        const again = await readReviewBadge(page, `plan-retry-${attempt}`);
        if (again.passed) break;
      }
    }

    // ── Phase 3: Build (task execution) ───────────────────────────────
    console.log("[lifecycle] === PHASE 3: BUILD ===");
    const phaseAfterPlan = await readPhase(page);
    console.log(`[lifecycle] phase after plan: ${phaseAfterPlan}`);

    // Build phase: the agent dispatches tasks. Approve any file-change proposals.
    await sendAndWait(page, "Execute the plan. Dispatch the build tasks.", 600_000);
    await page.waitForTimeout(3_000);

    // Approve any pending file-change proposals; drive loop up to 10 rounds.
    for (let round = 1; round <= 10; round++) {
      await page.reload({ waitUntil: "networkidle", timeout: 15_000 }).catch(() => {});
      const approved = await approveAllProposals(page, 300_000);
      console.log(`[build] round ${round}: approved ${approved} proposals`);
      if (approved === 0) break;
      await page.waitForTimeout(5_000);
    }
    await screenshot(page, "build-after-proposals");

    // ── Phase 4: Review (critic) ──────────────────────────────────────
    console.log("[lifecycle] === PHASE 4: REVIEW ===");
    await sendAndWait(page, "Run the code review and summarise the critic's findings.", 600_000);
    await page.waitForTimeout(3_000);
    await screenshot(page, "code-review");

    // ── Phase 5: Ship ─────────────────────────────────────────────────
    console.log("[lifecycle] === PHASE 5: SHIP ===");
    await sendAndWait(page, "Ship this feature — open the PR.", 300_000);
    await page.waitForTimeout(3_000);
    await screenshot(page, "ship");

    const finalResponse = await extractLastResponse(page);
    console.log(`[ship] final response: ${finalResponse.slice(0, 300)}`);

    const finalPhase = await readPhase(page);
    console.log("\n=== FULL LIFECYCLE SUMMARY ===");
    console.log(`Build ID:      ${buildId}`);
    console.log(`Design doc:    ${hasDesign}`);
    console.log(`Design review: ${designReview.passed ? "passed" : "needs revision"}`);
    console.log(`Plan doc:      ${hasPlan}`);
    console.log(`Plan review:   ${planReview.passed ? "passed" : "needs revision"}`);
    console.log(`Final phase:   ${finalPhase}`);
    console.log("==============================\n");

    // Soft assertions — at minimum we expect ideate to complete.
    expect(hasDesign, "Design doc should render").toBeTruthy();
    expect(designReview.visible, "Design review badge should render").toBeTruthy();
  });
});
