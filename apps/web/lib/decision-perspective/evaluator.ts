import {
  isMaterialApplicable,
  scorePerspectiveMaterial,
} from "./material";
import type {
  DecisionPerspectiveEvaluationInput,
  DecisionPerspectiveEvaluationResult,
  DecisionPerspectiveProfile,
  DecisionRiskTier,
  PerspectiveMaterial,
  PerspectiveMaterialScore,
} from "./types";

export { scorePerspectiveMaterial } from "./material";

const RISK_RANK: Record<DecisionRiskTier, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
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
  questionDomain: string;
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
  const confidence = roundConfidence(
    materialScores.reduce((total, score) => total + score.effectiveWeight, 0),
  );

  return {
    profile: input.profile,
    applicableMaterials,
    materialScores,
    confidence,
  };
}

export function evaluateDecisionPerspective(
  input: DecisionPerspectiveEvaluationInput,
): DecisionPerspectiveEvaluationResult {
  const chain = orderedProfileChain(input.profile, input.fallbackProfiles);
  const coverageByProfile = chain.map((profile) =>
    scoreProfileCoverage({
      profile,
      materials: input.materials,
      questionDomain: input.questionDomain,
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
    riskTier: input.riskTier,
    question: input.question,
    options: input.options,
    materialScores: selectedCoverage.materialScores,
    sources,
  };

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

  return {
    ...baseResult,
    outcomeType: "recommend",
    rationale:
      `Recommend a direction with profile confidence ${confidence}; arbitration is not authorized for this risk and confidence combination.`,
  };
}
