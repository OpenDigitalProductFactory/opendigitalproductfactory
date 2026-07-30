import { expect, test } from "@playwright/test";

import purposeRegistryJson from "../apps/web/lib/ux-budget/route-purpose.generated.json";
import { parsePagePurposeRegistry } from "../apps/web/lib/ux-budget/page-purpose";
import { evaluateRoutePurpose } from "../apps/web/lib/ux-budget/purpose-evaluator";
import { capturePurposeEvidence } from "../apps/web/scripts/ux-route-sweep";

test("Self-Upgrade served DOM matches its independent state oracle", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/ops/self-upgrade");
  await expect(page.getByRole("heading", { level: 1, name: "Self-Upgrade" })).toBeVisible();

  const oracleResponse = await request.get(
    "/api/ops/self-upgrade/purpose-state",
  );
  expect(oracleResponse.ok()).toBe(true);
  const oracle = await oracleResponse.json();
  const evidence = await capturePurposeEvidence(page);
  const contract = parsePagePurposeRegistry(purposeRegistryJson).routes.find(
    (candidate) => candidate.routePath === "/ops/self-upgrade",
  );

  expect(contract?.status).toBe("intent-ratified");
  expect(evidence).not.toBeNull();
  if (!contract || !evidence) return;

  const evaluation = evaluateRoutePurpose({
    contract,
    oracle,
    evidence,
    enforcement: "advisory",
  });

  expect(
    evaluation.structuralStatus,
    evaluation.findings.map((finding) => finding.message).join("\n"),
  ).toBe("conformant");
  expect(evaluation.intentStatus).toBe("intent-ratified");
  expect(evaluation.validation.overall).toBe("not-validated");

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});
