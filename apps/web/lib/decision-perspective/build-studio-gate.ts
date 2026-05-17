import type {
  BuildDeliberationSummary,
  BuildPhase,
  ReviewResult,
} from "@/lib/feature-build-types";
import { MARK_DPF_PLATFORM_PROFILE } from "./default-profile";
import { evaluateDecisionPerspective } from "./evaluator";
import { resolveProfileMaterial } from "./material";
import { persistDecisionInteraction } from "./persistence";
import type { DecisionPerspectiveEvaluationResult } from "./types";

type BuildStudioGateClient = Parameters<typeof resolveProfileMaterial>[0]["db"]
  & Parameters<typeof persistDecisionInteraction>[0]["db"];

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

export async function evaluateBuildStudioPlanAdvancementGate(input: {
  db: BuildStudioGateClient;
  build: BuildStudioPlanAdvancementBuild;
  profileId?: string;
  recentOverrideCount?: number;
}): Promise<BuildStudioDecisionGateResult> {
  const resolved = await resolveProfileMaterial({
    db: input.db,
    profileId: input.profileId ?? MARK_DPF_PLATFORM_PROFILE.profileId,
    domainClass: "build-studio-plan-advancement",
  });
  const profile = resolved.selectedProfile ?? MARK_DPF_PLATFORM_PROFILE;

  const evaluation = evaluateDecisionPerspective({
    profile,
    fallbackProfiles: [],
    materials: resolved.materials,
    question: planAdvancementQuestion(input.build),
    questionDomain: "build-studio-plan-advancement",
    options: planAdvancementOptions(),
    riskTier: "medium",
    recentOverrideCount: input.recentOverrideCount ?? 0,
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

  if (resolved.coverageGap) {
    evaluation.outcomeType = "defer";
    evaluation.coverageGap = true;
    evaluation.rationale =
      "Decision perspective coverage gap: no active profile or fallback profile has applicable material for Build Studio plan advancement.";
    evaluation.resolvedProfileChain = resolved.resolvedProfileChain;
  }

  const persisted = await persistDecisionInteraction({
    db: input.db,
    build: input.build,
    evaluation,
    deliberationRunId: planDeliberationRunId(input.build),
  });

  return {
    allowed: evaluation.outcomeType === "recommend" || evaluation.outcomeType === "arbitrate",
    interactionId: persisted.interactionId,
    evaluation,
    operatorMessage: operatorMessageFor(evaluation),
  };
}
