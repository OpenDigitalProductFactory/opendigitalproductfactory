import type {
  BuildDeliberationSummary,
  ReviewResult,
} from "@/lib/feature-build-types";
import type { DeliverableSensitivity } from "@/lib/explore/build-process-matrix";

import { deriveTransitionRiskTier } from "./graduated-autonomy";
import { evaluatePerspectiveGate } from "./evaluator";

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
}) {
  return evaluatePerspectiveGate({
    db: input.db,
    question: `Ship the verified build ${input.build.buildId} through the repository merge queue and governed release?`,
    options: [
      "Ship through the governed delivery path",
      "Hold for more evidence",
      "Escalate to the Build Studio owner",
    ],
    domainClass: "risk-assessment",
    riskTier: deriveTransitionRiskTier({
      sensitivity: input.sensitivity,
      transition: "ship",
    }),
    routeContext: "/build",
    build: input.build,
    phaseFrom: "review",
    phaseTo: "ship",
    triggeredByUserId: input.triggeredByUserId,
  });
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
