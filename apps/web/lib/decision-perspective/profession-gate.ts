// Profession/WSID decision gate (BI-9900B365, EP-8DC217EB BET-0c).
//
// Closes the WSID-gate gap found by the vertical-integration decide-surfaces
// audit: WWMD had a gate (build-studio-gate), WWWD had a gate
// (org-business-gate), but a profession-scoped decision — "what would a
// competent <profession> do here" — had NO governed surface, even though the
// wsid-* DecisionPerspectiveProfiles and the registry-driven identity binding
// (resolve-profession-profile.ts) already exist.
//
// Third sibling of the two existing gates, keyed on the coworker's agent
// identity instead of a build or an organization. Pure composition of the
// already-tested primitives: resolveProfileMaterialForProfession ->
// evaluateDecisionPerspective -> persistDecisionInteraction. Fail-closed: any
// resolver/evaluator error escalates to a human and is still recorded to the
// DecisionInteraction ledger.

import { MARK_DPF_PLATFORM_PROFILE } from "./default-profile";
import { evaluateDecisionPerspective } from "./evaluator";
import { resolveProfileMaterialForProfession } from "./material";
import { createDecisionInteractionId, persistDecisionInteraction } from "./persistence";
import type {
  DecisionDomainClass,
  DecisionGateKey,
  DecisionPerspectiveEvaluationInput,
  DecisionPerspectiveEvaluationResult,
  DecisionPerspectiveProfile,
  DecisionRiskTier,
} from "./types";
import { getErrorMessage } from "@/lib/shared/get-error-message";

type ProfessionGateClient = Parameters<typeof resolveProfileMaterialForProfession>[0]["db"] &
  Parameters<typeof persistDecisionInteraction>[0]["db"];

type GateEvaluator = (input: DecisionPerspectiveEvaluationInput) => DecisionPerspectiveEvaluationResult;

/** Every row this gate writes audits as WSID, whatever doctrine it fell back to. */
const PROFESSION_GATE_KEY: DecisionGateKey = "profession";

export type ProfessionAgentIdentityInput = {
  agentId?: string | null;
  agentName?: string | null;
  roleSlug?: string | null;
  slugId?: string | null;
};

export type ProfessionDecisionGateResult = {
  /** True only when the resolved craft doctrine recommends/arbitrates the call. */
  allowed: boolean;
  interactionId: string;
  evaluation: DecisionPerspectiveEvaluationResult;
  operatorMessage: string;
  /** True when the coworker's OWN profession profile (not a fallback) decided. */
  professionProfileSelected: boolean;
  /** The profession family that governed (null when the role is unbound). */
  professionKey: string | null;
};

function traceWsid(event: string, payload: Record<string, unknown>): void {
  console.info(`[tool-trace] ${event} ${JSON.stringify(payload)}`);
}

function errorClass(error: unknown): string {
  return error instanceof Error && error.name ? error.name : "UnknownError";
}

function operatorMessageFor(
  evaluation: DecisionPerspectiveEvaluationResult,
  professionProfileSelected: boolean,
  professionKey: string | null,
): string {
  const scope = professionProfileSelected
    ? `the ${professionKey} profession's recorded craft`
    : professionKey
      ? `platform defaults (the ${professionKey} craft corpus has no material for this decision class yet)`
      : "platform defaults (this coworker maps to no profession family)";
  switch (evaluation.outcomeType) {
    case "defer":
      return `No applicable craft guidance found via ${scope}. ${evaluation.rationale}`;
    case "escalate":
      return `This craft decision needs a human call (${scope}). ${evaluation.rationale}`;
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
    rationale: `WSID fail-closed escalation: ${errorClass(input.error)}. The decision could not be safely evaluated, so it routes to a human.`,
    materialScores: [],
    sources: [],
    gapReason: "material-below-confidence",
  };
}

/**
 * Govern a profession-scoped (WSID) decision through the coworker's craft
 * profile, with platform fallback as advisory only. Returns the evaluation,
 * an operator message, and whether the profession's own profile decided.
 * Always records a DecisionInteraction.
 */
export async function evaluateProfessionDecisionGate(input: {
  db: ProfessionGateClient;
  agentIdentity: ProfessionAgentIdentityInput;
  question: string;
  options: string[];
  domainClass: DecisionDomainClass;
  riskTier: DecisionRiskTier;
  /** Where the decision originated, e.g. "/coworker". Recorded on the ledger. */
  routeContext: string;
  phaseFrom?: string | null;
  phaseTo?: string | null;
  evidence?: DecisionPerspectiveEvaluationInput["evidence"];
  fallbackProfileId?: string;
  triggeredByUserId?: string | null;
  taskRunId?: string | null;
  caller?: {
    client?: string | null;
    apiTokenId?: string | null;
    authSource?: string | null;
    agentId?: string | null;
    threadId?: string | null;
  } | null;
  evaluator?: GateEvaluator;
  /** Injectable for tests; defaults to the real profession resolver. */
  resolver?: typeof resolveProfileMaterialForProfession;
  now?: Date;
  recentOverrideCount?: number;
}): Promise<ProfessionDecisionGateResult> {
  const interactionId = createDecisionInteractionId();
  const { question, options, domainClass, riskTier } = input;
  const resolve = input.resolver ?? resolveProfileMaterialForProfession;

  let resolved: Awaited<ReturnType<typeof resolveProfileMaterialForProfession>> | undefined;
  let profile: DecisionPerspectiveProfile = MARK_DPF_PLATFORM_PROFILE;
  let professionProfileSelected = false;
  let professionKey: string | null = null;

  try {
    resolved = await resolve({
      db: input.db,
      agentIdentity: input.agentIdentity,
      domainClass,
      fallbackProfileId: input.fallbackProfileId,
    });
    profile = resolved.selectedProfile ?? MARK_DPF_PLATFORM_PROFILE;
    professionProfileSelected = resolved.professionProfileSelected;
    professionKey = resolved.professionKey;
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
    traceWsid("wsid.profession-gate.invoked", {
      interactionId,
      agentIdentity: input.agentIdentity,
      domainClass,
      riskTier,
      routeContext: input.routeContext,
      triggeredByUserId: input.triggeredByUserId ?? null,
    });
    traceWsid("wsid.evaluator.failed", {
      interactionId,
      errorClass: errorClass(error),
      errorMessage: getErrorMessage(error),
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
      // The resolver threw, so doctrine is the platform fallback — but this is
      // still a WSID decision and must audit as one (BI-1BE30A9A).
      gateKey: PROFESSION_GATE_KEY,
      gateFallbackUsed: true,
      outcomePayloadExtra: {
        professionProfileSelected,
        professionKey,
        caller: input.caller ?? null,
      },
    });
    traceWsid("wsid.ledger.written", { interactionId, outcomeType: evaluation.outcomeType });
    return {
      allowed: false,
      interactionId,
      evaluation,
      operatorMessage: operatorMessageFor(evaluation, professionProfileSelected, professionKey),
      professionProfileSelected,
      professionKey,
    };
  }

  traceWsid("wsid.profession-gate.invoked", {
    interactionId,
    agentIdentity: input.agentIdentity,
    profileId: profile.profileId,
    professionKey,
    professionProfileSelected,
    domainClass,
    riskTier,
    routeContext: input.routeContext,
    triggeredByUserId: input.triggeredByUserId ?? null,
  });
  traceWsid("wsid.profile.resolved", {
    interactionId,
    resolvedProfileChain: resolved.resolvedProfileChain,
    materialCount: resolved.materials.length,
    coverageGap: resolved.coverageGap,
    professionKey,
    professionProfileSelected,
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
    traceWsid("wsid.evaluator.failed", {
      interactionId,
      errorClass: errorClass(error),
      errorMessage: getErrorMessage(error),
    });
  }

  if (resolved.coverageGap) {
    evaluation.outcomeType = "defer";
    evaluation.coverageGap = true;
    evaluation.rationale = professionKey
      ? `No applicable craft guidance: the ${professionKey} profession corpus has no material for this decision class, and no fallback covered it.`
      : "No applicable craft guidance: this coworker maps to no profession family and no fallback covered the decision class.";
    evaluation.resolvedProfileChain = resolved.resolvedProfileChain;
  }

  traceWsid("wsid.evaluator.complete", {
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
    // Tier on the gate, not the resolved profile: when the craft corpus has no
    // material the profile is MARK_DPF_PLATFORM_PROFILE, and tiering on that
    // would file this WSID decision under WWMD (BI-1BE30A9A).
    gateKey: PROFESSION_GATE_KEY,
    gateFallbackUsed: !professionProfileSelected,
    outcomePayloadExtra: {
      professionProfileSelected,
      professionKey,
      caller: input.caller ?? null,
    },
  });
  traceWsid("wsid.ledger.written", {
    interactionId: persisted.interactionId,
    outcomeType: evaluation.outcomeType,
  });

  return {
    allowed: evaluation.outcomeType === "recommend" || evaluation.outcomeType === "arbitrate",
    interactionId: persisted.interactionId,
    evaluation,
    operatorMessage: operatorMessageFor(evaluation, professionProfileSelected, professionKey),
    professionProfileSelected,
    professionKey,
  };
}
