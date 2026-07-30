import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures/dpf-test";

type MobileFact = {
  label: string;
  value: string;
};

test.describe("Coworker catalog mobile projection @390px (BI-C1943813)", () => {
  test("shows one complete, non-actionable offer layout without overflow", async ({
    page,
    openAppRoute,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });

    await openAppRoute("/platform/ai/catalog");
    await page.waitForLoadState("networkidle").catch(() => {});

    const mobileLayout = page.locator('[data-catalog-layout="mobile"]');
    const desktopLayout = page.locator('[data-catalog-layout="desktop"]');
    await expect(mobileLayout).toBeVisible();
    await expect(desktopLayout).toBeHidden();

    const firstMobileOffer = mobileLayout.locator("article").first();
    await expect(firstMobileOffer).toBeVisible();
    const mobileOfferName =
      (await firstMobileOffer.getByRole("heading", { level: 2 }).textContent())?.trim() ??
      "";
    expect(mobileOfferName).not.toBe("");

    const mobileFacts = await firstMobileOffer.locator("dl > div").evaluateAll(
      (rows): MobileFact[] =>
        rows.map((row) => ({
          label: row.querySelector("dt")?.textContent?.trim() ?? "",
          value: row.querySelector("dd")?.textContent?.trim() ?? "",
        })),
    );
    const factsByLabel = new Map(
      mobileFacts.map((fact) => [fact.label, fact.value]),
    );
    const requireFact = (label: string): string => {
      const value = factsByLabel.get(label) ?? "";
      expect(value, `${label} should be present`).not.toBe("");
      return value;
    };
    for (const label of [
      "Service",
      "Version",
      "Provider",
      "Risk",
      "Authority",
      "Availability",
      "Engagement",
    ]) {
      requireFact(label);
    }
    const providerSecondary = mobileFacts.find((fact) =>
      fact.label === "Provider organization" || fact.label === "Provider type"
    );
    expect(providerSecondary?.value, "provider context should be present").toBeTruthy();
    const providerSecondaryValue = providerSecondary?.value ?? "";

    const desktopHeaders = await desktopLayout
      .locator("thead th")
      .allTextContents();
    expect(desktopHeaders.map((header) => header.trim())).toEqual([
      "Offer",
      "Provider",
      "Risk",
      "Authority",
      "Availability",
    ]);
    const desktopCells = await desktopLayout
      .locator("tbody tr")
      .first()
      .locator("td")
      .allTextContents();
    expect(desktopCells).toHaveLength(5);
    expect(desktopCells[0]).toContain(mobileOfferName);
    expect(desktopCells[0]).toContain(requireFact("Service"));
    expect(desktopCells[0]).toContain(requireFact("Version"));
    expect(desktopCells[0]).toContain(requireFact("Engagement"));
    expect(desktopCells[1]).toContain(requireFact("Provider"));
    expect(desktopCells[1]).toContain(providerSecondaryValue);
    for (const [cellIndex, factLabel] of [
      [2, "Risk"],
      [3, "Authority"],
      [4, "Availability"],
    ] as const) {
      for (const value of (factsByLabel.get(factLabel) ?? "").split("; ")) {
        expect(desktopCells[cellIndex]).toContain(value);
      }
    }

    await expect(
      mobileLayout.locator("a, button, [role='button']"),
      "catalog facts must not trigger coworker work",
    ).toHaveCount(0);

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth, "catalog route overflows horizontally at 390px").toBeLessThanOrEqual(
      clientWidth + 1,
    );

    const axe = await new AxeBuilder({ page })
      .include('[data-catalog-layout="mobile"]')
      .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
      .analyze();
    expect(
      axe.violations.filter(
        (violation) =>
          violation.impact === "critical" || violation.impact === "serious",
      ),
    ).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});
