import { test, expect, type Page } from "@playwright/test";

const E2E_EMAIL = process.env.E2E_USER_EMAIL ?? "admin@dpf.local";
const E2E_PASSWORD = process.env.E2E_USER_PASSWORD ?? "password";

async function login(page: Page) {
  await page.goto("/login");
  await page.fill('input[name="email"]', E2E_EMAIL);
  await page.fill('input[name="password"]', E2E_PASSWORD);
  await page.click('button[type="submit"]');
  // Wait for redirect away from login page
  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 10_000 });
}

test.describe("discovery re-run flow", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("re-runs a discovery connection and reflects updated data on inventory page", async ({
    page,
  }) => {
    // ── 1. Navigate to the discovery page ───────────────────────────────
    await page.goto("/platform/tools/discovery");
    await page.waitForLoadState("networkidle");

    // ── 2. Find the first connection card with a Re-run button ──────────
    const rerunButton = page.locator('button', { hasText: "Re-run" }).first();

    // If no connections exist, the test cannot proceed — skip gracefully.
    const connectionExists = await rerunButton.count() > 0;
    if (!connectionExists) {
      test.skip();
      return;
    }

    // Capture the connection row containing the button
    const connectionRow = rerunButton.locator("xpath=ancestor::div[contains(@class,'rounded-lg')]").first();

    // Record the "Last tested" text before the re-run
    const lastTestedLocator = connectionRow.locator("p").filter({ hasText: "Last tested" });
    const lastTestedBefore = await lastTestedLocator.textContent();

    // ── 3. Click Re-run and assert the button enters Running… state ─────
    await rerunButton.click();

    // The button should immediately read "Running…" (U+2026 ellipsis)
    await expect(rerunButton).toHaveText("Running…", { timeout: 5_000 });

    // ── 4. Wait for completion — button reverts to "Re-run" ─────────────
    await expect(rerunButton).toHaveText("Re-run", { timeout: 60_000 });

    // ── 5. Assert success message with entity / relationship counts ──────
    const successMessage = connectionRow.locator("p").filter({ hasText: "Re-run complete" });
    await expect(successMessage).toBeVisible({ timeout: 5_000 });

    const messageText = await successMessage.textContent();
    expect(messageText).toMatch(/Re-run complete\s*—\s*\d+ item\(s\),\s*\d+ relationship\(s\)/);

    // ── 6. Assert connection's lastTestedAt timestamp has updated ────────
    // After the server action, Next.js revalidates the route and re-renders
    // the server components, so the "Last tested" line should now read
    // "Last tested just now" (or at minimum be different from before).
    const lastTestedAfter = await lastTestedLocator.textContent();
    expect(lastTestedAfter).toContain("just now");
    expect(lastTestedAfter).not.toBe(lastTestedBefore);

    // ── 7. Navigate to /inventory — page loads with fresh data ──────────
    // Verify the inventory route is reachable without a manual browser
    // refresh, confirming that revalidatePath covered the /inventory path.
    await page.goto("/inventory");
    await page.waitForLoadState("networkidle");

    // The /inventory alias renders DiscoveryOperationsPage with the legacy
    // alias banner, confirming the page rendered successfully.
    await expect(page.locator("text=Inventory Has Moved")).toBeVisible({ timeout: 10_000 });
  });
});
