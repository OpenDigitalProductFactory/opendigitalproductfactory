/**
 * Build Studio Full Lifecycle Demo
 *
 * Demonstrates the complete feature build pipeline:
 * 1. Login → Navigate to Build Studio
 * 2. Create a new feature ("Customer Complaint Tracker")
 * 3. AI Coworker designs the feature (ideate phase)
 * 4. AI Coworker creates implementation plan (plan phase)
 * 5. AI Coworker generates code in sandbox (build phase)
 * 6. AI Coworker runs tests and deploys (review/ship)
 * 7. Verify the feature appears in production
 *
 * Run with: DPF_ADMIN_PASSWORD=<password> npx playwright test e2e/09-build-lifecycle-demo.spec.ts --headed
 *
 * IMPORTANT: DPF_ADMIN_PASSWORD must be set for consumer-mode installs.
 * Read it from D:\DPF\.env (ADMIN_PASSWORD field).
 */
import { test, expect } from "@playwright/test";
import {
  loginToDPF,
  sendAndWait,
  approveAllProposals,
  waitForCoworkerIdle,
  extractBuildId,
} from "./helpers";

const FEATURE_TITLE = "Customer Complaint Tracker";

test.describe("Build Studio Lifecycle Demo", () => {
  test("full feature build: create, design, plan, build, deploy, verify", async ({ page }) => {
    test.setTimeout(900_000); // 15 minutes — AI-driven tests need room

    // ━━━ Step 1: Login ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log("\n=== STEP 1: Login ===");
    await loginToDPF(page);
    await page.screenshot({ path: "e2e-report/demo-01-logged-in.png" });

    // ━━━ Step 2: Navigate to Build Studio ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log("\n=== STEP 2: Navigate to Build Studio ===");
    await page.goto("/build");
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

    const featureInput = page.locator('input[placeholder*="feature" i]');
    await expect(featureInput).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: "e2e-report/demo-02-build-studio.png" });

    // ━━━ Step 3: Create new feature ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log("\n=== STEP 3: Create Feature ===");
    await featureInput.fill(FEATURE_TITLE);
    await page.locator("button").filter({ hasText: /^New$/i }).click();

    const panel = page.locator('[data-agent-panel="true"]');
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await expect(panel.locator("text=Software Engineer").first()).toBeVisible({ timeout: 5_000 });

    // Wait for auto-message response to complete (coworker becomes idle)
    await waitForCoworkerIdle(page, 120_000);
    await page.waitForTimeout(2_000);
    await approveAllProposals(page);
    await page.screenshot({ path: "e2e-report/demo-03-feature-created.png" });

    // ━━━ Step 4: Ideate — Design the feature ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log("\n=== STEP 4: Ideate Phase ===");
    await sendAndWait(page,
      "Build it now. This feature needs: 1) A complaints list page at /complaints showing all complaints with status badges (open, investigating, resolved, closed), 2) A form to submit a new complaint with customer name, description, severity (low/medium/high/critical), and category, 3) Status tracking with timestamps. Use existing platform patterns. Save the design doc and review it.",
    );
    await approveAllProposals(page);
    await page.screenshot({ path: "e2e-report/demo-04-ideate.png" });

    // Push through design review
    await sendAndWait(page, "Approve the design. Move to the plan phase now.");
    await approveAllProposals(page);
    await page.screenshot({ path: "e2e-report/demo-05-design-reviewed.png" });

    // ━━━ Step 5: Plan — Implementation plan ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log("\n=== STEP 5: Plan Phase ===");
    await sendAndWait(page,
      "Create a simple implementation plan: one new page component at apps/web/app/(shell)/complaints/page.tsx with the list view and submit form inline. Save the plan and review it. Then start building.",
    );
    await approveAllProposals(page);
    await page.screenshot({ path: "e2e-report/demo-06-plan.png" });

    // Push through plan review
    await sendAndWait(page, "The plan looks good. Advance to the build phase.");
    await approveAllProposals(page);
    await page.screenshot({ path: "e2e-report/demo-07-plan-reviewed.png" });

    // ━━━ Step 6: Build — Generate code in sandbox ━━━━━━━━━━━━━━━━━━━━━━━
    console.log("\n=== STEP 6: Build Phase ===");
    await sendAndWait(page,
      "Generate the complaints page in the sandbox now. Then run the sandbox tests and typecheck. Save the verification output when done.",
      300_000, // 5 min — sandbox operations are slow
    );
    await approveAllProposals(page);
    await page.screenshot({ path: "e2e-report/demo-08-building.png" });

    // ━━━ Step 7: Ship ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log("\n=== STEP 7: Ship Phase ===");

    const buildId = await extractBuildId(page);
    console.log(`[demo] Build ID: ${buildId}`);

    await sendAndWait(page,
      "Deploy this feature now. Ship it.",
      180_000,
    );
    await approveAllProposals(page);
    await page.screenshot({ path: "e2e-report/demo-10-shipping.png" });

    // ━━━ Step 8: Verify in production ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log("\n=== STEP 8: Verify in Production ===");

    // 8a: Check backlog for the feature epic
    await page.goto("/ops");
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(2_000);
    const backlogText = await page.textContent("body");
    const hasBacklogItem = backlogText?.toLowerCase().includes("complaint") ?? false;
    console.log(`[demo] Feature in backlog: ${hasBacklogItem}`);
    await page.screenshot({ path: "e2e-report/demo-11-ops-backlog.png" });

    // 8b: Check inventory for the digital product
    await page.goto("/inventory");
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(2_000);
    await page.screenshot({ path: "e2e-report/demo-12-inventory.png" });

    // 8c: Check if promotion was actually triggered
    // Use the API health endpoint to verify portal is still running
    const healthResp = await page.request.get("/api/health");
    console.log(`[demo] Portal health: ${healthResp.status()}`);
    expect(healthResp.status()).toBe(200);

    // 8d: Log promotion status for manual review
    // (Promotion may or may not have completed depending on model capability)
    console.log(`[demo] Build ID: ${buildId}`);
    console.log("[demo] To verify promotion status, run:");
    console.log('[demo]   docker exec dpf-postgres-1 psql -U dpf -d dpf -c "SELECT status, \\"deployedAt\\" FROM \\"ChangePromotion\\" ORDER BY \\"createdAt\\" DESC LIMIT 1;"');
    console.log('[demo]   docker exec dpf-postgres-1 psql -U dpf -d dpf -c "SELECT \\"buildId\\", \\"filePath\\", status FROM \\"PromotionBackup\\" ORDER BY timestamp DESC LIMIT 1;"');

    await page.screenshot({ path: "e2e-report/demo-13-final.png", fullPage: true });

    console.log("\n=== DEMO COMPLETE ===");
    console.log(`Build ID: ${buildId}`);
    console.log("Screenshots saved to e2e-report/demo-*.png");
    console.log("Video saved to test-results/");
  });
});
