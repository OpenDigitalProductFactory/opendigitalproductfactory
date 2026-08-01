import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import purposeRegistryJson from "./route-purpose.generated.json";
import { parsePagePurposeRegistry } from "./page-purpose";
import {
  purposeContractHash,
  purposeArtifactContentHash,
  resolvePurposeEvaluationContext,
} from "./purpose-validation-context";

const contract = parsePagePurposeRegistry(purposeRegistryJson).routes.find(
  (candidate) => candidate.routePath === "/ops/self-upgrade",
);

describe("purpose validation context", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(resolve(tmpdir(), "dpf-purpose-context-"));
    writeFileSync(resolve(repoRoot, "fixture.json"), '{"fixture":1}');
    writeFileSync(resolve(repoRoot, "interaction.json"), '{"steps":2}');
    writeFileSync(resolve(repoRoot, "dependency.ts"), "export const value = 1;\n");
    writeFileSync(resolve(repoRoot, "evidence.json"), '{"passed":true}');
  });

  afterEach(() => rmSync(repoRoot, { recursive: true, force: true }));

  it("derives current fingerprints and invalidates changed artifact bytes", () => {
    expect(contract?.status).toBe("intent-ratified");
    if (!contract || contract.status !== "intent-ratified") return;
    const artifact = (
      id: string,
      path: string,
      role: "fixture" | "interaction" | "dependency" | "evidence",
    ) => ({
      id,
      path,
      role,
      sha256: purposeArtifactContentHash(resolve(repoRoot, path)),
    });
    const candidate = {
      ...contract,
      validationTarget: {
        artifacts: [
          artifact("fixture", "fixture.json", "fixture"),
          artifact("interaction", "interaction.json", "interaction"),
          artifact("dependency", "dependency.ts", "dependency"),
          artifact("evidence", "evidence.json", "evidence"),
        ],
      },
    };

    const context = resolvePurposeEvaluationContext(candidate, repoRoot)!;

    expect(context.contractHash).toBe(purposeContractHash(candidate));
    expect(context.fixtureVersion).toMatch(/^[a-f0-9]{64}$/);
    expect([...context.resolvedArtifactIds].sort()).toEqual([
      "dependency",
      "evidence",
      "fixture",
      "interaction",
    ]);

    writeFileSync(resolve(repoRoot, "dependency.ts"), "export const value = 2;\n");
    const changed = resolvePurposeEvaluationContext(candidate, repoRoot)!;

    expect(changed.fixtureVersion).toBe(context.fixtureVersion);
    expect(changed.interactionFingerprint).toBe(context.interactionFingerprint);
    expect(changed.relevantDependencyFingerprint).not.toBe(
      context.relevantDependencyFingerprint,
    );
    expect(changed.resolvedArtifactIds.has("dependency")).toBe(false);

    writeFileSync(resolve(repoRoot, "evidence.json"), '{"passed":false}');
    const evidenceArtifact = candidate.validationTarget.artifacts.find(
      (entry) => entry.id === "evidence",
    );
    expect(evidenceArtifact).toBeDefined();
    if (!evidenceArtifact) return;
    evidenceArtifact.sha256 = purposeArtifactContentHash(
      resolve(repoRoot, "evidence.json"),
    );
    const rePinned = resolvePurposeEvaluationContext(candidate, repoRoot)!;

    expect(rePinned.resolvedArtifactIds.has("evidence")).toBe(true);
    expect(rePinned.evidenceFingerprint).not.toBe(context.evidenceFingerprint);
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
