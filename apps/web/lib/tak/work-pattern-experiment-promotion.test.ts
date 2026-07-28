import { describe, expect, it } from "vitest";

import {
  deriveWorkPatternPromotionCandidates,
  type WorkPatternPromotionExperimentRun,
} from "./work-pattern-experiment-promotion";

function run(
  replicate: number,
  options: {
    productionBuild?: "pass" | "not-run";
    candidateFailureClass?: string;
    candidateBlockingFindings?: number;
    candidateStatus?: string;
  } = {},
): WorkPatternPromotionExperimentRun {
  const productionBuild = options.productionBuild ?? "pass";
  const experimentRunId = `WPR-${replicate}`;
  const manifest = {
    schemaVersion: 1 as const,
    experimentDefinitionKey: "WPD-build-method",
    experimentRunId,
    replicate,
    patternKey: "autonomous-build",
    activityKey: "build.implement",
    riskClass: "internal-reversible" as const,
    methodVariants: [
      { methodVariantKey: "baseline", patternVersion: 1 },
      { methodVariantKey: "candidate", patternVersion: 2 },
    ],
    modelVariants: [
      { modelVariantKey: "local", modelProfileId: "local-coding" },
      { modelVariantKey: "frontier", modelProfileId: "frontier-coding" },
    ],
    requiredCellKeys: [
      `${experimentRunId}-baseline-local`,
      `${experimentRunId}-candidate-local`,
      `${experimentRunId}-baseline-frontier`,
      `${experimentRunId}-candidate-frontier`,
    ],
    taskCorpusKey: "dpf-repository",
    taskCorpusVersion: "1",
    oracleKey: "build-gate",
    oracleVersion: "1",
    promotionPolicyKey: "governed-build-playbook-promotion",
    promotionPolicyVersion: 1,
    installScope: "dpf_dogfood" as const,
    lifecycle: "completed" as const,
  };
  const cells = manifest.modelVariants.flatMap((model) =>
    manifest.methodVariants.map((method) => {
      const candidate = method.methodVariantKey === "candidate";
      const childTaskRunId =
        `${experimentRunId}-${method.methodVariantKey}-${model.modelVariantKey}`;
      const outcome = {
        success: true,
        actualProviderId: "provider",
        actualModelId: model.modelVariantKey,
        outcomeEvidence: {
          completed: true,
          buildGate: {
            unitTests: "pass",
            productionBuild,
            uxVerification: "not-applicable",
            migration: "not-applicable",
          },
          review: {
            decision: "pass",
            reproducedBlockingFindings: candidate
              ? options.candidateBlockingFindings ?? 0
              : 0,
            nonBlockingFindings: 0,
            reviewRounds: 1,
          },
          execution: {
            toolCalls: candidate ? 8 : 10,
            toolFailures: 0,
            retryCount: 0,
            recoveryActions: [],
            manualTouches: 0,
            inputTokens: candidate ? 800 : 1_000,
            outputTokens: candidate ? 400 : 500,
            durationMs: candidate ? 80_000 : 100_000,
          },
          delivery: {
            prCreated: false,
            mergeQueued: false,
            merged: false,
            deployed: false,
            rolledBack: false,
          },
          ...(candidate && options.candidateFailureClass
            ? { failureClass: options.candidateFailureClass }
            : {}),
        },
      };
      return {
        taskRunId: childTaskRunId,
        status: candidate
          ? options.candidateStatus ?? "completed"
          : "completed",
        completedAt: new Date(`2026-07-${String(10 + replicate).padStart(2, "0")}T12:00:00.000Z`),
        a2aMetadata: {
          workPatternExperimentCell: {
            executionRequest: {
              experimentRunId,
              childTaskRunId,
              cellKey: childTaskRunId,
              pairKey: `pair-${replicate}`,
              methodVariantKey: method.methodVariantKey,
              modelVariantKey: model.modelVariantKey,
              fixtureKey: `fixture-${replicate}`,
              oracleKey: manifest.oracleKey,
              oracleVersion: manifest.oracleVersion,
              resourcePolicyKey: "bounded-build-v1",
              executionProfile: {
                patternKey: manifest.patternKey,
                patternVersion: method.patternVersion,
                variantKey: method.methodVariantKey,
                activityKey: manifest.activityKey,
                riskClass: manifest.riskClass,
                providerId: "provider",
                modelId: model.modelVariantKey,
                modelProfileId: model.modelProfileId,
                toolPackDigest: "tools",
                promptOrSkillDigest: method.methodVariantKey,
                contextPolicyKey: "bounded",
                recoveryPolicyKey: "bounded",
                installScope: manifest.installScope,
                taskCorpusKey: manifest.taskCorpusKey,
                taskCorpusVersion: manifest.taskCorpusVersion,
                environmentKey: "shadow",
                sourceCommitSha: "source-sha",
              },
            },
          },
          workPatternExperimentResult: { success: false },
        },
        evidenceRows: [{
          ledgerId: `DSL-${childTaskRunId}-outcome`,
          taskRunId: childTaskRunId,
          outcome,
          observedAt: new Date(`2026-07-${String(10 + replicate).padStart(2, "0")}T12:00:00.000Z`),
          metadata: {
            experimentRunId,
            observationKind: "outcome",
            sequence: 1,
          },
        }],
      };
    }),
  );
  return {
    parentTaskRunId: `TR-${experimentRunId}`,
    manifest,
    cells,
  };
}

describe("deriveWorkPatternPromotionCandidates", () => {
  it("aggregates effective-ledger evidence into one candidate per model scope", () => {
    const candidates = deriveWorkPatternPromotionCandidates({
      sourceExperimentTaskRunId: "TR-WPR-8",
      orchestratingAgentId: "build-specialist",
      runs: Array.from({ length: 8 }, (_, index) => run(index + 1)),
      regulatoryHumanControlRequired: false,
    });

    expect(candidates).toHaveLength(2);
    expect(candidates.map((candidate) => candidate.snapshot.source.modelProfileId))
      .toEqual(["local-coding", "frontier-coding"]);
    expect(candidates[0]?.snapshot).toMatchObject({
      baselinePatternVersion: 1,
      patternVersion: 2,
      promotionEvidence: {
        validPairCount: 8,
        invalidPairCount: 0,
        completedCellKeys: ["control", "method", "model", "interaction"],
        rollbackBindingId: null,
        objectiveDeltas: {
          correctness: 0,
          security: 0,
          migrationSafety: 0,
          customerImpact: 0,
          speed: 0.2,
          cost: 0.2,
        },
      },
    });
  });

  it("fails closed when a model lane has no authoritative outcome ledger", () => {
    const runs = Array.from({ length: 8 }, (_, index) => run(index + 1));
    for (const experiment of runs) {
      const localCandidate = experiment.cells.find((cell) =>
        cell.taskRunId.endsWith("-candidate-local"));
      if (localCandidate) localCandidate.evidenceRows = [];
    }

    const candidates = deriveWorkPatternPromotionCandidates({
      sourceExperimentTaskRunId: "TR-WPR-8",
      orchestratingAgentId: "build-specialist",
      runs,
      regulatoryHumanControlRequired: false,
    });

    expect(candidates.map((candidate) => candidate.snapshot.source.modelProfileId))
      .toEqual(["frontier-coding"]);
  });

  it("does not count inference-only evidence as a qualifying build pair", () => {
    const [candidate] = deriveWorkPatternPromotionCandidates({
      sourceExperimentTaskRunId: "TR-WPR-8",
      orchestratingAgentId: "build-specialist",
      runs: Array.from({ length: 8 }, (_, index) =>
        run(index + 1, { productionBuild: "not-run" })),
      regulatoryHumanControlRequired: false,
    });

    expect(candidate?.snapshot.promotionEvidence).toMatchObject({
      validPairCount: 0,
      invalidPairCount: 8,
    });
  });

  it("retains hard-negative evidence even when the pair is invalid", () => {
    const [candidate] = deriveWorkPatternPromotionCandidates({
      sourceExperimentTaskRunId: "TR-WPR-8",
      orchestratingAgentId: "build-specialist",
      runs: Array.from({ length: 8 }, (_, index) =>
        run(index + 1, {
          candidateFailureClass: "commandment_gate_regression",
          candidateBlockingFindings: 1,
        })),
      regulatoryHumanControlRequired: false,
    });

    expect(candidate?.snapshot.promotionEvidence).toMatchObject({
      validPairCount: 0,
      invalidPairCount: 8,
      commandmentGateRegression: true,
      criticalFindingReproduced: true,
    });
  });

  it("does not claim factorial completion for non-terminal cells", () => {
    const [candidate] = deriveWorkPatternPromotionCandidates({
      sourceExperimentTaskRunId: "TR-WPR-8",
      orchestratingAgentId: "build-specialist",
      runs: Array.from({ length: 8 }, (_, index) =>
        run(index + 1, { candidateStatus: "working" })),
      regulatoryHumanControlRequired: false,
    });

    expect(candidate?.snapshot.promotionEvidence.completedCellKeys).toEqual([]);
  });
});
