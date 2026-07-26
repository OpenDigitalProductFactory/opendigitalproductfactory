import { describe, expect, it } from "vitest";

import {
  workPatternCellKey,
  workPatternExperimentChildTaskRunId,
  workPatternExperimentDefinitionKey,
  workPatternExperimentLedgerId,
  workPatternExperimentParentTaskRunId,
  workPatternExperimentRunId,
} from "./work-pattern-experiment-identity";

const definition = {
  patternKey: "build.review",
  taskCorpusKey: "build-review-corpus",
  taskCorpusVersion: "2026-07-25",
  oracleKey: "build-gates",
  oracleVersion: "2",
  methodVariants: [
    { methodVariantKey: "baseline", patternVersion: 2 },
    { methodVariantKey: "candidate", patternVersion: 3 },
  ],
  modelVariants: [
    { modelVariantKey: "local", modelProfileId: "MP-LOCAL" },
    { modelVariantKey: "frontier", modelProfileId: "MP-FRONTIER" },
  ],
  installScope: "dpf_dogfood" as const,
  promotionPolicyKey: "work-pattern-promotion",
  promotionPolicyVersion: 4,
};

describe("work-pattern experiment identity", () => {
  it("is deterministic across factor ordering", () => {
    const reordered = {
      ...definition,
      methodVariants: [...definition.methodVariants].reverse(),
      modelVariants: [...definition.modelVariants].reverse(),
    };

    expect(workPatternExperimentDefinitionKey(definition))
      .toBe(workPatternExperimentDefinitionKey(reordered));
  });

  it("separates definitions when a reproducibility dimension changes", () => {
    const base = workPatternExperimentDefinitionKey(definition);

    expect(workPatternExperimentDefinitionKey({
      ...definition,
      oracleVersion: "3",
    })).not.toBe(base);
    expect(workPatternExperimentDefinitionKey({
      ...definition,
      promotionPolicyVersion: 5,
    })).not.toBe(base);
  });

  it("derives stable run, parent, child, and ledger identities", () => {
    const definitionKey = workPatternExperimentDefinitionKey(definition);
    const runId = workPatternExperimentRunId(definitionKey, 2);
    const cellKey = workPatternCellKey({
      methodVariantKey: "candidate",
      modelVariantKey: "local",
    });
    const childId = workPatternExperimentChildTaskRunId({
      experimentRunId: runId,
      cellKey,
      pairKey: "fixture-17",
      attempt: 1,
    });

    expect(runId).toBe(workPatternExperimentRunId(definitionKey, 2));
    expect(runId).not.toBe(workPatternExperimentRunId(definitionKey, 3));
    expect(workPatternExperimentParentTaskRunId(runId))
      .toBe(workPatternExperimentParentTaskRunId(runId));
    expect(childId).toBe(workPatternExperimentChildTaskRunId({
      experimentRunId: runId,
      cellKey,
      pairKey: "fixture-17",
      attempt: 1,
    }));
    expect(childId).not.toBe(workPatternExperimentChildTaskRunId({
      experimentRunId: runId,
      cellKey,
      pairKey: "fixture-17",
      attempt: 2,
    }));
    expect(workPatternExperimentLedgerId({
      experimentRunId: runId,
      childTaskRunId: childId,
      observationKind: "outcome",
      sequence: 1,
    })).not.toBe(workPatternExperimentLedgerId({
      experimentRunId: runId,
      childTaskRunId: childId,
      observationKind: "assignment",
      sequence: 1,
    }));
  });

  it("rejects invalid replicate, attempt, and sequence values", () => {
    const definitionKey = workPatternExperimentDefinitionKey(definition);
    expect(() => workPatternExperimentRunId(definitionKey, 0)).toThrow("invalid_replicate");
    expect(() => workPatternExperimentChildTaskRunId({
      experimentRunId: "WPR-1",
      cellKey: "candidate:local",
      pairKey: "fixture-17",
      attempt: -1,
    })).toThrow("invalid_attempt");
    expect(() => workPatternExperimentLedgerId({
      experimentRunId: "WPR-1",
      childTaskRunId: "TR-1",
      observationKind: "outcome",
      sequence: -1,
    })).toThrow("invalid_sequence");
  });
});
