import type {
  BuildDeliberationSummary,
  BuildPhase,
  ReviewResult,
} from "@/lib/feature-build-types";
import { evaluatePerspectiveGate } from "./evaluator";
import type {
  DecisionPerspectiveEvaluationInput,
  DecisionPerspectiveEvaluationResult,
  DecisionRiskTier,
  DecisionScoredOption,
} from "./types";
import { PLAN_READINESS_DOMAIN_CLASS } from "./types";
import { runVoiceSynthesisJob } from "../voice-synthesis/synthesis-job";
import {
  realAcumenGapNomination,
  runAcumenPhaseConsults,
  summarizeAcumenConsults,
  type AcumenConsultResult,
} from "./acumen-phase-consult";

type BuildStudioGateClient = any;
type GateEvaluator = (input: DecisionPerspectiveEvaluationInput) => DecisionPerspectiveEvaluationResult;
type AcumenConsultRunner = typeof runAcumenPhaseConsults;

export type BuildStudioDecisionGateResult = {
  allowed: boolean;
  interactionId: string;
  evaluation: DecisionPerspectiveEvaluationResult;
  operatorMessage: string;
  /**
   * W16 (BI-18519A73): advisory consults from the acumens impacted by the
   * phase's planned file paths. Present only when the caller supplied
   * `plannedFilePaths`; NEVER changes `allowed` — blocking on acumen verdicts
   * is a later, ratified step.
   */
  acumenConsults?: AcumenConsultResult[];
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

// BI-D88DFEEA Phase 1. Structural feature vectors for the fixed 3-option
// menu above, scored on the axes each option genuinely exhibits (not a
// goodness rating — see the dimension-catalog convention this mirrors):
// starting now buys speed but commits resources; revising trades speed for
// maintainability and stays fully reversible; escalating trades speed for
// governance oversight at the cost of a human's attention. Feeds
// option-recommendation.ts so the gate can record which of the three the
// kernel's commandments would pick, alongside what the human actually chose.
function scoredPlanAdvancementOptions(): DecisionScoredOption[] {
  return [
    {
      id: "proceed",
      description: "Start implementation",
      features: {
        speed_to_value: 0.85,
        reversibility: 0.4,
        blast_radius: 0.3,
        human_cognitive_load: 0.15,
        long_term_maintainability: 0.5,
        governance_compliance: 0.3,
      },
    },
    {
      id: "revise",
      description: "Revise the implementation plan",
      features: {
        speed_to_value: 0.35,
        reversibility: 0.9,
        blast_radius: 0.1,
        human_cognitive_load: 0.35,
        long_term_maintainability: 0.8,
        governance_compliance: 0.4,
      },
    },
    {
      id: "escalate",
      description: "Escalate to the Build Studio owner",
      features: {
        speed_to_value: 0.15,
        reversibility: 0.95,
        blast_radius: 0.05,
        human_cognitive_load: 0.6,
        long_term_maintainability: 0.3,
        governance_compliance: 0.85,
      },
    },
  ];
}

export async function evaluateBuildStudioPlanAdvancementGate(input: {
  db: BuildStudioGateClient;
  build: BuildStudioPlanAdvancementBuild;
  profileId?: string;
  recentOverrideCount?: number;
  triggeredByUserId?: string | null;
  evaluator?: GateEvaluator;
  now?: Date;
  riskTier?: DecisionRiskTier;
  /**
   * W16 (BI-18519A73): file paths the build plans to touch. When absent the
   * gate behaves byte-identically to before; when present, each IMPACTED
   * acumen's profession gate is consulted (advisory) and the results are
   * attached to the return + summarized in the operator message.
   */
  plannedFilePaths?: readonly string[];
  /** Injectable for tests; defaults to the real consult composition. */
  acumenConsultRunner?: AcumenConsultRunner;
}): Promise<BuildStudioDecisionGateResult> {
  const question = planAdvancementQuestion(input.build);
  const options = planAdvancementOptions();
  const riskTier = input.riskTier ?? "medium";

  const result = await evaluatePerspectiveGate({
    db: input.db,
    profileId: input.profileId,
    question,
    options,
    scoredOptions: scoredPlanAdvancementOptions(),
    domainClass: PLAN_READINESS_DOMAIN_CLASS,
    riskTier,
    routeContext: "/build",
    build: input.build,
    triggeredByUserId: input.triggeredByUserId,
    recentOverrideCount: input.recentOverrideCount,
    evaluator: input.evaluator,
    now: input.now,
    onComplete: (interactionId) => {
      runVoiceSynthesisJob(interactionId).catch((err: unknown) => {
        console.info("[tool-trace] wwmd.voice.dispatch.failed", { interactionId, error: String(err) });
      });
    },
  });

  const gateResult: BuildStudioDecisionGateResult = {
    allowed: result.allowed,
    interactionId: result.interactionId,
    evaluation: result.evaluation,
    operatorMessage: result.operatorMessage,
  };

  // W16 (BI-18519A73): advisory acumen consults, only when the caller told us
  // which files the phase intends to touch. The `allowed` verdict above is
  // final before the consults run and is never revised by them.
  if (input.plannedFilePaths && input.plannedFilePaths.length > 0) {
    const runConsults = input.acumenConsultRunner ?? runAcumenPhaseConsults;
    const acumenConsults = await runConsults({
      db: input.db,
      filePaths: input.plannedFilePaths,
      question,
      options,
      optionFeatures: scoredPlanAdvancementOptions(),
      riskTier,
      callingPopulation: "build_studio_phase_gate",
      routeContext: "/build",
      phaseFrom: "plan",
      phaseTo: "build",
      triggeredByUserId: input.triggeredByUserId,
      nominateGap: realAcumenGapNomination,
    });
    if (acumenConsults.length > 0) {
      gateResult.acumenConsults = acumenConsults;
      gateResult.operatorMessage = `${gateResult.operatorMessage} ${summarizeAcumenConsults(acumenConsults)}`;
    }
  }

  return gateResult;
}
