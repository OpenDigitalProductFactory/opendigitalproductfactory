import type {
  BuildDeliberationSummary,
  ReviewResult,
} from "@/lib/feature-build-types";
import type { DeliverableSensitivity } from "@/lib/explore/build-process-matrix";

import { deriveTransitionRiskTier } from "./graduated-autonomy";
import { evaluatePerspectiveGate } from "./evaluator";
import {
  realAcumenGapNomination,
  runAcumenPhaseConsults,
  summarizeAcumenConsults,
} from "./acumen-phase-consult";

export type BuildStudioShipGateBuild = {
  buildId: string;
  planReview: ReviewResult | null;
  deliberationSummary: BuildDeliberationSummary | null;
};

export async function evaluateBuildStudioShipGate(input: {
  db: any;
  build: BuildStudioShipGateBuild;
  sensitivity: DeliverableSensitivity;
  triggeredByUserId?: string | null;
  /**
   * W16 (BI-18519A73): file paths the shipping build touched. When absent the
   * gate behaves byte-identically to before; when present, each IMPACTED
   * acumen's profession gate is consulted (advisory only — the ship verdict is
   * never changed by an acumen outcome).
   */
  plannedFilePaths?: readonly string[];
  /** Injectable for tests; defaults to the real consult composition. */
  acumenConsultRunner?: typeof runAcumenPhaseConsults;
}) {
  const question = `Ship the verified build ${input.build.buildId} through the repository merge queue and governed release?`;
  const options = [
    "Ship through the governed delivery path",
    "Hold for more evidence",
    "Escalate to the Build Studio owner",
  ];
  const riskTier = deriveTransitionRiskTier({
    sensitivity: input.sensitivity,
    transition: "ship",
  });

  const result = await evaluatePerspectiveGate({
    db: input.db,
    question,
    options,
    domainClass: "risk-assessment",
    riskTier,
    routeContext: "/build",
    build: input.build,
    phaseFrom: "review",
    phaseTo: "ship",
    triggeredByUserId: input.triggeredByUserId,
  });

  // W16 (BI-18519A73): advisory acumen consults; the `allowed` verdict above
  // is final before the consults run and is never revised by them.
  if (!input.plannedFilePaths || input.plannedFilePaths.length === 0) {
    return result;
  }
  const runConsults = input.acumenConsultRunner ?? runAcumenPhaseConsults;
  const acumenConsults = await runConsults({
    db: input.db,
    filePaths: input.plannedFilePaths,
    question,
    options,
    riskTier,
    callingPopulation: "build_studio_phase_gate",
    routeContext: "/build",
    phaseFrom: "review",
    phaseTo: "ship",
    triggeredByUserId: input.triggeredByUserId,
    nominateGap: realAcumenGapNomination,
  });
  if (acumenConsults.length === 0) return result;
  return {
    ...result,
    acumenConsults,
    operatorMessage: `${result.operatorMessage} ${summarizeAcumenConsults(acumenConsults)}`,
  };
}

export async function evaluateBuildStudioIdeateStartGate(input: {
  db: any;
  build: BuildStudioShipGateBuild;
  sensitivity: DeliverableSensitivity;
  triggeredByUserId?: string | null;
}) {
  return evaluatePerspectiveGate({
    db: input.db,
    question: `Start governed design work for ${input.build.buildId}?`,
    options: [
      "Start governed design work",
      "Hold for more intake evidence",
      "Escalate to the Build Studio owner",
    ],
    domainClass: "plan-readiness",
    riskTier: deriveTransitionRiskTier({
      sensitivity: input.sensitivity,
      transition: "ideate-start",
    }),
    routeContext: "/build",
    build: input.build,
    phaseFrom: "intake",
    phaseTo: "ideate",
    triggeredByUserId: input.triggeredByUserId,
  });
}
