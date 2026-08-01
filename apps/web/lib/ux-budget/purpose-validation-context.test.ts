import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import purposeRegistryJson from "./route-purpose.generated.json";
import { parsePagePurposeRegistry } from "./page-purpose";
import {
  purposeContractHash,
  resolvePurposeEvaluationContext,
} from "./purpose-validation-context";

const contract = parsePagePurposeRegistry(purposeRegistryJson).routes.find(
  (candidate) => candidate.routePath === "/ops/self-upgrade",
);

describe("purpose validation context", () => {
  it("resolves current fingerprints and only artifacts that exist", () => {
    expect(contract?.status).toBe("intent-ratified");
    if (!contract || contract.status !== "intent-ratified") return;
    const candidate = {
      ...contract,
      validationTarget: {
        fixtureVersion: "self-upgrade-v1",
        interactionFingerprint: "interaction-v1",
        relevantDependencyFingerprint: "dependencies-v1",
        artifacts: [
          {
            id: "existing",
            path: "apps/web/lib/ux-budget/page-purpose.ts",
          },
          { id: "missing", path: "test-results/missing-purpose-proof.json" },
        ],
      },
    };

    const context = resolvePurposeEvaluationContext(
      candidate,
      resolve(__dirname, "../../../.."),
    );

    expect(context).toMatchObject({
      contractHash: purposeContractHash(candidate),
      fixtureVersion: "self-upgrade-v1",
      interactionFingerprint: "interaction-v1",
      relevantDependencyFingerprint: "dependencies-v1",
    });
    expect([...context!.resolvedArtifactIds]).toEqual(["existing"]);
  });

  it("changes the contract fingerprint when purpose semantics change", () => {
    expect(contract?.status).toBe("intent-ratified");
    if (!contract || contract.status !== "intent-ratified") return;
    const changed = {
      ...contract,
      intent: { ...contract.intent, job: `${contract.intent.job} Changed.` },
    };

    expect(purposeContractHash(changed)).not.toBe(purposeContractHash(contract));
  });
});
