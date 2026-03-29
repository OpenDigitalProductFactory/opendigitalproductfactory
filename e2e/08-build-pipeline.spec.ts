/**
 * Full Build Pipeline e2e test — drives the AI Coworker through:
 * ideate → plan → build (sandbox) → review → ship
 *
 * This test verifies the end-to-end feature build workflow:
 * 1. Create a feature
 * 2. Coworker designs it (ideate phase)
 * 3. Coworker creates build plan (plan phase)
 * 4. Coworker generates code in sandbox (build phase)
 * 5. Coworker runs tests and deploys (review/ship phase)
 */
import { test, expect } from "@playwright/test";
import {
  loginToDPF,
  sendAndWait,
  approveAllProposals,
  waitForCoworkerIdle,
} from "./helpers";

const FEATURE_TITLE = "Invoice Processing";

test.describe("Full Build Pipeline", () => {
  test.beforeEach(async ({ page }) => {
    await loginToDPF(page);
  });

  test("drives feature from ideate through build phase with sandbox", async ({ page }) => {
    test.setTimeout(600_000); // 10 minutes

    await page.goto("/build");
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

    // Create a new feature
    const featureInput = page.locator('input[placeholder*="feature" i]');
    await expect(featureInput).toBeVisible({ timeout: 15_000 });
    await featureInput.fill(FEATURE_TITLE);
    await page.locator("button").filter({ hasText: /^New$/i }).click();

    // Wait for panel to open
    const panel = page.locator('[data-agent-panel="true"]');
    await expect(panel).toBeVisible({ timeout: 15_000 });

    // Wait for auto-message response to complete
    await waitForCoworkerIdle(page, 120_000);
    await page.waitForTimeout(2_000);
    await approveAllProposals(page);

    await page.screenshot({ path: "e2e-report/pipeline-01-ideate.png", fullPage: true });

    // Phase 1: IDEATE — Push coworker to save the design doc
    await sendAndWait(page,
      "Build it. This feature needs: 1) An invoice list page at /invoices showing all invoices with status badges, 2) A create invoice form with fields for customer name, amount, due date, and line items, 3) Invoice status tracking (draft, sent, paid, overdue). Use the existing platform patterns. Save the design doc now.",
    );
    await approveAllProposals(page);

    // Advance to plan
    await sendAndWait(page, "Review the design now and move to the plan phase.");
    await approveAllProposals(page);

    await page.screenshot({ path: "e2e-report/pipeline-02-plan.png", fullPage: true });

    // Phase 2: PLAN — Push coworker to create the build plan
    await sendAndWait(page,
      "Create the implementation plan now. Keep it simple -- 3 files: a Prisma model, a server action, and a React page component. Save the build plan.",
    );
    await approveAllProposals(page);

    // Ask for plan review to advance to build
    await sendAndWait(page, "Review the plan and advance to the build phase.");
    await approveAllProposals(page);

    await page.screenshot({ path: "e2e-report/pipeline-03-build-start.png", fullPage: true });

    // Phase 3: BUILD — Push coworker to use the sandbox
    await sendAndWait(page,
      "Start building in the sandbox now. Generate the invoice page component first.",
      180_000,
    );
    await approveAllProposals(page);

    await page.screenshot({ path: "e2e-report/pipeline-04-sandbox.png", fullPage: true });

    // Ask coworker to continue building
    await sendAndWait(page,
      "Continue building. Generate the code, then run the tests to verify.",
      180_000,
    );
    await approveAllProposals(page);

    await page.screenshot({ path: "e2e-report/pipeline-05-tests.png", fullPage: true });

    // Get the build ID
    const buildInfo = await page.evaluate(() => {
      const pageText = document.body.innerText;
      const match = pageText.match(/FB-[A-F0-9]{8}/);
      return match ? match[0] : null;
    });

    console.log(`[pipeline] Build ID: ${buildInfo}`);
    await page.screenshot({ path: "e2e-report/pipeline-06-final.png", fullPage: true });

    console.log("[pipeline] Test complete -- check portal logs for sandbox activity");
  });
});
