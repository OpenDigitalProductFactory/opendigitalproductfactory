import { test, expect, type Page } from "./fixtures/dpf-test";

// BI-F0B389C9 — this PR's slice of the 390px owner-setup fix: the team/provider
// + schedule controls and the setup file inputs (the operating-hours, items and
// sections controls are handled by the sibling PR #3395; the shell/globals by
// #3392). Runs only under the `mobile-390` project (390x844, seeded-admin auth);
// see playwright.config.ts. Assertions stay scoped to controls THIS PR sizes/
// labels so the smoke doesn't depend on a sibling PR having merged first.

async function gotoOwnerRoute(page: Page, route: string): Promise<void> {
  await page.goto(route);
  await expect(page, `${route} should not bounce to welcome/login`).not.toHaveURL(
    /\/welcome|\/login/,
  );
  await page.waitForLoadState("networkidle").catch(() => {});
}

test.describe("Owner team/setup mobile usability @390px (BI-F0B389C9)", () => {
  test("no horizontal overflow on the team route at 390px", async ({ page }) => {
    await gotoOwnerRoute(page, "/storefront/team");
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth, "/storefront/team overflows horizontally at 390px").toBeLessThanOrEqual(
      clientWidth + 1,
    );
  });

  test("the add-provider control is labelled and meets the 44px tap target", async ({ page }) => {
    await gotoOwnerRoute(page, "/storefront/team");
    const btn = page.getByRole("button", { name: /add a new|cancel adding/i }).first();
    await expect(btn).toBeVisible();
    const box = await btn.boundingBox();
    expect(box?.height ?? 0, "add-provider control height").toBeGreaterThanOrEqual(43.5);
  });

  test("setup file inputs are labelled by owner outcome", async ({ page }) => {
    await gotoOwnerRoute(page, "/storefront/settings/business");
    const files = page.locator('input[type="file"]');
    const count = await files.count();
    // The business-context setup renders the business-document upload; assert
    // every file input exposes an accessible name (not a bare unlabeled control).
    for (let i = 0; i < count; i++) {
      const name = await files.nth(i).getAttribute("aria-label");
      expect(name?.trim(), `file input #${i} needs an accessible name`).toBeTruthy();
    }
  });
});
