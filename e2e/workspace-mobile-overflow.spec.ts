import { test, expect } from "@playwright/test";
import { ensureLoggedIn } from "./helpers/auth";

// BI-882B3680: owner approvals often happen on a phone, so the internal shell
// navigation must not force horizontal page overflow at a common mobile width.
test.describe("Workspace mobile shell navigation", () => {
  test("has no horizontal page overflow at 390px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await ensureLoggedIn(page);
    await page.goto("/workspace");
    await page.waitForLoadState("networkidle").catch(() => {});

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));

    // A 1px rounding tolerance; anything larger is a real horizontal overflow.
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
  });
});
