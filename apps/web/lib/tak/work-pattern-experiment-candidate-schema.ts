import { CAPABILITY_INSTALL_SCOPES } from "@dpf/db/capability-maturity";

import {
  parsePersistedWorkPatternExperimentExecution,
} from "@/lib/build/work-pattern-experiment-runtime";
import { isRecord } from "@/lib/shared/coerce";

import {
  parseHermeticBuildReplayFixture,
  type HermeticBuildReplayFixture,
} from "./work-pattern-experiment-fixture";
import type { WorkPatternExperimentDefinitionIdentity } from "./work-pattern-experiment-identity";
import { WORK_PATTERN_EXPERIMENT_RISK_CLASSES } from "./work-pattern-experiment-types";
import { DEFAULT_WORK_PATTERN_PROMOTION_POLICY } from "./work-pattern-promotion-policy";

export type ReviewedExperimentCandidate = {
  definition: WorkPatternExperimentDefinitionIdentity;
  activityKey: string;
  riskClass: (typeof WORK_PATTERN_EXPERIMENT_RISK_CLASSES)[number];
  pairKey: string;
  cells: Array<{
    methodVariantKey: string;
    modelVariantKey: string;
    executionRequest: NonNullable<
      ReturnType<typeof parsePersistedWorkPatternExperimentExecution>
    >;
    fixtureParts?: HermeticBuildReplayFixture;
  }>;
};

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function parseReviewedExperimentCandidate(
  value: unknown,
): ReviewedExperimentCandidate | null {
  if (!isRecord(value) || !isRecord(value.definition) || !Array.isArray(value.cells)) {
    return null;
  }
  const definition = value.definition;
  if (
    !nonEmptyString(value.activityKey)
    || !nonEmptyString(value.pairKey)
    || !WORK_PATTERN_EXPERIMENT_RISK_CLASSES.includes(
      value.riskClass as ReviewedExperimentCandidate["riskClass"],
    )
    || !nonEmptyString(definition.patternKey)
    || !nonEmptyString(definition.taskCorpusKey)
    || !nonEmptyString(definition.taskCorpusVersion)
    || !nonEmptyString(definition.oracleKey)
    || !nonEmptyString(definition.oracleVersion)
    || !Array.isArray(definition.methodVariants)
    || !Array.isArray(definition.modelVariants)
    || definition.methodVariants.length < 2
    || definition.modelVariants.length < 2
    || definition.methodVariants.some(
      (variant) =>
        !isRecord(variant)
        || !nonEmptyString(variant.methodVariantKey)
        || !Number.isInteger(variant.patternVersion)
        || (variant.patternVersion as number) <= 0,
    )
    || definition.modelVariants.some(
      (variant) =>
        !isRecord(variant)
        || !nonEmptyString(variant.modelVariantKey)
        || !nonEmptyString(variant.modelProfileId),
    )
    || !CAPABILITY_INSTALL_SCOPES.includes(
      definition.installScope as (typeof CAPABILITY_INSTALL_SCOPES)[number],
    )
    || !nonEmptyString(definition.promotionPolicyKey)
    || !Number.isInteger(definition.promotionPolicyVersion)
  ) {
    return null;
  }
  const typedDefinition =
    definition as unknown as WorkPatternExperimentDefinitionIdentity;

  const cells: ReviewedExperimentCandidate["cells"] = [];
  const expectedCells = new Set(
    typedDefinition.methodVariants.flatMap((method) =>
      typedDefinition.modelVariants.map(
        (model) => `${method.methodVariantKey}:${model.modelVariantKey}`,
      )),
  );
  const seenCells = new Set<string>();
  for (const rawCell of value.cells) {
    if (!isRecord(rawCell)) return null;
    const executionRequest = parsePersistedWorkPatternExperimentExecution(
      rawCell.executionRequest,
    );
    if (
      !executionRequest
      || !nonEmptyString(rawCell.methodVariantKey)
      || !nonEmptyString(rawCell.modelVariantKey)
      || executionRequest.methodVariantKey !== rawCell.methodVariantKey
      || executionRequest.modelVariantKey !== rawCell.modelVariantKey
      || !expectedCells.has(
        `${rawCell.methodVariantKey}:${rawCell.modelVariantKey}`,
      )
      || seenCells.has(
        `${rawCell.methodVariantKey}:${rawCell.modelVariantKey}`,
      )
      || executionRequest.executionProfile.activityKey !== value.activityKey
      || executionRequest.executionProfile.riskClass !== value.riskClass
      || executionRequest.executionProfile.patternKey
        !== typedDefinition.patternKey
      || executionRequest.executionProfile.taskCorpusKey
        !== typedDefinition.taskCorpusKey
      || executionRequest.executionProfile.taskCorpusVersion
        !== typedDefinition.taskCorpusVersion
      || executionRequest.oracleKey !== typedDefinition.oracleKey
      || executionRequest.oracleVersion !== typedDefinition.oracleVersion
    ) {
      return null;
    }
    const method = typedDefinition.methodVariants.find(
      (variant) => variant.methodVariantKey === rawCell.methodVariantKey,
    );
    const model = typedDefinition.modelVariants.find(
      (variant) => variant.modelVariantKey === rawCell.modelVariantKey,
    );
    if (
      !method
      || !model
      || executionRequest.executionProfile.patternVersion
        !== method.patternVersion
      || executionRequest.executionProfile.modelProfileId
        !== model.modelProfileId
    ) {
      return null;
    }
    const fixture = rawCell.fixtureParts === undefined
      ? undefined
      : parseHermeticBuildReplayFixture(rawCell.fixtureParts);
    if (
      rawCell.fixtureParts !== undefined
      && (
        !fixture
        || !fixture.methodInstructions[
          executionRequest.executionProfile.promptOrSkillDigest
        ]
      )
    ) {
      return null;
    }
    seenCells.add(
      `${rawCell.methodVariantKey}:${rawCell.modelVariantKey}`,
    );
    cells.push({
      methodVariantKey: rawCell.methodVariantKey,
      modelVariantKey: rawCell.modelVariantKey,
      executionRequest,
      ...(fixture ? { fixtureParts: fixture } : {}),
    });
  }
  if (
    cells.length !== expectedCells.size
    || seenCells.size !== expectedCells.size
  ) {
    return null;
  }

  return {
    definition: typedDefinition,
    activityKey: value.activityKey,
    riskClass: value.riskClass as ReviewedExperimentCandidate["riskClass"],
    pairKey: value.pairKey,
    cells,
  };
}

export function isPromotionPolicyAdmissible(
  candidate: ReviewedExperimentCandidate,
): boolean {
  return (
    candidate.definition.promotionPolicyKey
      === DEFAULT_WORK_PATTERN_PROMOTION_POLICY.policyKey
    && candidate.definition.promotionPolicyVersion
      === DEFAULT_WORK_PATTERN_PROMOTION_POLICY.version
    && DEFAULT_WORK_PATTERN_PROMOTION_POLICY.supportedActivityKeys.includes(
      candidate.activityKey,
    )
    && DEFAULT_WORK_PATTERN_PROMOTION_POLICY.supportedRiskClasses.includes(
      candidate.riskClass,
    )
    && candidate.cells.every(
      (cell) =>
        cell.executionRequest.executionProfile.environmentKey === "shadow",
    )
  );
}
