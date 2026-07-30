import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { writeFile } from "node:fs/promises";

import purposeRegistryJson from "../apps/web/lib/ux-budget/route-purpose.generated.json";
import {
  parsePagePurposeRegistry,
  type TaskValidationReceipt,
} from "../apps/web/lib/ux-budget/page-purpose";
import {
  capturePurposeEvidence,
  evaluateCurrentPurposePage,
} from "../apps/web/lib/ux-budget/purpose-browser-adapter";
import { evaluateRoutePurpose } from "../apps/web/lib/ux-budget/purpose-evaluator";
import { SELF_UPGRADE_PURPOSE_STATES } from "../apps/web/lib/ux-budget/self-upgrade-purpose-review";

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

test("Self-Upgrade review fixtures prove every state outcome and correction path", async ({
  page,
}, testInfo) => {
  const contract = parsePagePurposeRegistry(purposeRegistryJson).routes.find(
    (candidate) => candidate.routePath === "/ops/self-upgrade",
  );
  expect(contract?.status).toBe("intent-ratified");
  if (!contract || contract.status !== "intent-ratified") return;

  const metrics: Record<string, string | number | boolean> = {};
  let finalEvidence = null as Awaited<
    ReturnType<typeof capturePurposeEvidence>
  >;

  for (const state of SELF_UPGRADE_PURPOSE_STATES) {
    const scenario = contract.stateScenarios[state];
    await page.goto(`/ops/self-upgrade?purposeReview=${state}`);
    await expect(
      page.locator("[data-purpose-review-fixture='self-upgrade-v1']"),
    ).toBeVisible();

    if (state === "update-available") {
      await page.getByRole("button", { name: "Upgrade now" }).click();
      await expect(
        page.locator(
          `[data-dpf-purpose-completion-signal-key='${scenario.completionSignalKey}']`,
        ),
      ).toBeVisible();

      await page.goto(
        `/ops/self-upgrade?purposeReview=${state}&outcome=error`,
      );
      await page.getByRole("button", { name: "Upgrade now" }).click();
      await expect(
        page.locator(
          `[data-dpf-purpose-correction-signal-key='${scenario.correctionSignalKey}']`,
        ),
      ).toBeVisible();
      await page.goto(`/ops/self-upgrade?purposeReview=${state}`);
      await page.getByRole("button", { name: "Upgrade now" }).click();
    } else if (state === "failed-recoverable") {
      await page.getByRole("link", { name: "Review recovery controls" }).click();
      await expect(page.locator("#self-upgrade-latest-run")).toBeInViewport();
    }

    const completion = page.locator(
      `[data-dpf-purpose-completion-signal-key='${scenario.completionSignalKey}']`,
    );
    const correction = page.locator(
      `[data-dpf-purpose-correction-signal-key='${scenario.correctionSignalKey}']`,
    );
    await expect(completion).toBeVisible();
    await expect(correction).toBeVisible();

    const evidence = await capturePurposeEvidence(page);
    expect(evidence).not.toBeNull();
    if (!evidence) continue;
    const structural = evaluateRoutePurpose({
      contract,
      oracle: {
        routePath: "/ops/self-upgrade",
        stateKey: state,
        oracleKey: scenario.stateSource.oracleKey,
        sourceRef: scenario.stateSource.sourceRef,
      },
      evidence,
      enforcement: "advisory",
    });
    expect(
      structural.structuralStatus,
      structural.findings.map((finding) => finding.message).join("\n"),
    ).toBe("conformant");
    metrics[`state.${state}.completionSignalKey`] =
      scenario.completionSignalKey;
    metrics[`state.${state}.completionObserved`] = true;
    metrics[`state.${state}.correctionSignalKey`] =
      scenario.correctionSignalKey;
    metrics[`state.${state}.correctionObserved`] = true;
    finalEvidence = evidence;
  }

  expect(finalEvidence).not.toBeNull();
  if (!finalEvidence) return;
  const artifactPath = testInfo.outputPath("purpose-validation-receipt.json");
  const receipt: TaskValidationReceipt = {
    schemaVersion: 1,
    evidenceClass: "automated-functional",
    routePath: "/ops/self-upgrade",
    contractHash: "self-upgrade-purpose-contract-v1",
    sourceSha: process.env.GITHUB_SHA ?? "local-purpose-review",
    fixtureVersion: "self-upgrade-v1",
    viewport: `${page.viewportSize()?.width ?? 0}x${page.viewportSize()?.height ?? 0}`,
    inputMode: testInfo.project.use.hasTouch ? "touch" : "pointer",
    interactionFingerprint: "self-upgrade-five-state-review-v1",
    relevantDependencyFingerprint: "self-upgrade-purpose-ui-v1",
    metrics,
    thresholds: { allFiveStates: true, completionAndCorrection: true },
    reviewerRef: `playwright:${testInfo.project.name}`,
    observedAt: new Date().toISOString(),
    artifactIds: [artifactPath],
    runnerRef: "@playwright/test",
    completionOracleResult: "passed",
  };
  await writeFile(artifactPath, `${JSON.stringify(receipt, null, 2)}\n`);

  const finalState = "blocked";
  const finalScenario = contract.stateScenarios[finalState];
  const validated = evaluateRoutePurpose({
    contract: { ...contract, validationReceipts: [receipt] },
    oracle: {
      routePath: "/ops/self-upgrade",
      stateKey: finalState,
      oracleKey: finalScenario.stateSource.oracleKey,
      sourceRef: finalScenario.stateSource.sourceRef,
    },
    evidence: finalEvidence,
    context: {
      contractHash: receipt.contractHash,
      fixtureVersion: receipt.fixtureVersion,
      interactionFingerprint: receipt.interactionFingerprint,
      relevantDependencyFingerprint:
        receipt.relevantDependencyFingerprint,
      resolvedArtifactIds: new Set([artifactPath]),
    },
    enforcement: "advisory",
  });
  expect(validated.validation.overall).toBe("current");
});
