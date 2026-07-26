import { describe, expect, it } from "vitest";

import { analyzeWorkPatternExperimentCells } from "./work-pattern-experiment-projection";

describe("analyzeWorkPatternExperimentCells", () => {
  const manifest = {
    schemaVersion: 1 as const,
    experimentDefinitionKey: "def-1",
    experimentRunId: "run-1",
    replicate: 1,
    patternKey: "review",
    activityKey: "review",
    riskClass: "read-only" as const,
    methodVariants: [
      { methodVariantKey: "baseline", patternVersion: 1 },
      { methodVariantKey: "candidate", patternVersion: 2 },
    ],
    modelVariants: [{ modelVariantKey: "primary", modelProfileId: "profile-1" }],
    requiredCellKeys: ["base", "candidate"],
    taskCorpusKey: "corpus",
    taskCorpusVersion: "1",
    oracleKey: "oracle",
    oracleVersion: "1",
    promotionPolicyKey: "policy",
    promotionPolicyVersion: 1,
    installScope: "canonical" as const,
    lifecycle: "analyzing" as const,
  };
  const cell = (methodVariantKey: string) => ({
    status: "completed",
    pairKey: "pair-1",
    methodVariantKey,
    modelVariantKey: "primary",
    success: true,
    requestedProviderId: "provider",
    requestedModelId: "model",
    actualProviderId: "provider",
    actualModelId: "model",
    fixtureKey: "fixture",
    sourceCommitSha: "abc",
    taskCorpusKey: "corpus",
    taskCorpusVersion: "1",
    oracleKey: "oracle",
    oracleVersion: "1",
    resourcePolicyKey: "bounded",
  });

  it("counts only complete, controlled baseline/candidate pairs", () => {
    const result = analyzeWorkPatternExperimentCells(
      manifest,
      [cell("baseline"), cell("candidate")],
      new Date("2026-07-26T12:00:00.000Z"),
    );

    expect(result).toEqual({
      validPairCount: 1,
      resultSummary: "1 of 1 comparable method pairs passed the evidence controls.",
      evidenceOrigin: "hermetic-replay",
      moreEvidenceNeeded: false,
      invalidPairReasons: [],
      freshnessAt: "2026-07-26T12:00:00.000Z",
    });
  });

  it("fails closed when provider fallback changes a requested cell", () => {
    const candidate = {
      ...cell("candidate"),
      actualModelId: "fallback-model",
    };

    const result = analyzeWorkPatternExperimentCells(
      manifest,
      [cell("baseline"), candidate],
    );

    expect(result.validPairCount).toBe(0);
    expect(result.moreEvidenceNeeded).toBe(true);
    expect(result.invalidPairReasons).toEqual([
      "Provider or model fallback changed candidate/primary.",
    ]);
  });
});
