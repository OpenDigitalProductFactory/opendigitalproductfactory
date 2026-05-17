import type {
  PerspectiveEvidenceGrade,
  PerspectiveMaterial,
  PerspectiveMaterialFreshness,
  PerspectiveMaterialScore,
  PerspectivePromotionState,
  PerspectiveReviewStatus,
} from "./types";

const FRESHNESS_FACTORS: Record<PerspectiveMaterialFreshness, number> = {
  current: 1,
  stale: 0.55,
  superseded: 0.25,
  contradicted: 0,
};

const EVIDENCE_FACTORS: Record<PerspectiveEvidenceGrade, number> = {
  A: 1,
  B: 0.85,
  C: 0.55,
  D: 0.2,
};

const REVIEW_FACTORS: Record<PerspectiveReviewStatus, number> = {
  approved: 1,
  draft: 0.35,
  rejected: 0,
};

const PROMOTION_FACTORS: Record<PerspectivePromotionState, number> = {
  promoted: 1,
  candidate: 0.45,
  revoked: 0,
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function isMaterialApplicable(material: PerspectiveMaterial, domain: string): boolean {
  if (material.domains.length === 0) return true;
  return material.domains.includes(domain) || material.domains.includes("*");
}

export function scorePerspectiveMaterial(material: PerspectiveMaterial): PerspectiveMaterialScore {
  const freshnessFactor = FRESHNESS_FACTORS[material.freshness];
  const evidenceFactor = EVIDENCE_FACTORS[material.evidenceGrade];
  const reviewFactor = REVIEW_FACTORS[material.reviewStatus];
  const promotionFactor = PROMOTION_FACTORS[material.promotionState];
  const exclusionReason =
    material.freshness === "contradicted"
      ? "contradicted"
      : material.reviewStatus === "rejected"
        ? "rejected"
        : material.promotionState === "revoked"
          ? "revoked"
          : null;

  const effectiveWeight = exclusionReason
    ? 0
    : clamp01(material.confidenceWeight)
      * freshnessFactor
      * evidenceFactor
      * reviewFactor
      * promotionFactor;

  return {
    materialId: material.materialId,
    profileId: material.profileId,
    sourceType: material.sourceType,
    freshness: material.freshness,
    confidenceWeight: clamp01(material.confidenceWeight),
    freshnessFactor,
    evidenceFactor,
    reviewFactor,
    promotionFactor,
    effectiveWeight: Number(effectiveWeight.toFixed(4)),
    exclusionReason,
  };
}
