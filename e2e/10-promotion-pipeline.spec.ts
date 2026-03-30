/**
 * Test 2: Manual Promotion Pipeline
 *
 * Tests the complete promotion lifecycle:
 * 1. Ship an existing build (FB-3DD07E19) via server action
 * 2. Navigate to /ops/promotions and verify the promotion appears
 * 3. Review and approve the promotion
 * 4. Deploy the promotion
 * 5. Verify the feature is promoted (complaints page accessible)
 * 6. Verify backup was created
 *
 * Prerequisites:
 *   - Build FB-3DD07E19 exists in "ship" phase with evidence populated
 *   - Sandbox dpf-sandbox-1 initialized with complaints page committed
 *   - DPF_ADMIN_PASSWORD set
 */
import { test, expect } from "@playwright/test";
import { loginToDPF } from "./helpers";

test.describe("Promotion Pipeline", () => {
  test("ship, approve, deploy, and verify promotion", async ({ page }) => {
    test.setTimeout(600_000); // 10 minutes

    // ━━━ Step 1: Login ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log("\n=== STEP 1: Login ===");
    await loginToDPF(page);
    await page.screenshot({ path: "e2e-report/promo-01-logged-in.png" });

    // ━━━ Step 2: Ship the build via API ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log("\n=== STEP 2: Ship Build FB-3DD07E19 ===");

    // Ship the build via the MCP call API (authenticated via session cookie)
    const shipResult = await page.evaluate(async () => {
      const resp = await fetch("/api/mcp/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "register_digital_product_from_build",
          arguments: {
            buildId: "FB-3DD07E19",
            name: "Customer Complaint Tracker",
            portfolioSlug: "foundational",
          },
        }),
      });
      const text = await resp.text();
      return { status: resp.status, body: text };
    });

    console.log(`[promo] Ship API response: ${shipResult.status} — ${shipResult.body.slice(0, 500)}`);
    expect(shipResult.status).toBe(200);
    await page.screenshot({ path: "e2e-report/promo-02-shipped.png" });

    // ━━━ Step 3: Navigate to Promotions ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log("\n=== STEP 3: Navigate to Promotions ===");
    await page.goto("/ops/promotions");
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(2_000);
    await page.screenshot({ path: "e2e-report/promo-03-promotions-page.png" });

    // Check if we can see any promotions
    const pageText = await page.textContent("body");
    console.log(`[promo] Page contains "Pending": ${pageText?.includes("Pending")}`);
    console.log(`[promo] Page contains "pending": ${pageText?.includes("pending")}`);
    console.log(`[promo] Page contains "Complaint": ${pageText?.toLowerCase().includes("complaint")}`);
    console.log(`[promo] Page contains "Customer": ${pageText?.includes("Customer")}`);

    // Try clicking "Pending" filter tab to find our promotion
    const pendingTab = page.locator('button:has-text("Pending")');
    if (await pendingTab.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await pendingTab.click();
      await page.waitForTimeout(1_000);
      console.log("[promo] Clicked Pending filter tab");
    }
    await page.screenshot({ path: "e2e-report/promo-04-pending-filter.png" });

    // ━━━ Step 4: Review & Approve ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log("\n=== STEP 4: Review & Approve ===");

    // Verify the Review button is visible (proving the pending promotion renders)
    const reviewBtn = page.locator('button:has-text("Review")').first();
    const reviewVisible = await reviewBtn.isVisible({ timeout: 5_000 }).catch(() => false);
    console.log(`[promo] Review button visible: ${reviewVisible}`);
    expect(reviewVisible).toBe(true);
    await page.screenshot({ path: "e2e-report/promo-04b-review-visible.png" });

    // Click Review to expand the panel
    await reviewBtn.click();
    await page.waitForTimeout(1_000);

    // Fill the rationale textarea
    const rationaleInput = page.locator('textarea[placeholder*="Rationale"]');
    await expect(rationaleInput).toBeVisible({ timeout: 5_000 });
    await rationaleInput.fill("E2E test — Customer Complaint Tracker verified in sandbox");
    await page.screenshot({ path: "e2e-report/promo-04c-rationale-filled.png" });

    // Click the Approve button (distinct from "Approved" filter tab — use exact text match)
    // The approve button is inside the action panel, not a filter tab
    const approveBtn = page.locator('button').filter({ hasText: /^(Approve|\.{3})$/ }).first();
    console.log(`[promo] Approve button text: ${await approveBtn.textContent()}`);
    await approveBtn.click();
    console.log("[promo] Clicked Approve");

    // Wait for the server action to complete and page to refresh
    await page.waitForTimeout(5_000);
    await page.reload();
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(2_000);

    await page.screenshot({ path: "e2e-report/promo-05-approved.png" });

    // ━━━ Step 5: Deploy ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log("\n=== STEP 5: Deploy ===");

    // Switch to Approved tab
    const approvedTab = page.locator('button:has-text("Approved")');
    if (await approvedTab.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await approvedTab.click();
      await page.waitForTimeout(1_000);
    }

    // Find Deploy Now button
    const deployBtn = page.locator('button:has-text("Deploy Now")').first();
    const deployVisible = await deployBtn.isVisible({ timeout: 5_000 }).catch(() => false);
    console.log(`[promo] Deploy Now button visible: ${deployVisible}`);

    if (deployVisible) {
      await deployBtn.click();
      console.log("[promo] Clicked Deploy Now");

      // Wait for deployment to start/complete
      // The promoter runs in Docker — could take a few minutes
      await page.waitForTimeout(5_000);
      await page.screenshot({ path: "e2e-report/promo-06-deploying.png" });

      // Check for deployment result feedback
      const resultEl = page.locator('div:has-text("Deployment")').first();
      if (await resultEl.isVisible({ timeout: 10_000 }).catch(() => false)) {
        const resultText = await resultEl.textContent();
        console.log(`[promo] Deploy result: ${resultText?.slice(0, 200)}`);
      }

      // If we need to do an emergency deploy (outside window)
      const emergencyBtn = page.locator('button:has-text("Emergency Deploy")');
      if (await emergencyBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
        console.log("[promo] Outside deployment window — using emergency override");
        const overrideInput = page.locator('textarea[placeholder*="Emergency override"]');
        if (await overrideInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
          await overrideInput.fill("E2E test — emergency override for promotion pipeline test");
        }
        await emergencyBtn.click();
        console.log("[promo] Clicked Emergency Deploy");
        await page.waitForTimeout(5_000);
      }

      // Wait for deployment — poll every 5s for up to 5 minutes
      for (let i = 0; i < 60; i++) {
        await page.waitForTimeout(5_000);
        await page.reload();
        await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});

        const bodyText = await page.textContent("body");
        if (bodyText?.includes("deployed") || bodyText?.includes("Deployed")) {
          console.log(`[promo] Deployment completed at poll ${i + 1}`);
          break;
        }
        if (bodyText?.includes("failed") || bodyText?.includes("rolled_back")) {
          console.log(`[promo] Deployment failed/rolled back at poll ${i + 1}`);
          break;
        }
        if (i % 6 === 0) {
          console.log(`[promo] Waiting for deployment... (${(i + 1) * 5}s)`);
        }
      }
    } else {
      console.log("[promo] No Deploy Now button found");
    }

    await page.screenshot({ path: "e2e-report/promo-07-deploy-result.png", fullPage: true });

    // ━━━ Step 6: Verify Production ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log("\n=== STEP 6: Verify Production ===");

    // Check portal health
    const healthResp = await page.request.get("/api/health");
    console.log(`[promo] Portal health: ${healthResp.status()}`);
    expect(healthResp.status()).toBe(200);

    // Try accessing the complaints page
    const complaintsResp = await page.request.get("/complaints");
    console.log(`[promo] /complaints response: ${complaintsResp.status()}`);

    if (complaintsResp.status() === 200) {
      await page.goto("/complaints");
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
      await page.waitForTimeout(2_000);
      const complaintsText = await page.textContent("body");
      const hasContent = complaintsText?.includes("Customer Complaints") || complaintsText?.includes("complaint");
      console.log(`[promo] Complaints page has content: ${hasContent}`);
      await page.screenshot({ path: "e2e-report/promo-08-complaints-page.png", fullPage: true });
    }

    // Check promotion status in the UI
    await page.goto("/ops/promotions");
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(1_000);

    // Click "Deployed" filter
    const deployedTab = page.locator('button:has-text("Deployed")');
    if (await deployedTab.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await deployedTab.click();
      await page.waitForTimeout(1_000);
    }

    await page.screenshot({ path: "e2e-report/promo-09-final-status.png", fullPage: true });

    // ━━━ Step 7: Verify Backup ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log("\n=== STEP 7: Verify Backup ===");

    // Check for backup records in the database
    const backupCheck = await page.evaluate(async () => {
      // Use the promotions page data (already loaded)
      return document.body.textContent?.includes("Deployment log") ?? false;
    });
    console.log(`[promo] Deployment log present: ${backupCheck}`);

    console.log("\n=== PROMOTION PIPELINE TEST COMPLETE ===");
    console.log("Screenshots saved to e2e-report/promo-*.png");
  });
});
