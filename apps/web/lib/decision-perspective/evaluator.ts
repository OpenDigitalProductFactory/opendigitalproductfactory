import {
  isMaterialApplicable,
  scorePerspectiveMaterial,
} from "./material";
import type {
  DecisionPerspectiveEvaluationInput,
  DecisionPerspectiveEvaluationResult,
  DecisionPerspectiveProfile,
  DecisionDomainClass,
  DecisionRiskTier,
  PerspectiveMaterial,
  PerspectiveMaterialScore,
} from "./types";

export { scorePerspectiveMaterial } from "./material";

export const RECENT_OVERRIDE_WINDOW_DAYS = 30;

const RISK_RANK: Record<DecisionRiskTier, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

const RISK_PENALTY: Record<DecisionRiskTier, number> = {
  low: 0,
  medium: 0.1,
  high: 0.25,
  critical: 0.5,
};

function roundConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Number(Math.max(0, Math.min(1, value)).toFixed(4));
}

function riskWithin(candidate: DecisionRiskTier, max: DecisionRiskTier): boolean {
  return RISK_RANK[candidate] <= RISK_RANK[max];
}

function orderedProfileChain(
  profile: DecisionPerspectiveProfile,
  fallbackProfiles: DecisionPerspectiveProfile[] | undefined,
): DecisionPerspectiveProfile[] {
  const fallbacks = new Map((fallbackProfiles ?? []).map((entry) => [entry.profileId, entry]));
  const chain: DecisionPerspectiveProfile[] = [profile];
  let nextId = profile.fallbackProfileId;

  while (nextId) {
    const next = fallbacks.get(nextId);
    if (!next || chain.some((entry) => entry.profileId === next.profileId)) {
      break;
    }
    chain.push(next);
    nextId = next.fallbackProfileId;
  }

  return chain;
}

function scoreProfileCoverage(input: {
  profile: DecisionPerspectiveProfile;
  materials: PerspectiveMaterial[];
  questionDomain: DecisionDomainClass;
  riskTier: DecisionRiskTier;
  recentOverrideCount: number;
}): {
  profile: DecisionPerspectiveProfile;
  applicableMaterials: PerspectiveMaterial[];
  materialScores: PerspectiveMaterialScore[];
  confidence: number;
} {
  const applicableMaterials = input.materials.filter(
    (material) =>
      material.profileId === input.profile.profileId
      && isMaterialApplicable(material, input.questionDomain),
  );
  const materialScores = applicableMaterials.map(scorePerspectiveMaterial);
  const positiveScores = materialScores.filter((score) => score.effectiveWeight > 0);
  const baseScore = positiveScores.length === 0
    ? 0
    : positiveScores.reduce((total, score) => total + score.effectiveWeight, 0) / positiveScores.length;
  const overridePenalty = Math.min(0.3, input.recentOverrideCount * 0.1);
  const confidence = roundConfidence(baseScore - RISK_PENALTY[input.riskTier] - overridePenalty);

  return {
    profile: input.profile,
    applicableMaterials,
    materialScores,
    confidence,
  };
}

function summarizeFreshness(scores: PerspectiveMaterialScore[]) {
  return scores.reduce(
    (counts, score) => {
      counts[score.freshness] += 1;
      return counts;
    },
    { current: 0, stale: 0, superseded: 0, contradicted: 0 },
  );
}

function hasPrincipleConflict(materials: PerspectiveMaterial[]): boolean {
  const activeDirections = new Set(
    materials
      .filter((material) => material.sourceType === "principle")
      .filter((material) => material.freshness === "current")
      .filter((material) => material.reviewStatus === "approved")
      .filter((material) => material.promotionState === "promoted")
      .map((material) => material.direction ?? material.principleDirection)
      .filter((direction): direction is "support" | "oppose" => direction === "support" || direction === "oppose"),
  );

  return activeDirections.has("support") && activeDirections.has("oppose");
}

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
    materialScores: selectedCoverage.materialScores,
    sources,
  };

  if (principleConflict) {
    return {
      ...baseResult,
      outcomeType: "escalate",
      rationale:
        "Principle conflict detected for this decision class. Escalate to the accountable resolver and capture the human resolution as candidate profile material.",
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
