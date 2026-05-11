import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { TestInfo } from "@playwright/test";
import {
  buildFunctionalFailureEvidence,
  redactEvidence,
  type FunctionalFailureEvidenceInput,
} from "../../apps/web/lib/testing/functional-evidence";

export async function attachFunctionalFailureEvidence(
  testInfo: TestInfo,
  input: FunctionalFailureEvidenceInput,
) {
  const evidence = redactEvidence(buildFunctionalFailureEvidence(input));
  const outputPath = join(testInfo.outputDir, "functional-failure-evidence.json");

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(evidence, null, 2), "utf8");
  testInfo.attachments.push({
    name: "functional-failure-evidence",
    contentType: "application/json",
    path: outputPath,
  });

  return evidence;
}
