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

import { MARK_DPF_PLATFORM_PROFILE } from "./default-profile";
import { evaluateDecisionPerspective } from "./evaluator";
import { resolveProfileMaterialForOrg } from "./material";
import { createDecisionInteractionId, persistDecisionInteraction } from "./persistence";
import type {
  DecisionDomainClass,
  DecisionPerspectiveEvaluationInput,
  DecisionPerspectiveEvaluationResult,
  DecisionPerspectiveProfile,
  DecisionRiskTier,
} from "./types";

type OrgBusinessGateClient = Parameters<typeof resolveProfileMaterialForOrg>[0]["db"] &
  Parameters<typeof persistDecisionInteraction>[0]["db"];

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

function traceWwwd(event: string, payload: Record<string, unknown>): void {
  console.info(`[tool-trace] ${event} ${JSON.stringify(payload)}`);
}

function errorClass(error: unknown): string {
  return error instanceof Error && error.name ? error.name : "UnknownError";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function operatorMessageFor(evaluation: DecisionPerspectiveEvaluationResult, orgProfileSelected: boolean): string {
  const scope = orgProfileSelected
    ? "your organization's recorded stance"
    : "platform defaults (your organization has not recorded a stance here yet)";
  switch (evaluation.outcomeType) {
    case "defer":
      return `No applicable business stance found via ${scope}. ${evaluation.rationale}`;
    case "escalate":
      return `This business decision needs your call (${scope}). ${evaluation.rationale}`;
    case "arbitrate":
      return `Decided from ${scope} at ${evaluation.confidenceScore} confidence.`;
    default:
      return `Recommended from ${scope} at ${evaluation.confidenceScore} confidence.`;
  }
}

function failClosedEvaluation(input: {
  profile: DecisionPerspectiveProfile;
  question: string;
  options: string[];
  domainClass: DecisionDomainClass;
  riskTier: DecisionRiskTier;
  error: unknown;
  resolvedProfileChain: string[];
}): DecisionPerspectiveEvaluationResult {
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
    domainClass: input.domainClass,
    resolvedProfileChain: input.resolvedProfileChain,
    materialCount: 0,
    freshnessDistribution: { current: 0, stale: 0, superseded: 0, contradicted: 0 },
    riskTier: input.riskTier,
    question: input.question,
    options: input.options,
    rationale: `WWWD fail-closed escalation: ${errorClass(input.error)}. The decision could not be safely evaluated, so it routes to a human.`,
    materialScores: [],
    sources: [],
    gapReason: "material-below-confidence",
  };
}

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
  evidence?: DecisionPerspectiveEvaluationInput["evidence"];
  fallbackProfileId?: string;
  triggeredByUserId?: string | null;
  taskRunId?: string | null;
  /**
   * Caller attribution (BI-0EEBA669): the client/agent/thread that brought
   * this decision, persisted in outcomePayload.caller so the audit surface
   * can match the decision back to the activity.
   */
  caller?: {
    client?: string | null;
    apiTokenId?: string | null;
    authSource?: string | null;
    agentId?: string | null;
    threadId?: string | null;
  } | null;
  evaluator?: GateEvaluator;
  /** Injectable for tests; defaults to the real (already-tested) org resolver. */
  resolver?: typeof resolveProfileMaterialForOrg;
  now?: Date;
  recentOverrideCount?: number;
}): Promise<OrgBusinessDecisionGateResult> {
  const interactionId = createDecisionInteractionId();
  const { question, options, domainClass, riskTier } = input;
  const resolve = input.resolver ?? resolveProfileMaterialForOrg;

  let resolved: Awaited<ReturnType<typeof resolveProfileMaterialForOrg>> | undefined;
  let profile: DecisionPerspectiveProfile = MARK_DPF_PLATFORM_PROFILE;
  let orgProfileSelected = false;

  try {
    resolved = await resolve({
      db: input.db,
      organizationId: input.organizationId,
      domainClass,
      fallbackProfileId: input.fallbackProfileId,
    });
    profile = resolved.selectedProfile ?? MARK_DPF_PLATFORM_PROFILE;
    orgProfileSelected = resolved.orgProfileSelected;
  } catch (error) {
    const evaluation = failClosedEvaluation({
      profile,
      question,
      options,
      domainClass,
      riskTier,
      error,
      resolvedProfileChain: [profile.profileId],
    });
    traceWwwd("wwwd.org-gate.invoked", {
      interactionId,
      organizationId: input.organizationId ?? null,
      domainClass,
      riskTier,
      routeContext: input.routeContext,
      triggeredByUserId: input.triggeredByUserId ?? null,
    });
    traceWwwd("wwwd.evaluator.failed", {
      interactionId,
      errorClass: errorClass(error),
      errorMessage: errorMessage(error),
    });
    await persistDecisionInteraction({
      db: input.db,
      evaluation,
      triggeredByUserId: input.triggeredByUserId,
      taskRunId: input.taskRunId,
      interactionId,
      routeContext: input.routeContext,
      phaseFrom: input.phaseFrom ?? null,
      phaseTo: input.phaseTo ?? null,
      outcomePayloadExtra: { orgProfileSelected, caller: input.caller ?? null },
    });
    traceWwwd("wwwd.ledger.written", { interactionId, outcomeType: evaluation.outcomeType });
    return {
      allowed: false,
      interactionId,
      evaluation,
      operatorMessage: operatorMessageFor(evaluation, orgProfileSelected),
      orgProfileSelected,
    };
  }

  traceWwwd("wwwd.org-gate.invoked", {
    interactionId,
    organizationId: input.organizationId ?? null,
    profileId: profile.profileId,
    orgProfileSelected,
    domainClass,
    riskTier,
    routeContext: input.routeContext,
    triggeredByUserId: input.triggeredByUserId ?? null,
  });
  traceWwwd("wwwd.profile.resolved", {
    interactionId,
    resolvedProfileChain: resolved.resolvedProfileChain,
    materialCount: resolved.materials.length,
    coverageGap: resolved.coverageGap,
    orgProfileSelected,
  });

  const evaluator = input.evaluator ?? evaluateDecisionPerspective;
  let evaluation: DecisionPerspectiveEvaluationResult;
  try {
    evaluation = evaluator({
      profile,
      fallbackProfiles: [],
      materials: resolved.materials,
      question,
      questionDomain: domainClass,
      options,
      riskTier,
      recentOverrideCount: input.recentOverrideCount ?? 0,
      evidence: input.evidence ?? [],
    });
  } catch (error) {
    evaluation = failClosedEvaluation({
      profile,
      question,
      options,
      domainClass,
      riskTier,
      error,
      resolvedProfileChain: resolved.resolvedProfileChain,
    });
    traceWwwd("wwwd.evaluator.failed", {
      interactionId,
      errorClass: errorClass(error),
      errorMessage: errorMessage(error),
    });
  }

  if (resolved.coverageGap) {
    evaluation.outcomeType = "defer";
    evaluation.coverageGap = true;
    evaluation.rationale =
      "No applicable business stance: neither the organization's profile nor any fallback has material for this decision class.";
    evaluation.resolvedProfileChain = resolved.resolvedProfileChain;
  }

  traceWwwd("wwwd.evaluator.complete", {
    interactionId,
    confidenceScore: evaluation.confidenceScore,
    outcomeType: evaluation.outcomeType,
    principleConflict: evaluation.principleConflict,
  });

  const persisted = await persistDecisionInteraction({
    db: input.db,
    evaluation,
    triggeredByUserId: input.triggeredByUserId,
    taskRunId: input.taskRunId,
    interactionId,
    routeContext: input.routeContext,
    phaseFrom: input.phaseFrom ?? null,
    phaseTo: input.phaseTo ?? null,
    outcomePayloadExtra: { orgProfileSelected },
  });
  traceWwwd("wwwd.ledger.written", {
    interactionId: persisted.interactionId,
    outcomeType: evaluation.outcomeType,
  });

  return {
    allowed: evaluation.outcomeType === "recommend" || evaluation.outcomeType === "arbitrate",
    interactionId: persisted.interactionId,
    evaluation,
    operatorMessage: operatorMessageFor(evaluation, orgProfileSelected),
    orgProfileSelected,
  };
}
