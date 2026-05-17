import type {
  BuildDeliberationSummary,
  BuildPhase,
  ReviewResult,
} from "@/lib/feature-build-types";
import { MARK_DPF_PLATFORM_PROFILE } from "./default-profile";
import { RECENT_OVERRIDE_WINDOW_DAYS, evaluateDecisionPerspective } from "./evaluator";
import { resolveProfileMaterial } from "./material";
import {
  createDecisionInteractionId,
  findExistingDecisionInteraction,
  persistDecisionInteraction,
} from "./persistence";
import type {
  DecisionDomainClass,
  DecisionPerspectiveEvaluationInput,
  DecisionPerspectiveEvaluationResult,
  DecisionPerspectiveProfile,
} from "./types";
import { PLAN_READINESS_DOMAIN_CLASS } from "./types";

type BuildStudioGateClient = Parameters<typeof resolveProfileMaterial>[0]["db"]
  & Parameters<typeof persistDecisionInteraction>[0]["db"]
  & {
    escalationCapture?: {
      count(args: { where: Record<string, unknown> }): Promise<number>;
    };
  };

type GateEvaluator = (input: DecisionPerspectiveEvaluationInput) => DecisionPerspectiveEvaluationResult;

export type BuildStudioDecisionGateResult = {
  allowed: boolean;
  interactionId: string;
  evaluation: DecisionPerspectiveEvaluationResult;
  operatorMessage: string;
};

export type BuildStudioPlanAdvancementBuild = {
  buildId: string;
  title: string;
  phase?: BuildPhase;
  planReview: ReviewResult | null;
  deliberationSummary: BuildDeliberationSummary | null;
};

function planAdvancementQuestion(build: BuildStudioPlanAdvancementBuild): string {
  return `Start implementation for "${build.title}" from the reviewed Build Studio plan?`;
}

function planAdvancementOptions(): string[] {
  return [
    "Start implementation",
    "Revise the implementation plan",
    "Escalate to the Build Studio owner",
  ];
}

function planDeliberationRunId(build: BuildStudioPlanAdvancementBuild): string | null {
  return build.deliberationSummary?.plan?.deliberationRunId ?? null;
}

function traceWwmd(event: string, payload: Record<string, unknown>): void {
  console.info(`[tool-trace] ${event} ${JSON.stringify(payload)}`);
}

function operatorMessageFor(evaluation: DecisionPerspectiveEvaluationResult): string {
  if (evaluation.outcomeType === "defer") {
    return `WWMD found a coverage gap for this decision class. ${evaluation.rationale}`;
  }
  if (evaluation.outcomeType === "escalate") {
    return `WWMD requires escalation before implementation starts. ${evaluation.rationale}`;
  }
  if (evaluation.outcomeType === "arbitrate") {
    return `WWMD arbitrated this low-risk decision with ${evaluation.confidenceScore} confidence.`;
  }
  return `WWMD recommends starting implementation with ${evaluation.confidenceScore} confidence.`;
}

function errorClass(error: unknown): string {
  return error instanceof Error && error.name ? error.name : "UnknownError";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function failClosedEvaluation(input: {
  profile: DecisionPerspectiveProfile;
  question: string;
  options: string[];
  riskTier: "medium";
  error: unknown;
  resolvedProfileChain: string[];
}): DecisionPerspectiveEvaluationResult {
  const className = errorClass(input.error);
  return {
    outcomeType: "escalate",
    selectedProfileId: input.profile.profileId,
    fallbackProfileId: null,
    profileVersionId: input.profile.currentVersion.versionId,
    confidenceBefore: 0,
    confidenceAfter: 0,
    confidenceScore: 0,
    coverageGap: false,
    principleConflict: false,
    domainClass: PLAN_READINESS_DOMAIN_CLASS,
    resolvedProfileChain: input.resolvedProfileChain,
    materialCount: 0,
    freshnessDistribution: { current: 0, stale: 0, superseded: 0, contradicted: 0 },
    riskTier: input.riskTier,
    question: input.question,
    options: input.options,
    rationale:
      `WWMD fail-closed escalation: ${className}. The decision kernel could not safely evaluate this advancement request.`,
    materialScores: [],
    sources: [],
    gapReason: "material-below-confidence",
  };
}

async function recentOverrideCount(input: {
  db: BuildStudioGateClient;
  profileId: string;
  now: Date;
}): Promise<number> {
  if (!input.db.escalationCapture?.count) return 0;
  const gte = new Date(input.now.getTime() - RECENT_OVERRIDE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return input.db.escalationCapture.count({
    where: {
      domainClass: PLAN_READINESS_DOMAIN_CLASS,
      createdAt: { gte },
      interaction: { profileId: input.profileId },
    },
  });
}

export async function evaluateBuildStudioPlanAdvancementGate(input: {
  db: BuildStudioGateClient;
  build: BuildStudioPlanAdvancementBuild;
  profileId?: string;
  recentOverrideCount?: number;
  triggeredByUserId?: string | null;
  evaluator?: GateEvaluator;
  now?: Date;
}): Promise<BuildStudioDecisionGateResult> {
  const interactionId = createDecisionInteractionId();
  const question = planAdvancementQuestion(input.build);
  const options = planAdvancementOptions();
  const riskTier = "medium" as const;
  const now = input.now ?? new Date();

  let resolved;
  let profile = MARK_DPF_PLATFORM_PROFILE;
  try {
    resolved = await resolveProfileMaterial({
      db: input.db,
      profileId: input.profileId ?? MARK_DPF_PLATFORM_PROFILE.profileId,
      domainClass: PLAN_READINESS_DOMAIN_CLASS,
    });
    profile = resolved.selectedProfile ?? MARK_DPF_PLATFORM_PROFILE;
  } catch (error) {
    const evaluation = failClosedEvaluation({
      profile,
      question,
      options,
      riskTier,
      error,
      resolvedProfileChain: [input.profileId ?? MARK_DPF_PLATFORM_PROFILE.profileId],
    });
    traceWwmd("wwmd.gate.invoked", {
      interactionId,
      profileId: profile.profileId,
      profileVersionId: profile.currentVersion.versionId,
      domainClass: PLAN_READINESS_DOMAIN_CLASS,
      riskTier,
      featureBuildId: input.build.buildId,
      triggeredByUserId: input.triggeredByUserId ?? null,
    });
    traceWwmd("wwmd.evaluator.failed", {
      interactionId,
      errorClass: errorClass(error),
      errorMessage: errorMessage(error),
    });
    await persistDecisionInteraction({
      db: input.db,
      build: input.build,
      evaluation,
      deliberationRunId: planDeliberationRunId(input.build),
      triggeredByUserId: input.triggeredByUserId,
      interactionId,
    });
    traceWwmd("wwmd.ledger.written", { interactionId, outcomeType: evaluation.outcomeType });
    return {
      allowed: false,
      interactionId,
      evaluation,
      operatorMessage: operatorMessageFor(evaluation),
    };
  }

  traceWwmd("wwmd.gate.invoked", {
    interactionId,
    profileId: profile.profileId,
    profileVersionId: profile.currentVersion.versionId,
    domainClass: PLAN_READINESS_DOMAIN_CLASS,
    riskTier,
    featureBuildId: input.build.buildId,
    triggeredByUserId: input.triggeredByUserId ?? null,
  });

  traceWwmd("wwmd.profile.resolved", {
    interactionId,
    resolvedProfileChain: resolved.resolvedProfileChain,
    materialCount: resolved.materials.length,
    coverageGap: resolved.coverageGap,
  });

  const existing = await findExistingDecisionInteraction({
    db: input.db,
    build: input.build,
    phaseFrom: "plan",
    phaseTo: "build",
    profileVersionId: profile.currentVersion.versionId,
  });
  if (existing) {
    traceWwmd("wwmd.idempotent.hit", {
      interactionId: existing.interactionId,
      featureBuildId: input.build.buildId,
      phaseFrom: "plan",
      phaseTo: "build",
    });
    return {
      allowed: existing.evaluation.outcomeType === "recommend" || existing.evaluation.outcomeType === "arbitrate",
      interactionId: existing.interactionId,
      evaluation: existing.evaluation,
      operatorMessage: operatorMessageFor(existing.evaluation),
    };
  }

  const overrides = input.recentOverrideCount
    ?? await recentOverrideCount({ db: input.db, profileId: profile.profileId, now });
  const evaluator = input.evaluator ?? evaluateDecisionPerspective;

  let evaluation: DecisionPerspectiveEvaluationResult;
  try {
    evaluation = evaluator({
      profile,
      fallbackProfiles: [],
      materials: resolved.materials,
      question,
      questionDomain: PLAN_READINESS_DOMAIN_CLASS,
      options,
      riskTier,
      recentOverrideCount: overrides,
      evidence: [
        {
          label: "Plan review",
          sourceType: "build-studio-plan-review",
          grade: input.build.planReview?.decision === "pass" ? "A" : "C",
          summary: input.build.planReview?.summary ?? "No plan review summary recorded.",
        },
        ...(input.build.deliberationSummary?.plan
          ? [{
            label: "Plan deliberation",
            sourceType: "deliberation-outcome",
            grade: input.build.deliberationSummary.plan.evidenceQuality === "source-backed" ? "A" as const : "B" as const,
            summary: input.build.deliberationSummary.plan.rationaleSummary,
          }]
          : []),
      ],
    });
  } catch (error) {
    evaluation = failClosedEvaluation({
      profile,
      question,
      options,
      riskTier,
      error,
      resolvedProfileChain: resolved.resolvedProfileChain,
    });
    traceWwmd("wwmd.evaluator.failed", {
      interactionId,
      errorClass: errorClass(error),
      errorMessage: errorMessage(error),
    });
  }

  if (resolved.coverageGap) {
    evaluation.outcomeType = "defer";
    evaluation.coverageGap = true;
    evaluation.rationale =
      "Decision perspective coverage gap: no active profile or fallback profile has applicable material for Build Studio plan advancement.";
    evaluation.resolvedProfileChain = resolved.resolvedProfileChain;
  }

  traceWwmd("wwmd.evaluator.complete", {
    interactionId,
    confidenceScore: evaluation.confidenceScore,
    outcomeType: evaluation.outcomeType,
    principleConflict: evaluation.principleConflict,
    freshnessDistribution: evaluation.freshnessDistribution,
  });

  const persisted = await persistDecisionInteraction({
    db: input.db,
    build: input.build,
    evaluation,
    deliberationRunId: planDeliberationRunId(input.build),
    triggeredByUserId: input.triggeredByUserId,
    interactionId,
  });
  traceWwmd("wwmd.ledger.written", { interactionId: persisted.interactionId, outcomeType: evaluation.outcomeType });

  return {
    allowed: evaluation.outcomeType === "recommend" || evaluation.outcomeType === "arbitrate",
    interactionId: persisted.interactionId,
    evaluation,
    operatorMessage: operatorMessageFor(evaluation),
  };
}
