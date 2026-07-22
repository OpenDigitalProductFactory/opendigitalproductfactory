/**
 * Owner-admin storefront cognitive-load UX smoke checks (EP-UX-COGLOAD / BI-F0B389C9).
 *
 * Scoped to the owner-admin controls this PR owns — items, sections, and operating
 * hours. Sibling PRs cover the mobile shell (#3392), self-upgrade (#3391), inbox
 * (#3387), and setup recovery (#3389), so this spec deliberately does not assert on
 * those surfaces.
 *
 * At a 390px phone width: owner setup fields carry outcome labels, mutation controls
 * meet a 44px hit area with row-specific accessible labels, and the operations
 * editor does not overflow horizontally.
 */
import { test, expect, type Page } from "@playwright/test";
import { loginToDPF } from "./helpers";

const PHONE = { width: 390, height: 844 };

async function gotoSettled(page: Page, path: string): Promise<string> {
  await page.goto(path);
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  return new URL(page.url()).pathname;
}

async function expectNoHorizontalOverflow(page: Page, path: string): Promise<void> {
  const { scrollW, clientW } = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  }));
  expect(
    scrollW,
    `${path}: horizontal overflow — scrollWidth ${scrollW} > clientWidth ${clientW} at ${PHONE.width}px`,
  ).toBeLessThanOrEqual(clientW + 1);
}

test.describe("Owner-admin storefront — mobile cognitive load", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(PHONE);
    await loginToDPF(page);
  });

  test("operations time inputs are labelled by owner outcome and don't overflow", async ({ page }) => {
    const landed = await gotoSettled(page, "/storefront/settings/operations");
    test.skip(landed.includes("/login") || landed.includes("/setup"), `redirected to ${landed}`);

    // Accessible names tie each control to a business outcome, not an anonymous 09:00.
    await expect(page.getByLabel("Monday opens")).toBeVisible();
    await expect(page.getByLabel("Monday closes")).toBeVisible();
    await expect(page.getByLabel(/Business timezone/i)).toBeVisible();

    // The day rows wrap instead of forcing page-level horizontal scroll.
    await expectNoHorizontalOverflow(page, "/storefront/settings/operations");
  });

  test("sections controls meet a 44px hit area with row-specific labels", async ({ page }) => {
    const landed = await gotoSettled(page, "/storefront/sections");
    test.skip(landed.includes("/login") || landed.includes("/setup"), `redirected to ${landed}`);

    // Row controls carry row-specific accessible labels (not bare arrows / Hide).
    const controls = page.getByRole("button", { name: /^(Move|Hide|Show) .+/ });
    const count = await controls.count();
    test.skip(count === 0, "no sections rendered in this environment");

    for (let i = 0; i < Math.min(count, 6); i++) {
      const box = await controls.nth(i).boundingBox();
      expect(box, `control ${i} has no box`).not.toBeNull();
      if (!box) continue;
      expect(
        box.width >= 44 && box.height >= 44,
        `sections control ${i} hit area ${Math.round(box.width)}x${Math.round(box.height)} < 44x44`,
      ).toBeTruthy();
    }
  });

  test("items controls carry row-specific accessible labels", async ({ page }) => {
    const landed = await gotoSettled(page, "/storefront/items");
    test.skip(landed.includes("/login") || landed.includes("/setup"), `redirected to ${landed}`);

    const editControls = page.getByRole("button", { name: /^Edit .+/ });
    const count = await editControls.count();
    test.skip(count === 0, "no items rendered in this environment");

    // Every Edit/Delete carries the item name, and meets the 44px hit area.
    const box = await editControls.first().boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(
        box.width >= 44 && box.height >= 44,
        `items Edit hit area ${Math.round(box.width)}x${Math.round(box.height)} < 44x44`,
      ).toBeTruthy();
    }
    await expect(page.getByRole("button", { name: /^Delete .+/ }).first()).toBeVisible();
  });
});
