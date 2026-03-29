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
 * Run with: npx playwright test e2e/09-build-lifecycle-demo.spec.ts -c playwright-demo.config.ts
 */
import { test, expect, type Page } from "@playwright/test";

const ADMIN_EMAIL = "admin@dpf.local";
const ADMIN_PASSWORD = process.env.DPF_ADMIN_PASSWORD || "peKDK2ylFsWbapWI";
const FEATURE_TITLE = "Customer Complaint Tracker";

async function loginToDPF(page: Page): Promise<void> {
  await page.goto("/login");
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  if (!page.url().includes("/login")) return;
  await page.waitForSelector('input[name="email"]', { timeout: 15_000 });
  await page.fill('input[name="email"]', ADMIN_EMAIL);
  await page.fill('input[name="password"]', ADMIN_PASSWORD);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 20_000 }),
    page.click('button[type="submit"]'),
  ]);
}

async function sendAndWait(page: Page, message: string, timeoutMs = 120_000): Promise<string> {
  const panel = page.locator('[data-agent-panel="true"]');
  const input = panel.locator('textarea[placeholder*="co-worker" i]');

  // Wait for input to be ready
  await input.waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1_000);

  await input.fill(message);

  const sendBtn = panel.locator('button:has-text("Send")').first();
  if (await sendBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await sendBtn.click();
  } else {
    await input.press("Enter");
  }

  // Wait for coworker to finish responding
  await page.waitForFunction(
    () => {
      const ta = document.querySelector('[data-agent-panel="true"] textarea');
      if (!ta) return false;
      const ph = ta.getAttribute("placeholder") || "";
      return ph.toLowerCase().includes("co-worker") && !ph.toLowerCase().includes("sending");
    },
    { timeout: timeoutMs },
  ).catch(() => {
    console.log("[demo] Response timeout");
  });

  await page.waitForTimeout(1_500);

  const response = await page.evaluate(() => {
    const panel = document.querySelector("[data-agent-panel='true']");
    if (!panel) return "";
    const allDivs = Array.from(panel.querySelectorAll("div")) as HTMLElement[];
    const bubbles = allDivs.filter((el) => {
      const s = el.style;
      return s.display === "flex" && s.flexDirection === "column" && s.marginBottom === "8px" && s.alignItems === "flex-start";
    });
    const last = bubbles[bubbles.length - 1];
    return last?.textContent?.trim() ?? "";
  });

  console.log(`\n[demo] >>> ${message.slice(0, 80)}`);
  console.log(`[demo] <<< ${response.slice(0, 200)}`);
  return response;
}

async function approveAllProposals(page: Page): Promise<number> {
  const panel = page.locator('[data-agent-panel="true"]');
  let approved = 0;
  const buttons = panel.locator('button:has-text("Approve")');
  const count = await buttons.count();
  for (let i = 0; i < count; i++) {
    const btn = buttons.nth(i);
    if (await btn.isVisible().catch(() => false)) {
      await btn.click();
      approved++;
      await page.waitForTimeout(2_000);
    }
  }
  if (approved > 0) console.log(`[demo] Approved ${approved} proposal(s)`);
  return approved;
}

test.describe("Build Studio Lifecycle Demo", () => {
  test("full feature build: create, design, plan, build, deploy, verify", async ({ page }) => {
    test.setTimeout(600_000); // 10 minutes

    // ━━━ Step 1: Login ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log("\n═══ STEP 1: Login ═══");
    await loginToDPF(page);
    await page.screenshot({ path: "e2e-report/demo-01-logged-in.png" });

    // ━━━ Step 2: Navigate to Build Studio ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log("\n═══ STEP 2: Navigate to Build Studio ═══");
    await page.goto("/build");
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

    const featureInput = page.locator('input[placeholder*="feature" i]');
    await expect(featureInput).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: "e2e-report/demo-02-build-studio.png" });

    // ━━━ Step 3: Create new feature ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log("\n═══ STEP 3: Create Feature ═══");
    await featureInput.fill(FEATURE_TITLE);
    await page.locator("button").filter({ hasText: /^New$/i }).click();

    const panel = page.locator('[data-agent-panel="true"]');
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await expect(panel.locator("text=Software Engineer").first()).toBeVisible({ timeout: 5_000 });

    // Wait for auto-message response
    await page.waitForFunction(
      () => {
        const ta = document.querySelector('[data-agent-panel="true"] textarea');
        if (!ta) return false;
        const ph = ta.getAttribute("placeholder") || "";
        return ph.toLowerCase().includes("co-worker") && !ph.toLowerCase().includes("sending");
      },
      { timeout: 120_000 },
    ).catch(() => {});
    await page.waitForTimeout(2_000);
    await approveAllProposals(page);
    await page.screenshot({ path: "e2e-report/demo-03-feature-created.png" });

    // ━━━ Step 4: Ideate — Design the feature ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log("\n═══ STEP 4: Ideate Phase ═══");
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
    console.log("\n═══ STEP 5: Plan Phase ═══");
    await sendAndWait(page,
      "Create a simple implementation plan: one new page component at apps/web/app/complaints/page.tsx with the list view and submit form inline. Save the plan and review it. Then start building.",
    );
    await approveAllProposals(page);
    await page.screenshot({ path: "e2e-report/demo-06-plan.png" });

    // Push through plan review
    await sendAndWait(page, "The plan looks good. Advance to the build phase.");
    await approveAllProposals(page);
    await page.screenshot({ path: "e2e-report/demo-07-plan-reviewed.png" });

    // ━━━ Step 6: Build — Generate code in sandbox ━━━━━━━━━━━━━━━━━━━━━━━
    console.log("\n═══ STEP 6: Build Phase ═══");
    await sendAndWait(page,
      "Start building now. Generate the complaints page component. Use the sandbox — generate the file at apps/web/app/complaints/page.tsx.",
      180_000,
    );
    await approveAllProposals(page);
    await page.screenshot({ path: "e2e-report/demo-08-building.png" });

    // Ask for test run
    await sendAndWait(page,
      "Run the sandbox tests and typecheck to verify the code compiles. Then save the verification output.",
      180_000,
    );
    await approveAllProposals(page);
    await page.screenshot({ path: "e2e-report/demo-09-tests.png" });

    // ━━━ Step 7: Check build state ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log("\n═══ STEP 7: Check Build State ═══");

    // Extract build ID from the page
    const buildId = await page.evaluate(() => {
      const text = document.body.innerText;
      const match = text.match(/FB-[A-F0-9]{8}/);
      return match?.[0] ?? null;
    });
    console.log(`[demo] Build ID: ${buildId}`);

    // Push toward shipping
    await sendAndWait(page,
      "Deploy this feature now. Ship it.",
      120_000,
    );
    await approveAllProposals(page);
    await page.screenshot({ path: "e2e-report/demo-10-shipping.png" });

    // ━━━ Step 8: Verify in production ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log("\n═══ STEP 8: Verify in Production ═══");

    // Navigate to the ops backlog to see the feature registered
    await page.goto("/ops");
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(2_000);
    await page.screenshot({ path: "e2e-report/demo-11-ops-backlog.png" });

    // Check if the complaint tracker appears in the backlog
    const backlogText = await page.textContent("body");
    const hasComplaintItem = backlogText?.toLowerCase().includes("complaint") ?? false;
    console.log(`[demo] Complaint tracker in backlog: ${hasComplaintItem}`);

    // Navigate to inventory to check if product was registered
    await page.goto("/inventory");
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(2_000);
    await page.screenshot({ path: "e2e-report/demo-12-inventory.png" });

    // Final screenshot
    await page.screenshot({ path: "e2e-report/demo-13-final.png", fullPage: true });

    console.log("\n═══ DEMO COMPLETE ═══");
    console.log(`Build ID: ${buildId}`);
    console.log("Screenshots saved to e2e-report/demo-*.png");
    console.log("Video saved to test-results/");
  });
});
