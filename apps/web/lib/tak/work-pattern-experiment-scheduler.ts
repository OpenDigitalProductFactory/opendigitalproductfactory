import { prisma } from "@dpf/db";
import { CAPABILITY_INSTALL_SCOPES } from "@dpf/db/capability-maturity";

import { isRecord } from "@/lib/shared/coerce";
import {
  parsePersistedWorkPatternExperimentExecution,
} from "@/lib/build/work-pattern-experiment-runtime";
import { enqueueWorkPatternExperiment } from "@/lib/queue/functions/work-pattern-experiment";

import {
  createOrResumeWorkPatternExperiment,
  createPrismaWorkPatternExperimentPersistence,
  type WorkPatternExperimentInput,
} from "./work-pattern-experiment-store";
import {
  parseHermeticBuildReplayFixture,
  type HermeticBuildReplayFixture,
} from "./work-pattern-experiment-fixture";
import type { WorkPatternExperimentDefinitionIdentity } from "./work-pattern-experiment-identity";
import { WORK_PATTERN_EXPERIMENT_RISK_CLASSES } from "./work-pattern-experiment-types";
import { parseWorkPatternExperimentMetadata } from "./work-pattern-experiment-types";
import { DEFAULT_WORK_PATTERN_PROMOTION_POLICY } from "./work-pattern-promotion-policy";

export const MAX_AUTONOMOUS_WORK_PATTERN_REPLICATES =
  DEFAULT_WORK_PATTERN_PROMOTION_POLICY.minimumValidPairCount;

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
    fixtureParts?: HermeticBuildReplayFixture;
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

export async function scheduleReviewedWorkPatternExperiment(input: {
  action: "approve" | "defer" | "reject";
  candidate: unknown;
  reviewerUserId: string;
  orchestratingAgentId: string;
}): Promise<{ scheduled: boolean; parentTaskRunId?: string; reason?: string }> {
  if (input.action !== "approve") return { scheduled: false, reason: "review_not_approved" };
  const candidate = parseReviewedExperimentCandidate(input.candidate);
  if (!candidate) return { scheduled: false, reason: "no_evidence_cleared_experiment" };
  if (
    candidate.definition.promotionPolicyKey
      !== DEFAULT_WORK_PATTERN_PROMOTION_POLICY.policyKey
    || candidate.definition.promotionPolicyVersion
      !== DEFAULT_WORK_PATTERN_PROMOTION_POLICY.version
    || !DEFAULT_WORK_PATTERN_PROMOTION_POLICY.supportedActivityKeys.includes(
      candidate.activityKey,
    )
    || !DEFAULT_WORK_PATTERN_PROMOTION_POLICY.supportedRiskClasses.includes(
      candidate.riskClass,
    )
    || candidate.cells.some(
      (cell) =>
        cell.executionRequest.executionProfile.environmentKey !== "shadow",
    )
  ) {
    return { scheduled: false, reason: "authority_ceiling" };
  }

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
        ...(cell.fixtureParts ? { fixtureParts: cell.fixtureParts } : {}),
      })),
    },
    {
      persistence,
      resolveOwnerUserId: async () => input.reviewerUserId,
    },
  );

  await enqueueWorkPatternExperiment(
    run.manifest.experimentRunId,
    run.parent.taskRunId,
  );
  return { scheduled: true, parentTaskRunId: run.parent.taskRunId };
}

function needsOnlyMoreValidPairs(value: unknown): boolean {
  if (!isRecord(value) || !Array.isArray(value.decisions) || value.decisions.length === 0) {
    return false;
  }
  return value.decisions.every((decision) =>
    isRecord(decision)
    && decision.decision === "continue"
    && Array.isArray(decision.reasons)
    && decision.reasons.length === 1
    && decision.reasons[0] === "minimum_valid_pairs_not_met"
  );
}

/**
 * Continues a successful build experiment to the policy's evidence floor.
 * The next replicate number is explicit, so a retry converges on the same run
 * even if its child event has already started or completed.
 */
export async function scheduleNextWorkPatternExperimentReplicate(input: {
  parentTaskRunId: string;
  promotionResult: unknown;
}): Promise<{
  scheduled: boolean;
  parentTaskRunId?: string;
  replicate?: number;
  reason?: string;
}> {
  if (!needsOnlyMoreValidPairs(input.promotionResult)) {
    return { scheduled: false, reason: "promotion_did_not_request_valid_pairs" };
  }
  const parent = await prisma.taskRun.findUnique({
    where: { taskRunId: input.parentTaskRunId },
    select: {
      id: true,
      userId: true,
      buildId: true,
      currentAgentId: true,
      initiatingAgentId: true,
      status: true,
      a2aMetadata: true,
    },
  });
  const manifest = parseWorkPatternExperimentMetadata(
    isRecord(parent?.a2aMetadata)
      ? parent.a2aMetadata.workPatternExperiment
      : null,
  );
  if (
    !parent
    || parent.status !== "completed"
    || !manifest
    || manifest.lifecycle !== "completed"
    || manifest.activityKey !== "build.implement"
  ) {
    return { scheduled: false, reason: "source_run_not_continuable" };
  }
  if (manifest.replicate >= MAX_AUTONOMOUS_WORK_PATTERN_REPLICATES) {
    return { scheduled: false, reason: "replicate_limit_reached" };
  }
  const orchestratingAgentId =
    parent.currentAgentId ?? parent.initiatingAgentId;
  if (!orchestratingAgentId) {
    return { scheduled: false, reason: "orchestrator_unavailable" };
  }

  const childRows = await prisma.taskRun.findMany({
    where: { parentTaskRunId: parent.id },
    select: { a2aMetadata: true },
    orderBy: { createdAt: "asc" },
  });
  const cells: WorkPatternExperimentInput["cells"] = [];
  let pairKey: string | null = null;
  for (const row of childRows) {
    const metadata =
      isRecord(row.a2aMetadata)
      && isRecord(row.a2aMetadata.workPatternExperimentCell)
        ? row.a2aMetadata.workPatternExperimentCell
        : null;
    const request = parsePersistedWorkPatternExperimentExecution(
      metadata?.executionRequest,
    );
    if (!request) {
      return { scheduled: false, reason: "source_cell_request_unavailable" };
    }
    pairKey ??= request.pairKey;
    if (pairKey !== request.pairKey) {
      return { scheduled: false, reason: "source_pair_mismatch" };
    }
    cells.push({
      methodVariantKey: request.methodVariantKey,
      modelVariantKey: request.modelVariantKey,
      executionRequest: request,
    });
  }
  if (
    !pairKey
    || cells.length !== manifest.requiredCellKeys.length
  ) {
    return { scheduled: false, reason: "source_factorial_incomplete" };
  }

  const nextReplicate = manifest.replicate + 1;
  const persistence = createPrismaWorkPatternExperimentPersistence(prisma as never);
  const run = await createOrResumeWorkPatternExperiment(
    {
      definition: {
        patternKey: manifest.patternKey,
        taskCorpusKey: manifest.taskCorpusKey,
        taskCorpusVersion: manifest.taskCorpusVersion,
        oracleKey: manifest.oracleKey,
        oracleVersion: manifest.oracleVersion,
        methodVariants: manifest.methodVariants,
        modelVariants: manifest.modelVariants,
        installScope: manifest.installScope,
        promotionPolicyKey: manifest.promotionPolicyKey,
        promotionPolicyVersion: manifest.promotionPolicyVersion,
      },
      activityKey: manifest.activityKey,
      riskClass: manifest.riskClass,
      pairKey,
      cells,
      orchestratingAgentId,
      ...(parent.buildId ? { buildId: parent.buildId } : {}),
      replicate: nextReplicate,
    },
    {
      persistence,
      resolveOwnerUserId: async () => parent.userId,
    },
  );
  await enqueueWorkPatternExperiment(
    run.manifest.experimentRunId,
    run.parent.taskRunId,
  );
  return {
    scheduled: true,
    parentTaskRunId: run.parent.taskRunId,
    replicate: nextReplicate,
  };
}
