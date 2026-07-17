// Org/WWWD business-decision gate (BI-230C9EF7, EP-8AF1C996).
//
// The org + profession DecisionPerspectiveProfiles are seeded on install (mission
// / how-we-decide / profession corpus) but were DORMANT: resolveProfileMaterialForOrg
// is built + tested yet called by zero decision surfaces. This gate activates them
// so a coworker's business decision is actually governed by the organization's own
// recorded stance (WWWD) -- falling back to platform doctrine only as ADVISORY when
// the org is silent, never letting platform doctrine bind a business call.
//
// It mirrors evaluateBuildStudioPlanAdvancementGate (the WWMD/build gate) but keyed
// on organizationId instead of a build, with no build-phase idempotency and no voice
// dispatch. Pure composition of three already-tested primitives:
// resolveProfileMaterialForOrg -> evaluateDecisionPerspective -> persistDecisionInteraction.
//
// It records every decision (proposed outcome + profile chain + orgProfileSelected) to
// the DecisionInteraction ledger -- the substrate the trust-graduation dial reads to
// measure agreement before any autonomy is released. Fail-closed: any resolver/evaluator
// error escalates to a human and is still recorded.

import { evaluatePerspectiveGate } from "./evaluator";
import type { DecisionGateCaller } from "./evaluator";
import { resolveProfileMaterialForOrg } from "./material";
import type {
  DecisionDomainClass,
  DecisionPerspectiveEvaluationInput,
  DecisionPerspectiveEvaluationResult,
  DecisionRiskTier,
  DecisionEvidenceItem,
} from "./types";

type OrgBusinessGateClient = any;
type GateEvaluator = (input: DecisionPerspectiveEvaluationInput) => DecisionPerspectiveEvaluationResult;

export type OrgBusinessDecisionGateResult = {
  /** True only when the org's own stance recommends/arbitrates the call. */
  allowed: boolean;
  interactionId: string;
  evaluation: DecisionPerspectiveEvaluationResult;
  operatorMessage: string;
  /** True when the organization's OWN profile (not a platform fallback) decided. */
  orgProfileSelected: boolean;
};

/**
 * Govern an organization business decision through its WWWD profile (with platform
 * fallback as advisory). Returns the evaluation, an operator message, and whether the
 * org's own profile decided. Always records a DecisionInteraction.
 */
export async function evaluateOrgBusinessDecisionGate(input: {
  db: OrgBusinessGateClient;
  organizationId: string | null | undefined;
  question: string;
  options: string[];
  domainClass: DecisionDomainClass;
  riskTier: DecisionRiskTier;
  /** Where the decision originated, e.g. "/coworker-business". Recorded on the ledger. */
  routeContext: string;
  phaseFrom?: string | null;
  phaseTo?: string | null;
  evidence?: DecisionEvidenceItem[];
  fallbackProfileId?: string;
  triggeredByUserId?: string | null;
  taskRunId?: string | null;
  caller?: DecisionGateCaller;
  evaluator?: GateEvaluator;
  resolver?: typeof resolveProfileMaterialForOrg;
  now?: Date;
  recentOverrideCount?: number;
}): Promise<OrgBusinessDecisionGateResult> {
  const result = await evaluatePerspectiveGate({
    db: input.db,
    organizationId: input.organizationId ?? null,
    fallbackProfileId: input.fallbackProfileId,
    question: input.question,
    options: input.options,
    domainClass: input.domainClass,
    riskTier: input.riskTier,
    routeContext: input.routeContext,
    phaseFrom: input.phaseFrom,
    phaseTo: input.phaseTo,
    evidence: input.evidence,
    triggeredByUserId: input.triggeredByUserId,
    taskRunId: input.taskRunId,
    caller: input.caller,
    evaluator: input.evaluator,
    resolver: input.resolver,
    now: input.now,
    recentOverrideCount: input.recentOverrideCount,
  });

  return {
    allowed: result.allowed,
    interactionId: result.interactionId,
    evaluation: result.evaluation,
    operatorMessage: result.operatorMessage,
    orgProfileSelected: result.orgProfileSelected,
  };
}
