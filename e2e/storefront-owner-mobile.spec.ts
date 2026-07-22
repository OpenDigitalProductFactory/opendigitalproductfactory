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

// Residual-closure slice (BI-F0B389C9): the dashboard + inbox routes named in
// the acceptance now get explicit 390px assertions too. Chips/action controls
// were sized by the residual-closure PR; earlier routes stay covered above.
test.describe("Owner dashboard + inbox mobile usability @390px (BI-F0B389C9)", () => {
  test("no horizontal overflow and a first-viewport owner task on /storefront", async ({ page }) => {
    await gotoOwnerRoute(page, "/storefront");
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth, "/storefront overflows horizontally at 390px").toBeLessThanOrEqual(
      clientWidth + 1,
    );
    // Chrome budget: the owner's task content (first main-content heading) must
    // start inside the first phone viewport, not below a wall of shell chrome.
    const heading = page.locator("main h1, main h2").first();
    await expect(heading).toBeVisible();
    const box = await heading.boundingBox();
    expect(box?.y ?? Infinity, "owner task heading must be in the first 390x844 viewport").toBeLessThan(
      844,
    );
  });

  test("inbox filter chips meet the 44px tap target and expose pressed state", async ({ page }) => {
    await gotoOwnerRoute(page, "/storefront/inbox");
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth, "/storefront/inbox overflows horizontally at 390px").toBeLessThanOrEqual(
      clientWidth + 1,
    );

    const chips = page.getByRole("button", { name: /^filter requests:/i });
    const chipCount = await chips.count();
    expect(chipCount, "expected the request filter chips").toBeGreaterThanOrEqual(3);
    for (let i = 0; i < chipCount; i++) {
      const chip = chips.nth(i);
      const box = await chip.boundingBox();
      expect(box?.height ?? 0, `filter chip #${i} height`).toBeGreaterThanOrEqual(43.5);
      expect(await chip.getAttribute("aria-pressed"), `filter chip #${i} pressed state`).not.toBeNull();
    }
  });

  test("inbox row actions are 44px and row-specific when requests exist", async ({ page }) => {
    await gotoOwnerRoute(page, "/storefront/inbox");
    const rowActions = page.getByRole("button", {
      name: /^(confirm|cancel|send inquiry) /i,
    });
    const count = await rowActions.count();
    test.skip(count === 0, "no actionable requests seeded on this install");
    for (let i = 0; i < Math.min(count, 6); i++) {
      const box = await rowActions.nth(i).boundingBox();
      expect(box?.height ?? 0, `inbox row action #${i} height`).toBeGreaterThanOrEqual(43.5);
    }
  });
});
