import { expect, test } from "./fixtures/dpf-test";
import copy from "../packages/i18n/src/messages/en-US/providerAccounts.json";

// The established UX workflow supplies a seeded Linux fixture with no installed
// native host. This test must never start a transition on an operator's install.
test.skip(process.env.DPF_MEASUREMENT_RUNTIME !== "1", "Requires the governed UX measurement fixture");

for (const viewport of [
  { name: "desktop", width: 1366, height: 900 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test.describe(`Local engine control — ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("retains Docker and refreshes availability without offering an unqualified switch", async ({ page, openAppRoute }, testInfo) => {
      await openAppRoute("/platform/ai/providers/local");
      const panel = page.getByRole("region", { name: copy.managedEngineTitle, exact: true });
      await expect(panel).toBeVisible({ timeout: 15_000 });
      await expect(panel.getByRole("button", { name: copy.managedEngineUse, exact: true })).toHaveCount(0);
      await expect(panel.getByRole("button", { name: copy.managedEngineRestore, exact: true })).toHaveCount(0);
      expect(await page.evaluate(() => localStorage.getItem("dpf:managed-inference:pending"))).toBeNull();

      const [refreshed] = await Promise.all([
        page.waitForResponse(response => response.request().method() === "GET"
          && new URL(response.url()).pathname === "/platform/ai/providers/local"),
        panel.getByRole("button", { name: copy.managedEngineRefresh, exact: true }).click(),
      ]);
      expect(refreshed.ok()).toBe(true);
      await refreshed.finished();
      await expect(panel.getByRole("button", { name: copy.managedEngineRefresh, exact: true })).toBeEnabled();
      await expect(panel).toBeVisible();
      await expect(panel.getByRole("button", { name: copy.managedEngineUse, exact: true })).toHaveCount(0);
      await expect(panel.getByRole("button", { name: copy.managedEngineRestore, exact: true })).toHaveCount(0);
      expect(await page.evaluate(() => localStorage.getItem("dpf:managed-inference:pending"))).toBeNull();

      await panel.scrollIntoViewIfNeeded();
      const layout = await panel.evaluate(element => {
        const bounds = element.getBoundingClientRect();
        return { left: bounds.left, right: bounds.right, viewportWidth: innerWidth,
          scrollWidth: element.scrollWidth, clientWidth: element.clientWidth };
      });
      expect(layout.left).toBeGreaterThanOrEqual(-1);
      expect(layout.right).toBeLessThanOrEqual(layout.viewportWidth + 1);
      expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
      await testInfo.attach("control-layout", { body: JSON.stringify(layout), contentType: "application/json" });
      const screenshot = testInfo.outputPath(`${viewport.name}-local-engine.png`);
      await page.screenshot({ path: screenshot });
      await testInfo.attach("local-engine-control", { path: screenshot, contentType: "image/png" });
    });
  });
}
