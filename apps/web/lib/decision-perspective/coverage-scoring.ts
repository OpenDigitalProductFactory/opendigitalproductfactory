// Pure scoring primitives for the decision-perspective evaluator. Extracted from
// evaluator.ts to keep that module focused (module-size / substrate-regression
// guards). No IO — the async gate resolves material + relevance upstream and
// hands them to these synchronous functions.

import { isMaterialApplicable, scorePerspectiveMaterial } from "./material";
import type {
  DecisionDomainClass,
  DecisionPerspectiveProfile,
  DecisionRiskTier,
  PerspectiveMaterial,
  PerspectiveMaterialScore,
} from "./types";

export const RISK_RANK: Record<DecisionRiskTier, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export const RISK_PENALTY: Record<DecisionRiskTier, number> = {
  low: 0,
  medium: 0.1,
  high: 0.25,
  critical: 0.5,
};

export function roundConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Number(Math.max(0, Math.min(1, value)).toFixed(4));
}

export function riskWithin(candidate: DecisionRiskTier, max: DecisionRiskTier): boolean {
  return RISK_RANK[candidate] <= RISK_RANK[max];
}

export function orderedProfileChain(
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

// A relevant stance whose support and oppose mass are within this band of each
// other counts as a CONFLICT (mixed), not a directional verdict.
export const ALIGNMENT_CONFLICT_BAND = 0.2;

export type ProfileCoverage = {
  profile: DecisionPerspectiveProfile;
  applicableMaterials: PerspectiveMaterial[];
  materialScores: PerspectiveMaterialScore[];
  confidence: number;
  /** Present only on the content-aware (WWWD) path (BI-7E1F128A). */
  contentAware: boolean;
  alignmentScore?: number;
  stanceAlignment?: "approve" | "decline" | "mixed" | "none";
  /** The owner's own prior ruling on THIS question, when one dominates the
   *  relevant material (BI-F5F2869D). Presence is what separates a settled
   *  question from a merely-aligned novel one. */
  settledByRuling?: { materialId: string; relevance: number };
};

/**
 * Relevance at or above which a `ruled` stance is treated as answering THIS
 * question rather than merely being consistent with it. Deliberately near the
 * top of the re-normalised range: a ruling that is not the best match in its
 * own scored set is not the answer to the question being asked.
 */
export const SETTLED_RULING_RELEVANCE_FLOOR = 0.9;

/** `ruled` tier per STANCE_TIERS: a human ruled on a real decision in this class. */
function isRuledTier(material: PerspectiveMaterial): boolean {
  return material.evidenceGrade === "A" && material.confidenceWeight >= 1;
}

/**
 * Re-normalise relevance WITHIN the set actually being scored (BI-F5F2869D).
 *
 * `computeStanceRelevance` min-max normalises across every material the
 * resolver returned, but only the applicable subset is scored. So the material
 * holding relevance 1.0 could sit outside the scored set, leaving it with no
 * 1.0 and an arbitrary ceiling — measured live, a decisive 1.0-weight ruling
 * scored 0.60 and the verdict was indistinguishable from having no answer at
 * all. Min-max is monotonic, so re-normalising the already-normalised subset
 * restores the intended contract: the best match in the scored set scores 1.
 */
function renormaliseWithinScoredSet(values: number[]): number[] {
  const max = Math.max(...values, 0);
  // Nothing in the scored set is relevant. Stretching that to 1 would
  // manufacture relevance out of its explicit absence and turn a coverage
  // `defer` into a confident verdict — the opposite of the intent.
  if (max < 1e-9) return values.map(() => 0);
  if (values.length <= 1) return values.map(() => 1);
  const min = Math.min(...values);
  // Equal-but-nonzero: genuinely indistinguishable, so none is down-weighted.
  if (max - min < 1e-9) return values.map(() => 1);
  return values.map((v) => (v - min) / (max - min));
}

function materialDirection(material: PerspectiveMaterial): "support" | "oppose" | "neutral" {
  const direction = material.direction ?? material.principleDirection ?? "neutral";
  return direction === "support" || direction === "oppose" ? direction : "neutral";
}

export function scoreProfileCoverage(input: {
  profile: DecisionPerspectiveProfile;
  materials: PerspectiveMaterial[];
  questionDomain: DecisionDomainClass;
  riskTier: DecisionRiskTier;
  recentOverrideCount: number;
  /** Per-material relevance ∈ [0,1]. Presence switches on the directional model. */
  relevanceByMaterialId?: Map<string, number>;
}): ProfileCoverage {
  const applicableMaterials = input.materials.filter(
    (material) =>
      material.profileId === input.profile.profileId
      && isMaterialApplicable(material, input.questionDomain),
  );
  const materialScores = applicableMaterials.map(scorePerspectiveMaterial);
  const overridePenalty = Math.min(0.3, input.recentOverrideCount * 0.1);

  // ── Legacy coverage path (WWMD, or when no relevance was supplied) ──────────
  // Confidence is the average effective weight of applicable material. Kept
  // verbatim so the build-studio gate is unchanged.
  if (!input.relevanceByMaterialId) {
    const positiveScores = materialScores.filter((score) => score.effectiveWeight > 0);
    const baseScore = positiveScores.length === 0
      ? 0
      : positiveScores.reduce((total, score) => total + score.effectiveWeight, 0) / positiveScores.length;
    const confidence = roundConfidence(baseScore - RISK_PENALTY[input.riskTier] - overridePenalty);
    return { profile: input.profile, applicableMaterials, materialScores, confidence, contentAware: false };
  }

  // ── Content-aware directional path (WWWD, BI-7E1F128A) ──────────────────────
  // Weight each material by how RELEVANT it is to this question, then read its
  // direction. Confidence is the decisiveness of the strongest relevant
  // directional stance scaled by how one-sided the relevant stance is, so an
  // off-mission decision (a relevant `oppose` stance) and an on-mission one (a
  // relevant `support` stance) produce materially different, directional
  // verdicts instead of an identical coverage constant.
  const scopedRelevance = renormaliseWithinScoredSet(
    applicableMaterials.map((m) => input.relevanceByMaterialId!.get(m.materialId) ?? 0),
  );

  let supportMass = 0;
  let opposeMass = 0;
  let bestDirectionalWeight = 0;
  let settledByRuling: ProfileCoverage["settledByRuling"];
  applicableMaterials.forEach((material, index) => {
    const effectiveWeight = materialScores[index]!.effectiveWeight;
    if (effectiveWeight <= 0) return;
    const relevance = scopedRelevance[index]!;
    const weighted = effectiveWeight * relevance;
    const direction = materialDirection(material);
    if (direction === "support") {
      supportMass += weighted;
      bestDirectionalWeight = Math.max(bestDirectionalWeight, weighted);
    } else if (direction === "oppose") {
      opposeMass += weighted;
      bestDirectionalWeight = Math.max(bestDirectionalWeight, weighted);
    }
    // Aligned is not settled. A generic supporting stance is merely consistent
    // with the proposal; only a `ruled` stance that dominates the relevant
    // material is the owner having already decided THIS question.
    if (
      direction !== "neutral"
      && isRuledTier(material)
      && relevance >= SETTLED_RULING_RELEVANCE_FLOOR
      && relevance > (settledByRuling?.relevance ?? 0)
    ) {
      settledByRuling = { materialId: material.materialId, relevance };
    }
  });

  const directionalMass = supportMass + opposeMass;
  const alignmentScore = directionalMass > 0 ? (supportMass - opposeMass) / directionalMass : 0;
  const confidence = roundConfidence(
    bestDirectionalWeight * Math.abs(alignmentScore) - RISK_PENALTY[input.riskTier] - overridePenalty,
  );

  let stanceAlignment: ProfileCoverage["stanceAlignment"];
  if (directionalMass <= 0) {
    stanceAlignment = "none";
  } else if (Math.abs(alignmentScore) < ALIGNMENT_CONFLICT_BAND) {
    stanceAlignment = "mixed";
  } else {
    stanceAlignment = alignmentScore > 0 ? "approve" : "decline";
  }

  return {
    profile: input.profile,
    applicableMaterials,
    materialScores,
    confidence,
    contentAware: true,
    alignmentScore,
    stanceAlignment,
    ...(settledByRuling ? { settledByRuling } : {}),
  };
}

export function summarizeFreshness(scores: PerspectiveMaterialScore[]) {
  return scores.reduce(
    (counts, score) => {
      counts[score.freshness] += 1;
      return counts;
    },
    { current: 0, stale: 0, superseded: 0, contradicted: 0 },
  );
}

export function hasPrincipleConflict(materials: PerspectiveMaterial[]): boolean {
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
