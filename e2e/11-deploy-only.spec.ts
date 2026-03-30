/**
 * Quick deploy test — triggers executePromotionAction on an already-approved promotion
 * and waits for the promoter to complete.
 */
import { test, expect } from "@playwright/test";
import { loginToDPF } from "./helpers";

test("deploy approved promotion and verify", async ({ page }) => {
  test.setTimeout(600_000);

  await loginToDPF(page);

  // Navigate to promotions, find and click Deploy Now for CP-4B845F8C
  await page.goto("/ops/promotions");
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(2_000);

  // Click Approved tab
  const approvedTab = page.locator('button:has-text("Approved")');
  if (await approvedTab.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await approvedTab.click();
    await page.waitForTimeout(1_000);
  }

  await page.screenshot({ path: "e2e-report/deploy-01-approved-tab.png" });

  // Click Deploy Now
  const deployBtn = page.locator('button:has-text("Deploy Now")').first();
  const visible = await deployBtn.isVisible({ timeout: 5_000 }).catch(() => false);
  console.log(`Deploy Now visible: ${visible}`);

  if (!visible) {
    // Show All tab
    const allTab = page.locator('button:has-text("All")');
    await allTab.click();
    await page.waitForTimeout(1_000);
    const bodyText = await page.textContent("body");
    console.log(`Page text includes CP-4B845F8C: ${bodyText?.includes("CP-4B845F8C")}`);
    console.log(`Page text includes approved: ${bodyText?.includes("approved")}`);
    await page.screenshot({ path: "e2e-report/deploy-01b-all-tab.png" });
    return;
  }

  await deployBtn.click();
  console.log("Clicked Deploy Now");
  await page.waitForTimeout(3_000);
  await page.screenshot({ path: "e2e-report/deploy-02-clicked.png" });

  // Check the deploy result message
  const resultText = await page.textContent("body");
  console.log(`Deploy result includes "progress": ${resultText?.includes("progress")}`);
  console.log(`Deploy result includes "started": ${resultText?.includes("started")}`);

  // Now wait for promoter to complete by polling the page
  console.log("Waiting for promoter to complete...");
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(10_000);

    // Check promoter container status
    const status = await page.evaluate(async () => {
      const r = await fetch("/api/health");
      return r.status;
    }).catch(() => 0);

    if (status === 200) {
      // Portal is still up, check if promotion status changed
      await page.goto("/ops/promotions");
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
      const text = await page.textContent("body");
      if (text?.includes("deployed")) {
        console.log(`Promotion deployed at poll ${i + 1}!`);
        break;
      }
      if (text?.includes("rolled_back")) {
        console.log(`Promotion rolled back at poll ${i + 1}`);
        break;
      }
    } else {
      console.log(`Portal down at poll ${i + 1} (promoter restarting?)`);
    }

    if (i % 3 === 0) console.log(`Still waiting... (${(i + 1) * 10}s)`);
  }

  await page.screenshot({ path: "e2e-report/deploy-03-final.png", fullPage: true });
  console.log("Deploy test complete");
});
