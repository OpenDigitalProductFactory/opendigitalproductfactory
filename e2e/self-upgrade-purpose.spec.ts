import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import purposeRegistryJson from "../apps/web/lib/ux-budget/route-purpose.generated.json";
import { parsePagePurposeRegistry } from "../apps/web/lib/ux-budget/page-purpose";
import { evaluateCurrentPurposePage } from "../apps/web/lib/ux-budget/purpose-browser-adapter";

test("Self-Upgrade is findable and its served DOM matches the state oracle", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/workspace");
  const deliveryLink = page.getByRole("link", { name: "Delivery", exact: true });
  if (!(await deliveryLink.isVisible())) {
    await page
      .getByRole("button", { name: "Open primary navigation" })
      .click();
  }
  await deliveryLink.click();
  await expect(page.getByRole("heading", { level: 1, name: "Delivery" })).toBeVisible();
  await page.getByRole("link", { name: /Self-upgrade/i }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Self-Upgrade" })).toBeVisible();

  const contract = parsePagePurposeRegistry(purposeRegistryJson).routes.find(
    (candidate) => candidate.routePath === "/ops/self-upgrade",
  );

  expect(contract?.status).toBe("intent-ratified");
  if (!contract || contract.status !== "intent-ratified") return;
  const evaluation = await evaluateCurrentPurposePage(page, contract);

  expect(
    evaluation.structuralStatus,
    evaluation.findings.map((finding) => finding.message).join("\n"),
  ).toBe("conformant");
  expect(evaluation.intentStatus).toBe("intent-ratified");
  expect(evaluation.validation.overall).toBe("not-validated");

  const primaryAction = page.locator("[data-owner-first-next-action]");
  if ((await primaryAction.count()) > 0 && (await primaryAction.first().isVisible())) {
    const box = await primaryAction.first().boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    if (box && viewport) expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  }

  const releaseDetails = page.getByText("Version, impact & recovery", {
    exact: true,
  });
  await releaseDetails.focus();
  if (testInfo.project.use.hasTouch) {
    await releaseDetails.tap();
  } else {
    await page.keyboard.press("Enter");
  }
  await expect(
    page.locator("[data-dpf-purpose-disclosure-key='release-details']"),
  ).toHaveAttribute("open", "");

  const accessibility = await new AxeBuilder({ page })
    .include("main")
    .analyze();
  expect(accessibility.violations).toEqual([]);

  for (const viewport of [
    { width: 844, height: 390 },
    { width: 320, height: 640 },
  ]) {
    await page.setViewportSize(viewport);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  }
  expect(errors).toEqual([]);
});
