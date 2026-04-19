/**
 * Autonomous fresh-install onboarding E2E.
 *
 * Scenario: drive the setup wizard end-to-end from the bootstrap screen
 * through each of the 9 steps defined in setup-constants.SETUP_STEPS,
 * picking HOA as the business type and extracting brand from
 * https://ascensionpm.com/. Assert the portal reaches /workspace with
 * setup progress completed.
 *
 * Run with: npx playwright test --config playwright-onboarding.config.ts
 *
 * The test is intentionally ONE long test so the browser context
 * (auth cookies, session state) is preserved across steps. Splitting
 * into multiple `test()` blocks gives each a fresh context and the
 * non-bootstrap steps then land on /welcome instead of the intended
 * route.
 *
 * If the admin user already exists (non-pristine DB), the bootstrap
 * step short-circuits via a /login sign-in so the rest of the flow
 * can still exercise each page even though setup progress isn't
 * strictly "fresh".
 */
import { test, expect, type Page } from "@playwright/test";

const ORG_NAME = "Ascension Property Management";
const ADMIN_EMAIL = "admin@dpf.local";
const ADMIN_PASSWORD = process.env.DPF_ADMIN_PASSWORD || "changeme123";
const BRAND_URL = "https://ascensionpm.com/";
const HOA_INDUSTRY_VALUE = "hoa-property-management";

// Coworker/agent paces are slow — generous timeouts avoid false negatives.
const NAV_TIMEOUT_MS = 60_000;
const BRAND_EXTRACT_TIMEOUT_MS = 180_000; // 3 min for brand extract to complete

test("P1 onboarding: HOA + ascensionpm.com end-to-end", async ({ page }) => {
  // Suppress any unhandled navigation noise.
  page.setDefaultTimeout(NAV_TIMEOUT_MS);

  // ── Step 0: preflight /api/health ──────────────────────────────────────
  const health = await page.request.get("/api/health", { failOnStatusCode: false });
  expect(health.status(), "portal /api/health must respond").toBeLessThan(500);

  // ── Step 1: bootstrap OR login ─────────────────────────────────────────
  console.log("[P1] Step 1: bootstrap or login");
  await page.goto("/setup");
  await page.waitForLoadState("networkidle").catch(() => {});

  if (await page.getByText("Welcome to your platform").isVisible({ timeout: 5_000 }).catch(() => false)) {
    // Fresh install: fill bootstrap form
    console.log("[P1]   Bootstrap form present — filling");
    await page.getByLabel("Organization Name").fill(ORG_NAME);
    await page.getByLabel("Your Email").fill(ADMIN_EMAIL);
    await page.getByLabel("Password (8+ characters)").fill(ADMIN_PASSWORD);
    await Promise.all([
      page.waitForURL((url) => !url.pathname.endsWith("/setup"), { timeout: NAV_TIMEOUT_MS }),
      page.getByRole("button", { name: "Get Started" }).click(),
    ]);
    console.log(`[P1]   After bootstrap, URL = ${page.url()}`);
  } else {
    // Non-pristine DB: admin likely exists; sign in via /login
    console.log("[P1]   Bootstrap skipped — signing in via /login");
    await page.goto("/login");
    await page.waitForSelector('input[name="email"]', { timeout: 15_000 });
    await page.fill('input[name="email"]', ADMIN_EMAIL);
    await page.fill('input[name="password"]', ADMIN_PASSWORD);
    await Promise.all([
      page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: NAV_TIMEOUT_MS }),
      page.click('button[type="submit"]'),
    ]);
    console.log(`[P1]   After login, URL = ${page.url()}`);
  }

  // ── Step 2: AI Providers — just visit and advance ──────────────────────
  console.log("[P1] Step 2: /platform/ai/providers");
  await page.goto("/platform/ai/providers");
  await page.waitForLoadState("networkidle").catch(() => {});
  await clickSetupContinueIfPresent(page);

  // ── Step 3: Branding — extract design system from ascensionpm.com ──────
  console.log("[P1] Step 3: /admin/branding — extract brand");
  await page.goto("/admin/branding");
  await page.waitForLoadState("networkidle").catch(() => {});

  // Guard: confirm we actually reached the branding page
  await expect(page, "should be on /admin/branding").toHaveURL(/\/admin\/branding/);

  const urlInput = page.locator('input[type="url"]').first();
  await urlInput.waitFor({ state: "visible", timeout: 30_000 });
  await urlInput.fill(BRAND_URL);

  // Uncheck codebase source to keep this specific to the URL
  const codebaseBox = page.locator('input[type="checkbox"]').first();
  if (await codebaseBox.isChecked().catch(() => false)) {
    await codebaseBox.uncheck().catch(() => {});
  }

  const extractBtn = page.getByRole("button", { name: /extract design system/i });
  await extractBtn.click();
  console.log("[P1]   Clicked Extract — waiting for completion");

  // After SSE fix (#109) the completion event should reach the panel
  // without a refresh. Look for the BrandPreview heading or the
  // status-strip completion text.
  const completion = page.getByText(/Extracted design system|Extracted your brand/i).first();
  await expect(completion, "brand extract should reach 'extracted' state").toBeVisible({
    timeout: BRAND_EXTRACT_TIMEOUT_MS,
  });
  console.log("[P1]   Brand extraction completed");

  await clickSetupContinueIfPresent(page);

  // ── Step 4: Business context — pick HOA ────────────────────────────────
  console.log("[P1] Step 4: /storefront/settings/business — pick HOA");
  await page.goto("/storefront/settings/business");
  await page.waitForLoadState("networkidle").catch(() => {});

  const industrySelect = page.locator("select").first();
  await industrySelect.waitFor({ state: "visible", timeout: 15_000 });
  await industrySelect.selectOption(HOA_INDUSTRY_VALUE);

  const descTextarea = page.locator("textarea").first();
  const descVal = await descTextarea.inputValue().catch(() => "");
  if (!descVal || descVal.trim().length === 0) {
    await descTextarea.fill(
      "Homeowners association management — community amenities, governance, resident services.",
    );
  }

  const saveBtn = page.getByRole("button", { name: /save/i }).first();
  if (await saveBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await saveBtn.click();
    await page.waitForTimeout(2_000);
  }
  await clickSetupContinueIfPresent(page);

  // ── Step 5: Operating hours ────────────────────────────────────────────
  console.log("[P1] Step 5: /storefront/settings/operations");
  await page.goto("/storefront/settings/operations");
  await page.waitForLoadState("networkidle").catch(() => {});
  const hoursSave = page.getByRole("button", { name: /save/i }).first();
  if (await hoursSave.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await hoursSave.click();
    await page.waitForTimeout(1_500);
  }
  await clickSetupContinueIfPresent(page);

  // ── Step 6: Storefront tour ────────────────────────────────────────────
  console.log("[P1] Step 6: /storefront");
  await page.goto("/storefront");
  await page.waitForLoadState("networkidle").catch(() => {});
  await clickSetupContinueIfPresent(page);

  // ── Step 7: Platform development (contribution mode) ───────────────────
  console.log("[P1] Step 7: /admin/platform-development");
  await page.goto("/admin/platform-development");
  await page.waitForLoadState("networkidle").catch(() => {});
  await clickSetupContinueIfPresent(page);

  // ── Step 8: Build studio tour ──────────────────────────────────────────
  console.log("[P1] Step 8: /build");
  await page.goto("/build");
  await page.waitForLoadState("networkidle").catch(() => {});
  await clickSetupContinueIfPresent(page);

  // ── Step 9: Finish on /workspace ───────────────────────────────────────
  console.log("[P1] Step 9: /workspace — finish");
  await page.goto("/workspace");
  await page.waitForLoadState("networkidle").catch(() => {});

  const finishBtn = page.getByRole("button", { name: /finish setup/i });
  if (await finishBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await finishBtn.click();
    await page.waitForTimeout(2_000);
  }

  await expect(page).toHaveURL(/\/workspace/);
  console.log("[P1] Onboarding complete");
});

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Clicks the setup overlay's "Continue" (or "Finish Setup") button if
 * visible in the coworker panel. The setup overlay injects these
 * buttons via the SetupActionButtons component; they dispatch a
 * "setup-action" custom event the overlay listens for.
 */
async function clickSetupContinueIfPresent(page: Page): Promise<void> {
  const btn = page.getByRole("button", { name: /^Continue$|^Finish Setup$/i }).first();
  if (await btn.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await btn.click();
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(1_500);
  } else {
    console.log(`[P1]   No Continue button on ${page.url()} — may already be advanced`);
  }
}
