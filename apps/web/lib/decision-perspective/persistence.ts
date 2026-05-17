import { randomUUID } from "crypto";
import type { DecisionPerspectiveEvaluationResult } from "./types";

type DecisionInteractionClient = {
  decisionInteraction: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
};

function createInteractionId(): string {
  return `DI-${randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`;
}

export async function persistDecisionInteraction(input: {
  db: DecisionInteractionClient;
  build: { buildId: string };
  evaluation: DecisionPerspectiveEvaluationResult;
  deliberationRunId?: string | null;
  taskRunId?: string | null;
}): Promise<{ interactionId: string; row: Record<string, unknown> }> {
  const interactionId = createInteractionId();
  const row = await input.db.decisionInteraction.create({
    data: {
      interactionId,
      profileId: input.evaluation.selectedProfileId,
      profileVersionId: input.evaluation.profileVersionId,
      fallbackProfileId: input.evaluation.fallbackProfileId,
      buildId: input.build.buildId,
      taskRunId: input.taskRunId ?? null,
      deliberationRunId: input.deliberationRunId ?? null,
      routeContext: "/build",
      phaseFrom: "plan",
      phaseTo: "build",
      question: input.evaluation.question,
      options: input.evaluation.options,
      evidenceBundle: {
        materialCount: input.evaluation.materialCount,
        freshnessDistribution: input.evaluation.freshnessDistribution,
        resolvedProfileChain: input.evaluation.resolvedProfileChain,
      },
      sources: input.evaluation.sources,
      rationale: input.evaluation.rationale,
      riskTier: input.evaluation.riskTier,
      confidenceBefore: input.evaluation.confidenceBefore,
      confidenceAfter: input.evaluation.confidenceAfter,
      outcomeType: input.evaluation.outcomeType,
      outcomePayload: {
        confidenceScore: input.evaluation.confidenceScore,
        coverageGap: input.evaluation.coverageGap,
        principleConflict: input.evaluation.principleConflict,
        resolvedProfileChain: input.evaluation.resolvedProfileChain,
        materialCount: input.evaluation.materialCount,
        freshnessDistribution: input.evaluation.freshnessDistribution,
      },
    },
  }) as Record<string, unknown>;

  return { interactionId, row };
}
