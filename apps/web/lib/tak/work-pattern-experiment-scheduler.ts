import { prisma } from "@dpf/db";

import {
  parsePersistedWorkPatternExperimentExecution,
} from "@/lib/build/work-pattern-experiment-runtime";
import { isRecord } from "@/lib/shared/coerce";
import { enqueueWorkPatternExperiment } from "@/lib/queue/functions/work-pattern-experiment";

import {
  isPromotionPolicyAdmissible,
  parseReviewedExperimentCandidate,
  type ReviewedExperimentCandidate,
} from "./work-pattern-experiment-candidate-schema";
import {
  createOrResumeWorkPatternExperiment,
  createPrismaWorkPatternExperimentPersistence,
  type WorkPatternExperimentInput,
} from "./work-pattern-experiment-store";
import { parseWorkPatternExperimentMetadata } from "./work-pattern-experiment-types";
import { DEFAULT_WORK_PATTERN_PROMOTION_POLICY } from "./work-pattern-promotion-policy";

export {
  isPromotionPolicyAdmissible,
  parseReviewedExperimentCandidate,
  type ReviewedExperimentCandidate,
};

export const MAX_AUTONOMOUS_WORK_PATTERN_REPLICATES =
  DEFAULT_WORK_PATTERN_PROMOTION_POLICY.minimumValidPairCount;

export async function scheduleReviewedWorkPatternExperiment(input: {
  action: "approve" | "defer" | "reject";
  candidate: unknown;
  reviewerUserId: string;
  orchestratingAgentId: string;
}): Promise<{ scheduled: boolean; parentTaskRunId?: string; reason?: string }> {
  if (input.action !== "approve") return { scheduled: false, reason: "review_not_approved" };
  const candidate = parseReviewedExperimentCandidate(input.candidate);
  if (!candidate) return { scheduled: false, reason: "no_evidence_cleared_experiment" };
  if (!isPromotionPolicyAdmissible(candidate)) {
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
