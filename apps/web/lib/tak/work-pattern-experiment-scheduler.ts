import { prisma } from "@dpf/db";
import { CAPABILITY_INSTALL_SCOPES } from "@dpf/db/capability-maturity";

import { isRecord } from "@/lib/shared/coerce";
import {
  parsePersistedWorkPatternExperimentExecution,
} from "@/lib/integrate/work-pattern-experiment-runtime";
import { inngest } from "@/lib/queue/inngest-client";

import {
  createOrResumeWorkPatternExperiment,
  createPrismaWorkPatternExperimentPersistence,
} from "./work-pattern-experiment-store";
import type { WorkPatternExperimentDefinitionIdentity } from "./work-pattern-experiment-identity";
import { WORK_PATTERN_EXPERIMENT_RISK_CLASSES } from "./work-pattern-experiment-types";

type ReviewedExperimentCandidate = {
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
  }>;
};

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseReviewedExperimentCandidate(value: unknown): ReviewedExperimentCandidate | null {
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
    || definition.methodVariants.length === 0
    || definition.modelVariants.length === 0
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

  const cells: ReviewedExperimentCandidate["cells"] = [];
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
      || executionRequest.executionProfile.environmentKey !== "shadow"
    ) {
      return null;
    }
    cells.push({
      methodVariantKey: rawCell.methodVariantKey,
      modelVariantKey: rawCell.modelVariantKey,
      executionRequest,
    });
  }
  if (cells.length === 0) return null;

  return {
    definition: definition as unknown as WorkPatternExperimentDefinitionIdentity,
    activityKey: value.activityKey,
    riskClass: value.riskClass as ReviewedExperimentCandidate["riskClass"],
    pairKey: value.pairKey,
    cells,
  };
}

export async function scheduleReviewedWorkPatternExperiment(input: {
  action: "approve" | "defer" | "reject";
  candidate: unknown;
  reviewerUserId: string;
  orchestratingAgentId: string;
}): Promise<{ scheduled: boolean; parentTaskRunId?: string; reason?: string }> {
  if (input.action !== "approve") return { scheduled: false, reason: "review_not_approved" };
  const candidate = parseReviewedExperimentCandidate(input.candidate);
  if (!candidate) return { scheduled: false, reason: "no_evidence_cleared_experiment" };

  const persistence = createPrismaWorkPatternExperimentPersistence(prisma as never);
  const run = await createOrResumeWorkPatternExperiment(
    {
      definition: candidate.definition,
      activityKey: candidate.activityKey,
      riskClass: candidate.riskClass,
      pairKey: candidate.pairKey,
      orchestratingAgentId: input.orchestratingAgentId,
      cells: candidate.cells.map((cell) => ({
        methodVariantKey: cell.methodVariantKey,
        modelVariantKey: cell.modelVariantKey,
        executionRequest: cell.executionRequest,
      })),
    },
    {
      persistence,
      resolveOwnerUserId: async () => input.reviewerUserId,
    },
  );

  await inngest.send({
    id: `work-pattern-experiment:${run.manifest.experimentRunId}`,
    name: "build/work-pattern-experiment.run",
    data: { parentTaskRunId: run.parent.taskRunId },
  });
  return { scheduled: true, parentTaskRunId: run.parent.taskRunId };
}
