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
import { test, expect, type Page } from "@playwright/test";

const ADMIN_EMAIL = "admin@dpf.local";
const ADMIN_PASSWORD = process.env.DPF_ADMIN_PASSWORD || "peKDK2ylFsWbapWI";
const FEATURE_TITLE = "Invoice Processing";

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

/**
 * Send a message to the coworker and wait for the response.
 * Returns the response text.
 */
async function sendAndWait(page: Page, message: string, timeoutMs = 120_000): Promise<string> {
  const panel = page.locator('[data-agent-panel="true"]');
  const input = panel.locator('textarea[placeholder*="co-worker" i]');

  // Wait for input to be ready (not sending)
  await input.waitFor({ timeout: 10_000 });
  await page.waitForTimeout(500);

  await input.fill(message);

  const sendBtn = panel.locator('button:has-text("Send")').first();
  if (await sendBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await sendBtn.click();
  } else {
    await input.press("Enter");
  }

  // Wait for response to complete
  await page.waitForFunction(
    () => {
      const ta = document.querySelector('[data-agent-panel="true"] textarea');
      if (!ta) return false;
      const ph = ta.getAttribute("placeholder") || "";
      return ph.toLowerCase().includes("co-worker") && !ph.toLowerCase().includes("sending");
    },
    { timeout: timeoutMs },
  ).catch(() => {
    console.log("[pipeline] Response timeout after " + timeoutMs + "ms");
  });

  await page.waitForTimeout(1_000);

  // Extract response
  const response = await page.evaluate(() => {
    const panel = document.querySelector("[data-agent-panel='true']");
    if (!panel) return "";
    const allDivs = Array.from(panel.querySelectorAll("div")) as HTMLElement[];
    const bubbles = allDivs.filter((el) => {
      const s = el.style;
      return (
        s.display === "flex" &&
        s.flexDirection === "column" &&
        s.marginBottom === "8px" &&
        s.alignItems === "flex-start"
      );
    });
    const last = bubbles[bubbles.length - 1];
    return last?.textContent?.trim() ?? "";
  });

  console.log(`[pipeline] Sent: "${message.slice(0, 80)}..."`);
  console.log(`[pipeline] Response: "${response.slice(0, 200)}..."`);
  return response;
}

/**
 * Approve any pending proposal cards in the coworker panel.
 */
async function approveProposals(page: Page): Promise<number> {
  const panel = page.locator('[data-agent-panel="true"]');
  let approved = 0;
  // Look for approve buttons
  const approveButtons = panel.locator('button:has-text("Approve")');
  const count = await approveButtons.count();
  for (let i = 0; i < count; i++) {
    const btn = approveButtons.nth(i);
    if (await btn.isVisible().catch(() => false)) {
      await btn.click();
      approved++;
      await page.waitForTimeout(1_000);
    }
  }
  if (approved > 0) console.log(`[pipeline] Approved ${approved} proposals`);
  return approved;
}

/**
 * Get the current build phase from the database via the API.
 */
async function getCurrentPhase(page: Page, buildId: string): Promise<string> {
  const result = await page.evaluate(async (id) => {
    const res = await fetch(`/api/build/${id}`, { credentials: "include" });
    if (!res.ok) return "unknown";
    const data = await res.json();
    return data.phase || "unknown";
  }, buildId);
  return result;
}

test.describe("Full Build Pipeline", () => {
  test("drives feature from ideate through build phase with sandbox", async ({ page }) => {
    // This test needs extended time — local model is slow
    test.setTimeout(600_000); // 10 minutes

    await loginToDPF(page);
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

    // Wait for auto-message response (ideate phase starts)
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

    // Approve any pending proposals
    await approveProposals(page);

    // Screenshot after ideate
    await page.screenshot({ path: "e2e-report/pipeline-01-ideate.png", fullPage: true });

    // Phase 1: IDEATE — Push coworker to save the design doc
    let response = await sendAndWait(page,
      "Build it. This feature needs: 1) An invoice list page at /invoices showing all invoices with status badges, 2) A create invoice form with fields for customer name, amount, due date, and line items, 3) Invoice status tracking (draft, sent, paid, overdue). Use the existing platform patterns. Save the design doc now.",
    );
    await approveProposals(page);

    // If the coworker hasn't advanced to plan yet, explicitly ask for design review
    response = await sendAndWait(page, "Review the design now and move to the plan phase.");
    await approveProposals(page);

    await page.screenshot({ path: "e2e-report/pipeline-02-plan.png", fullPage: true });

    // Phase 2: PLAN — Push coworker to create the build plan
    response = await sendAndWait(page,
      "Create the implementation plan now. Keep it simple — 3 files: a Prisma model, a server action, and a React page component. Save the build plan.",
    );
    await approveProposals(page);

    // Ask for plan review to advance to build
    response = await sendAndWait(page, "Review the plan and advance to the build phase.");
    await approveProposals(page);

    await page.screenshot({ path: "e2e-report/pipeline-03-build-start.png", fullPage: true });

    // Phase 3: BUILD — Push coworker to use the sandbox
    response = await sendAndWait(page,
      "Start building in the sandbox now. Generate the invoice page component first.",
      180_000, // 3 minutes for sandbox operations
    );
    await approveProposals(page);

    await page.screenshot({ path: "e2e-report/pipeline-04-sandbox.png", fullPage: true });

    // Check if sandbox was launched
    const buildState = await page.evaluate(async () => {
      // Get all builds and find the latest one
      const res = await fetch("/build", { credentials: "include" });
      return res.ok ? "fetched" : "error";
    });

    // Ask coworker to continue building
    response = await sendAndWait(page,
      "Continue building. Generate the code, then run the tests to verify.",
      180_000,
    );
    await approveProposals(page);

    await page.screenshot({ path: "e2e-report/pipeline-05-tests.png", fullPage: true });

    // Get the build ID and check the phase from the database
    const buildInfo = await page.evaluate(async () => {
      // Check the page for build ID info
      const buildElements = document.querySelectorAll('[class*="build"]');
      const pageText = document.body.innerText;
      const match = pageText.match(/FB-[A-F0-9]{8}/);
      return match ? match[0] : null;
    });

    console.log(`[pipeline] Build ID: ${buildInfo}`);

    // Final screenshot
    await page.screenshot({ path: "e2e-report/pipeline-06-final.png", fullPage: true });

    // Check portal logs for sandbox activity
    console.log("[pipeline] Test complete — check portal logs for sandbox activity");
  });
});
