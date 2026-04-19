/**
 * P3: Contribution mode (hive mind) end-to-end.
 *
 * Scope of this test: validate that the contribution-mode configuration
 * path works — UI renders, fork_only saves, and the server-side policy
 * state flips off "policy_pending" so downstream tools (deploy_feature)
 * stop blocking.
 *
 * Out of scope here: actual upstream PR creation. That path requires a
 * real GitHub token + fork URL + accepted DCO and is covered by the
 * `submitBuildAsPR` integration tests on the backend. The "hive mind
 * round trip" (PR opened against upstream, customer attribution,
 * pseudonym) is a follow-up that depends on live GitHub credentials —
 * out of scope for an autonomous overnight run.
 *
 * Run with:
 *   DPF_ADMIN_PASSWORD=<pw> npx playwright test \
 *     --config playwright-onboarding.config.ts \
 *     e2e/onboarding-contribution-mode.spec.ts
 */
import { test, expect, type Page } from "@playwright/test";

const ADMIN_EMAIL = "admin@dpf.local";
const ADMIN_PASSWORD = process.env.DPF_ADMIN_PASSWORD || "changeme123";
const NAV_TIMEOUT_MS = 60_000;

test("P3 contribution mode: fork_only configures and unblocks policy gate", async ({ page }) => {
  test.setTimeout(3 * 60 * 1000);
  page.setDefaultTimeout(NAV_TIMEOUT_MS);

  // ── Sign in ───────────────────────────────────────────────────────────
  await page.goto("/login");
  await page.waitForSelector('input[name="email"]', { timeout: 15_000 });
  await page.fill('input[name="email"]', ADMIN_EMAIL);
  await page.fill('input[name="password"]', ADMIN_PASSWORD);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: NAV_TIMEOUT_MS }),
    page.click('button[type="submit"]'),
  ]);

  // ── Open Platform Development ─────────────────────────────────────────
  await page.goto("/admin/platform-development");
  await page.waitForLoadState("networkidle").catch(() => {});
  await expect(page).toHaveURL(/\/admin\/platform-development/);

  // ── Select fork_only mode ─────────────────────────────────────────────
  const forkRadio = page.locator('input[type="radio"][value="fork_only"]').first();
  await forkRadio.waitFor({ state: "visible", timeout: 15_000 });
  if (!(await forkRadio.isChecked().catch(() => false))) {
    await forkRadio.check();
  }

  // ── Save ──────────────────────────────────────────────────────────────
  // Click the Save button associated with the fork_only panel. There may
  // be multiple Save buttons on the page (per-mode) — we want the one in
  // the currently-visible fork_only section.
  const forkSave = page
    .getByRole("button", { name: /save/i })
    .filter({ hasNotText: /draft/i })
    .first();
  if (await forkSave.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await forkSave.click();
    await page.waitForTimeout(2_000);
  } else {
    // Alternate path: the component auto-saves on radio change. Verify via
    // a visible "Saved" or similar indicator, or just continue.
    console.log("[P3] No Save button visible — may be auto-saved on radio change");
  }

  // ── Verify via the API / server state ─────────────────────────────────
  // Fetch /admin/platform-development again — the form should now render
  // `fork_only` as the current mode (checked on reload).
  await page.reload({ waitUntil: "networkidle" });
  const persistedForkRadio = page.locator('input[type="radio"][value="fork_only"]').first();
  await persistedForkRadio.waitFor({ state: "visible", timeout: 15_000 });
  await expect(
    persistedForkRadio,
    "fork_only should remain checked after reload (persisted to DB)",
  ).toBeChecked({ timeout: 5_000 });

  // ── Verify the policy gate is open ────────────────────────────────────
  // The PlatformDevelopmentForm rerenders based on `policyState`. Any
  // non-policy_pending state is fine for this test — we just need the
  // gate to be off so Build Studio's ship phase isn't blocked.
  const pendingBanner = page.getByText(/policy.*pending|not configured/i).first();
  const isPending = await pendingBanner.isVisible({ timeout: 2_000 }).catch(() => false);
  expect(isPending, "After selecting fork_only, the policy_pending banner should be gone").toBeFalsy();

  console.log("[P3] Contribution mode configured (fork_only) and policy gate is open");
});
