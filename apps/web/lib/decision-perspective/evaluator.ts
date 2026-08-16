import {
  isMaterialApplicable,
  resolveProfileMaterial,
  resolveProfileMaterialForOrg,
  scorePerspectiveMaterial,
} from "./material";
import { createDecisionInteractionId, findExistingDecisionInteraction, persistDecisionInteraction } from "./persistence";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import { MARK_DPF_PLATFORM_PROFILE } from "./default-profile";
import { resolveGateRecommendedOptionId } from "./option-recommendation";
import type { AlignmentCorpora } from "./alignment-criteria";
import { applyConstitutionalAlignment } from "./constitutional-alignment-application";
import {
  hasPrincipleConflict,
  orderedProfileChain,
  riskWithin,
  scoreProfileCoverage,
  summarizeFreshness,
} from "./coverage-scoring";
import type {
  DecisionPerspectiveEvaluationInput,
  DecisionPerspectiveEvaluationResult,
  DecisionPerspectiveProfile,
  DecisionDomainClass,
  DecisionGateKey,
  DecisionRiskTier,
  DecisionScoredOption,
  PerspectiveMaterial,
  PerspectiveMaterialScore,
  DecisionEvidenceItem,
} from "./types";

export { scorePerspectiveMaterial } from "./material";

export const RECENT_OVERRIDE_WINDOW_DAYS = 30;

export function evaluateDecisionPerspective(
  input: DecisionPerspectiveEvaluationInput,
): DecisionPerspectiveEvaluationResult {
  const chain = orderedProfileChain(input.profile, input.fallbackProfiles);
  const resolvedProfileChain = chain.map((profile) => profile.profileId);
  const recentOverrideCount = input.recentOverrideCount ?? 0;
  const coverageByProfile = chain.map((profile) =>
    scoreProfileCoverage({
      profile,
      materials: input.materials,
      questionDomain: input.questionDomain,
      riskTier: input.riskTier,
      recentOverrideCount,
      relevanceByMaterialId: input.relevanceByMaterialId,
    }),
  );
  const selectedCoverage = coverageByProfile.find((coverage) => coverage.confidence > 0);

  if (!selectedCoverage) {
    return {
      outcomeType: "defer",
      selectedProfileId: input.profile.profileId,
      fallbackProfileId: null,
      profileVersionId: input.profile.currentVersion.versionId,
      confidenceBefore: 0,
      confidenceAfter: 0,
      confidenceScore: 0,
      coverageGap: true,
      principleConflict: false,
      domainClass: input.questionDomain,
      resolvedProfileChain,
      materialCount: 0,
      freshnessDistribution: { current: 0, stale: 0, superseded: 0, contradicted: 0 },
      riskTier: input.riskTier,
      question: input.question,
      options: input.options,
      scoredOptions: input.scoredOptions,
      recommendedOptionId: null,
      rationale:
        "Decision perspective coverage gap: no active profile or fallback profile has applicable, non-contradicted material for this domain.",
      materialScores: coverageByProfile.flatMap((coverage) => coverage.materialScores),
      sources: [],
      gapReason: "no-applicable-material",
    };
  }

  const selectedProfile = selectedCoverage.profile;
  const confidence = selectedCoverage.confidence;
  const principleConflict = hasPrincipleConflict(selectedCoverage.applicableMaterials);
  const fallbackProfileId =
    selectedProfile.profileId === input.profile.profileId ? null : selectedProfile.profileId;
  const sources = selectedCoverage.applicableMaterials
    .map((material) => {
      const score = selectedCoverage.materialScores.find(
        (entry) => entry.materialId === material.materialId,
      );
      return score && score.effectiveWeight > 0
        ? {
          materialId: material.materialId,
          sourceType: material.sourceType,
          summary: material.summary,
          effectiveWeight: score.effectiveWeight,
        }
        : null;
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

  const baseResult = {
    selectedProfileId: selectedProfile.profileId,
    fallbackProfileId,
    profileVersionId: selectedProfile.currentVersion.versionId,
    confidenceBefore: confidence,
    confidenceAfter: confidence,
    confidenceScore: confidence,
    coverageGap: false,
    principleConflict,
    domainClass: input.questionDomain,
    resolvedProfileChain,
    materialCount: selectedCoverage.applicableMaterials.length,
    freshnessDistribution: summarizeFreshness(selectedCoverage.materialScores),
    riskTier: input.riskTier,
    question: input.question,
    options: input.options,
    scoredOptions: input.scoredOptions,
    // Computed one level up in evaluatePerspectiveGate, once the outcomeType
    // below is known — this evaluator is synchronous and the commandment
    // lookup is not.
    recommendedOptionId: null,
    ...(selectedCoverage.contentAware
      ? {
          alignmentScore: selectedCoverage.alignmentScore,
          stanceAlignment: selectedCoverage.stanceAlignment,
          relevanceMethod: input.relevanceMethod,
        }
      : {}),
    materialScores: selectedCoverage.materialScores,
    sources,
  };

  // ── Content-aware directional outcome (WWWD, BI-7E1F128A) ────────────────────
  // The org's OWN recorded stance is its standing decision for this class, so a
  // clear, relevant stance governs — instead of every medium-risk business call
  // bouncing back to the owner. Declining is inherently safe (saying "no" to an
  // off-mission idea), so a relevant `oppose` stance recommends declining at any
  // non-critical risk; approving carries consequence, so a `support` stance
  // governs at low/medium risk but a high-risk approval still escalates.
  if (selectedCoverage.contentAware) {
    const alignment = selectedCoverage.stanceAlignment ?? "none";

    // Lexical-fallback fail-safe (BI-7E1F128A follow-up). When the embedding
    // layer is unavailable, `computeStanceRelevance` scores relevance by coarse
    // lexical token-overlap. That signal is too imprecise to drive a confident
    // directional verdict: on a live install it spuriously matched a `support`
    // stance and confidently APPROVED a blatantly off-mission decision — strictly
    // worse than the pre-fix escalate, because it replaced "ask the owner" with
    // "act wrongly". So when relevance is lexical we do NOT act autonomously in
    // either direction; we escalate, exactly as the gate did before content
    // discrimination existed. Confident directional outcomes require semantic
    // relevance. (Restoring the embedding layer re-enables discrimination.)
    if (input.relevanceMethod === "lexical") {
      return {
        ...baseResult,
        outcomeType: "escalate",
        rationale:
          `Your recorded stance leans ${alignment} on this decision, but relevance was scored without the semantic embedding layer (lexical fallback) — too coarse to decide this on your behalf. Escalating to your call; restore embeddings to re-enable autonomous stance-grounded verdicts.`,
      };
    }

    // Conflict is judged by RELEVANCE-WEIGHTED direction (`mixed`), not the
    // coarse content-blind `principleConflict` — otherwise a domain that merely
    // *contains* an opposing principle would escalate every decision even when
    // only one side is relevant to the question. `principleConflict` is still
    // recorded on the result for audit.
    if (alignment === "mixed") {
      return {
        ...baseResult,
        outcomeType: "escalate",
        rationale:
          "Your recorded stance points in conflicting directions on this decision. Escalating to your call, and the resolution becomes candidate stance material.",
      };
    }

    if (input.riskTier === "critical") {
      return {
        ...baseResult,
        outcomeType: "escalate",
        rationale:
          `This is a critical-risk decision, so it goes to your call even though your recorded stance leans ${alignment} at confidence ${confidence}.`,
      };
    }

    if (
      alignment === "none"
      || confidence < selectedProfile.autonomyPolicy.minimumConfidenceForRecommendation
    ) {
      return {
        ...baseResult,
        outcomeType: "escalate",
        rationale:
          `Your recorded stance does not clearly speak to this decision (alignment ${alignment}, confidence ${confidence} below the ${selectedProfile.autonomyPolicy.minimumConfidenceForRecommendation} threshold). Escalating to your call.`,
        gapReason: "material-below-confidence",
      };
    }

    if (alignment === "decline") {
      return {
        ...baseResult,
        outcomeType: "recommend",
        rationale:
          `Recommend DECLINING: your recorded stance opposes this decision at confidence ${confidence}. Declining an off-stance option is low-consequence, so this does not require your live call.`,
      };
    }

    // alignment === "approve".
    //
    // Aligned is NOT a licence to act (BI-F5F2869D, operator ruling). Approving
    // whatever matches recorded doctrine would make the business only ever do
    // what it already does, and reviewing an unaligned or novel proposal is
    // exactly where new ideas surface. So an approval acts autonomously only
    // when the owner has ALREADY RULED on this question — a `ruled` stance
    // dominating the relevant material — and otherwise escalates with the
    // reason made explicit, so a genuinely new proposition is legible as new
    // rather than buried among settled ones.
    if (!selectedCoverage.settledByRuling) {
      return {
        ...baseResult,
        outcomeType: "escalate",
        rationale:
          `This is a NEW proposition: your recorded stance is consistent with it (confidence ${confidence}), but you have not ruled on this question before. Escalating so you can weigh it — a decision that merely matches existing doctrine is not one you have already made.`,
        gapReason: "aligned-not-settled",
      };
    }

    if (input.riskTier === "high") {
      return {
        ...baseResult,
        outcomeType: "escalate",
        rationale:
          `Your recorded stance supports this at confidence ${confidence}, but approving a high-risk decision still needs your live call.`,
      };
    }
    if (
      selectedProfile.autonomyPolicy.allowArbitration
      && riskWithin(input.riskTier, selectedProfile.autonomyPolicy.maxRiskForArbitration)
      && confidence >= selectedProfile.autonomyPolicy.minimumConfidenceForArbitration
    ) {
      return {
        ...baseResult,
        outcomeType: "arbitrate",
        rationale:
          `Arbitrate and proceed: your recorded stance supports this at confidence ${confidence} and the autonomy policy allows arbitration at ${input.riskTier} risk.`,
      };
    }
    return {
      ...baseResult,
      outcomeType: "recommend",
      rationale:
        `Recommend APPROVING: your recorded stance supports this decision at confidence ${confidence}.`,
    };
  }

  if (principleConflict) {
    return {
      ...baseResult,
      outcomeType: "escalate",
      rationale:
        "Principle conflict detected for this decision class. Escalate to the accountable resolver and capture the owner resolution as candidate profile material.",
    };
  }

  if (input.riskTier === "high" || input.riskTier === "critical") {
    return {
      ...baseResult,
      outcomeType: "escalate",
      rationale:
        `Escalate this high-risk decision to the accountable resolver even though profile confidence is ${confidence}.`,
    };
  }

  if (confidence < selectedProfile.autonomyPolicy.minimumConfidenceForRecommendation) {
    return {
      ...baseResult,
      outcomeType: "escalate",
      rationale:
        `Escalate because profile confidence ${confidence} is below the recommendation threshold ${selectedProfile.autonomyPolicy.minimumConfidenceForRecommendation}.`,
      gapReason: "material-below-confidence",
    };
  }

  if (confidence < 0.4) {
    return {
      ...baseResult,
      outcomeType: "escalate",
      rationale:
        `Escalate because profile confidence ${confidence} is below the minimum decision threshold.`,
      gapReason: "material-below-confidence",
    };
  }

  if (confidence < 0.7) {
    return {
      ...baseResult,
      outcomeType: "escalate",
      rationale:
        `Escalate because profile confidence ${confidence} is below the recommendation band.`,
    };
  }

  if (
    selectedProfile.autonomyPolicy.allowArbitration
    && riskWithin(input.riskTier, selectedProfile.autonomyPolicy.maxRiskForArbitration)
    && confidence >= selectedProfile.autonomyPolicy.minimumConfidenceForArbitration
  ) {
    return {
      ...baseResult,
      outcomeType: "arbitrate",
      rationale:
        `Arbitrate and continue because profile confidence is ${confidence}, risk is ${input.riskTier}, and the autonomy policy allows arbitration at this risk tier.`,
    };
  }

  if (confidence < 0.9 && input.riskTier !== "low") {
    return {
      ...baseResult,
      outcomeType: "escalate",
      rationale:
        `Escalate because profile confidence ${confidence} is not high enough for a ${input.riskTier}-risk decision.`,
    };
  }

  return {
    ...baseResult,
    outcomeType: "recommend",
    rationale:
      `Recommend a direction with profile confidence ${confidence}; arbitration is not authorized for this risk and confidence combination.`,
  };
}

export interface GateEvaluator {
  (input: DecisionPerspectiveEvaluationInput): DecisionPerspectiveEvaluationResult;
}

export type DecisionGateCaller = {
  client?: string | null;
  apiTokenId?: string | null;
  authSource?: string | null;
  agentId?: string | null;
  threadId?: string | null;
} | null;

type PerspectiveGateBuild = {
  buildId: string;
  planReview: { decision: string; summary: string | null } | null;
  deliberationSummary: {
    plan?: {
      deliberationRunId: string;
      evidenceQuality: string;
      rationaleSummary: string;
    } | null;
  } | null;
};

export function errorClass(error: unknown): string {
  return error instanceof Error && error.name ? error.name : "UnknownError";
}

export function errorMessage(error: unknown): string {
  return getErrorMessage(error);
}

function planDeliberationRunId(build: PerspectiveGateBuild): string | null {
  return build.deliberationSummary?.plan?.deliberationRunId ?? null;
}

export function failClosedEvaluation(input: {
  profile: DecisionPerspectiveProfile;
  question: string;
  options: string[];
  domainClass: DecisionDomainClass;
  riskTier: DecisionRiskTier;
  error: unknown;
  resolvedProfileChain: string[];
  isWwwd?: boolean;
}): DecisionPerspectiveEvaluationResult {
  const className = errorClass(input.error);
  const isWwwd = input.isWwwd ?? false;
  const rationale = isWwwd
    ? `WWWD fail-closed escalation: ${className}. The decision could not be safely evaluated, so it routes to the owner.`
    : `WWMD fail-closed escalation: ${className}. The decision kernel could not safely evaluate this advancement request.`;

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
    rationale,
    materialScores: [],
    sources: [],
    gapReason: "material-below-confidence",
  };
}

export function operatorMessageFor(
  evaluation: DecisionPerspectiveEvaluationResult,
  orgProfileSelected = false,
  isWwwd = false,
): string {
  if (isWwwd) {
    const scope = orgProfileSelected
      ? "your organization's recorded stance"
      : "platform defaults (your organization has not recorded a stance here yet)";
    const direction =
      evaluation.stanceAlignment === "approve"
        ? "approving"
        : evaluation.stanceAlignment === "decline"
          ? "declining"
          : null;
    switch (evaluation.outcomeType) {
      case "defer":
        return `No applicable business stance found via ${scope}. ${evaluation.rationale}`;
      case "escalate":
        return `This business decision needs your call (${scope}). ${evaluation.rationale}`;
      case "arbitrate":
        return direction
          ? `Decided ${direction} from ${scope} at ${evaluation.confidenceScore} confidence.`
          : `Decided from ${scope} at ${evaluation.confidenceScore} confidence.`;
      default:
        return direction
          ? `Recommended ${direction} from ${scope} at ${evaluation.confidenceScore} confidence.`
          : `Recommended from ${scope} at ${evaluation.confidenceScore} confidence.`;
    }
  }

  // WWMD (build studio gate)
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

async function getRecentOverrideCount(input: {
  db: any;
  profileId: string;
  domainClass: DecisionDomainClass;
  now: Date;
}): Promise<number> {
  if (!input.db.escalationCapture?.count) return 0;
  const gte = new Date(input.now.getTime() - RECENT_OVERRIDE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return input.db.escalationCapture.count({
    where: {
      domainClass: input.domainClass,
      createdAt: { gte },
      interaction: { profileId: input.profileId },
    },
  });
}

export async function evaluatePerspectiveGate(input: {
  db: any;
  organizationId?: string | null | undefined;
  profileId?: string;
  fallbackProfileId?: string;
  question: string;
  options: string[];
  scoredOptions?: DecisionScoredOption[];
  domainClass: DecisionDomainClass;
  riskTier: DecisionRiskTier;
  routeContext: string;
  build?: PerspectiveGateBuild | null;
  phaseFrom?: string | null;
  phaseTo?: string | null;
  evidence?: DecisionEvidenceItem[];
  triggeredByUserId?: string | null;
  taskRunId?: string | null;
  caller?: DecisionGateCaller;
  recentOverrideCount?: number;
  evaluator?: GateEvaluator;
  resolver?: any;
  now?: Date;
  coverageGapRationale?: string;
  onComplete?: (interactionId: string) => Promise<void> | void;
  alignmentCorpora?: AlignmentCorpora;
}): Promise<{
  allowed: boolean;
  interactionId: string;
  evaluation: DecisionPerspectiveEvaluationResult;
  operatorMessage: string;
  orgProfileSelected: boolean;
}> {
  const interactionId = createDecisionInteractionId();
  const isWwwd = input.organizationId !== undefined;
  const prefix = isWwwd ? "wwwd" : "wwmd";
  // The gate this row audits under, independent of which profile doctrine
  // ultimately resolved to (BI-1BE30A9A).
  const gateKey: DecisionGateKey = isWwwd ? "org-business" : "build-studio";
  const now = input.now ?? new Date();

  let resolved;
  let profile: DecisionPerspectiveProfile = MARK_DPF_PLATFORM_PROFILE;
  let orgProfileSelected = false;

  try {
    if (isWwwd) {
      const resolve = input.resolver ?? resolveProfileMaterialForOrg;
      resolved = await resolve({
        db: input.db,
        organizationId: input.organizationId,
        domainClass: input.domainClass,
        fallbackProfileId: input.fallbackProfileId,
      });
      profile = resolved.selectedProfile ?? MARK_DPF_PLATFORM_PROFILE;
      orgProfileSelected = resolved.orgProfileSelected;
    } else {
      const resolve = input.resolver ?? resolveProfileMaterial;
      resolved = await resolve({
        db: input.db,
        profileId: input.profileId ?? MARK_DPF_PLATFORM_PROFILE.profileId,
        domainClass: input.domainClass,
      });
      profile = resolved.selectedProfile ?? MARK_DPF_PLATFORM_PROFILE;
    }
  } catch (error) {
    const evaluation = failClosedEvaluation({
      profile,
      question: input.question,
      options: input.options,
      domainClass: input.domainClass,
      riskTier: input.riskTier,
      error,
      resolvedProfileChain: [input.profileId ?? profile.profileId],
      isWwwd,
    });

    const invokeEvent = isWwwd ? "wwwd.org-gate.invoked" : "wwmd.gate.invoked";
    console.info(
      `[tool-trace] ${invokeEvent} ${JSON.stringify({
        interactionId,
        organizationId: input.organizationId ?? null,
        domainClass: input.domainClass,
        riskTier: input.riskTier,
        routeContext: input.routeContext,
        featureBuildId: input.build?.buildId ?? null,
        triggeredByUserId: input.triggeredByUserId ?? null,
      })}`
    );

    console.info(
      `[tool-trace] ${prefix}.evaluator.failed ${JSON.stringify({
        interactionId,
        errorClass: errorClass(error),
        errorMessage: errorMessage(error),
      })}`
    );

    await persistDecisionInteraction({
      db: input.db,
      build: input.build,
      evaluation,
      deliberationRunId: input.build ? planDeliberationRunId(input.build) : null,
      triggeredByUserId: input.triggeredByUserId,
      taskRunId: input.taskRunId,
      interactionId,
      routeContext: input.routeContext,
      phaseFrom: input.phaseFrom === undefined ? (input.build ? "plan" : null) : input.phaseFrom,
      phaseTo: input.phaseTo === undefined ? (input.build ? "build" : null) : input.phaseTo,
      gateKey,
      gateFallbackUsed: isWwwd && !orgProfileSelected,
      outcomePayloadExtra: isWwwd
        ? { orgProfileSelected, caller: input.caller ?? null }
        : undefined,
    });

    console.info(
      `[tool-trace] ${prefix}.ledger.written ${JSON.stringify({
        interactionId,
        outcomeType: evaluation.outcomeType,
      })}`
    );

    return {
      allowed: false,
      interactionId,
      evaluation,
      operatorMessage: operatorMessageFor(evaluation, orgProfileSelected, isWwwd),
      orgProfileSelected,
    };
  }

  const invokeEvent = isWwwd ? "wwwd.org-gate.invoked" : "wwmd.gate.invoked";
  console.info(
    `[tool-trace] ${invokeEvent} ${JSON.stringify({
      interactionId,
      organizationId: input.organizationId ?? null,
      profileId: profile.profileId,
      orgProfileSelected,
      domainClass: input.domainClass,
      riskTier: input.riskTier,
      routeContext: input.routeContext,
      featureBuildId: input.build?.buildId ?? null,
      triggeredByUserId: input.triggeredByUserId ?? null,
    })}`
  );

  console.info(
    `[tool-trace] ${prefix}.profile.resolved ${JSON.stringify({
      interactionId,
      resolvedProfileChain: resolved.resolvedProfileChain,
      materialCount: resolved.materials.length,
      coverageGap: resolved.coverageGap,
      orgProfileSelected,
    })}`
  );

  if (input.build) {
    const phaseFrom = input.phaseFrom ?? "plan";
    const phaseTo = input.phaseTo ?? "build";
    const existing = await findExistingDecisionInteraction({
      db: input.db,
      build: input.build,
      phaseFrom,
      phaseTo,
      profileVersionId: profile.currentVersion.versionId,
    });
    if (existing) {
      console.info(
        `[tool-trace] ${prefix}.idempotent.hit ${JSON.stringify({
          interactionId: existing.interactionId,
          featureBuildId: input.build.buildId,
          phaseFrom,
          phaseTo,
        })}`
      );
      return {
        allowed: existing.evaluation.outcomeType === "recommend" || existing.evaluation.outcomeType === "arbitrate",
        interactionId: existing.interactionId,
        evaluation: existing.evaluation,
        operatorMessage: operatorMessageFor(existing.evaluation, orgProfileSelected, isWwwd),
        orgProfileSelected,
      };
    }
  }

  const overrides = input.recentOverrideCount
    ?? await getRecentOverrideCount({ db: input.db, profileId: profile.profileId, domainClass: input.domainClass, now });

  let evidence = input.evidence;
  if (!evidence && input.build) {
    evidence = [
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
    ];
  }

  // Content-aware WWWD scoring (BI-7E1F128A): compute how relevant each stance
  // material is to THIS question, so the verdict discriminates by decision
  // content instead of returning a per-domain coverage constant. WWMD (the build
  // gate) keeps its coverage-only path — relevance is only computed when the
  // caller supplied an organizationId. Fail-soft: a relevance error falls through
  // to coverage-only rather than breaking the fail-closed gate.
  let relevanceByMaterialId: Map<string, number> | undefined;
  let relevanceMethod: "semantic" | "lexical" | undefined;
  if (isWwwd && resolved.materials.length > 0) {
    try {
      const { computeStanceRelevance } = await import("./stance-relevance");
      const relevance = await computeStanceRelevance({
        question: input.question,
        materials: resolved.materials,
      });
      relevanceByMaterialId = relevance.relevanceByMaterialId;
      relevanceMethod = relevance.method;
    } catch (error) {
      console.info(
        `[tool-trace] ${prefix}.relevance.failed ${JSON.stringify({
          interactionId,
          errorClass: errorClass(error),
        })}`,
      );
    }
  }

  const evaluator = input.evaluator ?? evaluateDecisionPerspective;
  let evaluation: DecisionPerspectiveEvaluationResult;

  try {
    evaluation = evaluator({
      profile,
      fallbackProfiles: [],
      materials: resolved.materials,
      question: input.question,
      questionDomain: input.domainClass,
      options: input.options,
      scoredOptions: input.scoredOptions,
      riskTier: input.riskTier,
      recentOverrideCount: overrides,
      evidence,
      relevanceByMaterialId,
      relevanceMethod,
    });
  } catch (error) {
    evaluation = failClosedEvaluation({
      profile,
      question: input.question,
      options: input.options,
      domainClass: input.domainClass,
      riskTier: input.riskTier,
      error,
      resolvedProfileChain: resolved.resolvedProfileChain,
      isWwwd,
    });
    console.info(
      `[tool-trace] ${prefix}.evaluator.failed ${JSON.stringify({
        interactionId,
        errorClass: errorClass(error),
        errorMessage: errorMessage(error),
      })}`
    );
  }

  if (resolved.coverageGap) {
    evaluation.outcomeType = "defer";
    evaluation.coverageGap = true;
    evaluation.rationale = input.coverageGapRationale ?? (isWwwd
      ? "No applicable business stance: neither the organization's profile nor any fallback has material for this decision class."
      : "Decision perspective coverage gap: no active profile or fallback profile has applicable material for Build Studio plan advancement.");
    evaluation.resolvedProfileChain = resolved.resolvedProfileChain;
  }
  if (isWwwd && input.alignmentCorpora) applyConstitutionalAlignment({
    evaluation, question: input.question, corpora: input.alignmentCorpora,
  });
  evaluation.recommendedOptionId = await resolveGateRecommendedOptionId({
    db: input.db,
    scoredOptions: input.scoredOptions,
    organizationId: input.organizationId ?? null,
    outcomeType: evaluation.outcomeType,
    constitutionalVerdict: evaluation.constitutionalAlignment?.verdict,
  });
  console.info(
    `[tool-trace] ${prefix}.evaluator.complete ${JSON.stringify({
      interactionId,
      confidenceScore: evaluation.confidenceScore,
      outcomeType: evaluation.outcomeType,
      principleConflict: evaluation.principleConflict,
      freshnessDistribution: evaluation.freshnessDistribution,
    })}`
  );

  const persisted = await persistDecisionInteraction({
    db: input.db,
    build: input.build,
    evaluation,
    deliberationRunId: input.build ? planDeliberationRunId(input.build) : null,
    triggeredByUserId: input.triggeredByUserId,
    taskRunId: input.taskRunId,
    interactionId,
    routeContext: input.routeContext,
    phaseFrom: input.phaseFrom === undefined ? (input.build ? "plan" : null) : input.phaseFrom,
    phaseTo: input.phaseTo === undefined ? (input.build ? "build" : null) : input.phaseTo,
    gateKey,
    gateFallbackUsed: isWwwd && !orgProfileSelected,
    outcomePayloadExtra: isWwwd ? {
      orgProfileSelected, constitutionalAlignment: evaluation.constitutionalAlignment ?? null,
      caller: input.caller ?? null,
    } : undefined,
  });

  console.info(
    `[tool-trace] ${prefix}.ledger.written ${JSON.stringify({
      interactionId: persisted.interactionId,
      outcomeType: evaluation.outcomeType,
    })}`
  );

  if (input.onComplete) {
    setTimeout(() => {
      Promise.resolve(input.onComplete!(persisted.interactionId)).catch((err: unknown) => {
        console.error(`[tool-trace] gate.onComplete.failed`, {
          interactionId: persisted.interactionId,
          error: String(err),
        });
      });
    });
  }

  return {
    allowed: evaluation.outcomeType === "recommend" || evaluation.outcomeType === "arbitrate",
    interactionId: persisted.interactionId,
    evaluation,
    operatorMessage: operatorMessageFor(evaluation, orgProfileSelected, isWwwd),
    orgProfileSelected,
  };
}
