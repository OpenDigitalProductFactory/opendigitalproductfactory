import { DECISION_DOMAIN_CLASSES, type DecisionDomainClass } from "./types";
import type {
  DecisionAutonomyPolicy,
  DecisionPerspectiveProfile,
  DecisionResolverRule,
  PerspectiveEvidenceGrade,
  PerspectiveMaterial,
  PerspectiveMaterialFreshness,
  PerspectiveMaterialScore,
  PerspectivePromotionState,
  PerspectiveReviewStatus,
} from "./types";

export const DPF_ORGANIZATIONAL_PRINCIPLES_PROFILE_ID = "dpf-organizational-principles";

type DbDecisionPerspectiveProfile = {
  profileId: string;
  name?: string;
  kind?: string;
  scope?: Record<string, unknown> | null;
  fallbackProfileId: string | null;
  defaultResolver?: Record<string, unknown> | null;
  autonomyPolicy?: Record<string, unknown> | null;
  currentVersion?: { versionId: string; versionNumber: number } | null;
};

type DbPerspectiveMaterial = {
  materialId: string;
  profileId: string;
  sourceType: string;
  sourceRef: Record<string, unknown>;
  summary: string | null;
  domainClass: DecisionDomainClass;
  direction: "support" | "oppose" | "neutral";
  domains: string[];
  freshness: PerspectiveMaterialFreshness;
  evidenceGrade: PerspectiveEvidenceGrade;
  confidenceWeight: number;
  reviewStatus: PerspectiveReviewStatus;
  promotionState: PerspectivePromotionState;
  lastValidatedAt: Date | null;
};

type PerspectiveMaterialClient = {
  decisionPerspectiveProfile: {
    findUnique(args: {
      where: { profileId: string };
      select: Record<string, unknown>;
    }): Promise<unknown>;
  };
  perspectiveMaterial: {
    findMany(args: {
      where: Record<string, unknown>;
      orderBy: Array<Record<string, string>>;
    }): Promise<unknown>;
  };
};

export type ResolvedProfileMaterial = {
  selectedProfileId: string | null;
  selectedProfile: DecisionPerspectiveProfile | null;
  resolvedProfileChain: string[];
  coverageGap: boolean;
  materials: PerspectiveMaterial[];
};

const FRESHNESS_FACTORS: Record<PerspectiveMaterialFreshness, number> = {
  current: 1,
  stale: 0.5,
  superseded: 0.2,
  contradicted: 0,
};

const EVIDENCE_FACTORS: Record<PerspectiveEvidenceGrade, number> = {
  A: 1,
  B: 0.75,
  C: 0.4,
  D: 0,
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

export function isMaterialApplicable(material: PerspectiveMaterial, domain: DecisionDomainClass): boolean {
  return material.domainClass === domain;
}

export function scorePerspectiveMaterial(material: PerspectiveMaterial): PerspectiveMaterialScore {
  const freshnessFactor = FRESHNESS_FACTORS[material.freshness];
  const evidenceFactor = EVIDENCE_FACTORS[material.evidenceGrade];
  const reviewFactor = REVIEW_FACTORS[material.reviewStatus];
  const promotionFactor = PROMOTION_FACTORS[material.promotionState];
  // Superseded material has been replaced by a fresher source; like contradicted
  // material it stays queryable for audit but must NOT drive a decision
  // (BI-06B2EC05 / design §8). Excluded (weight 0), not merely down-weighted.
  const exclusionReason =
    material.freshness === "contradicted"
      ? "contradicted"
      : material.freshness === "superseded"
        ? "superseded"
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

function normalizePrincipleDirection(value: unknown): PerspectiveMaterial["principleDirection"] {
  return value === "support" || value === "oppose" || value === "neutral"
    ? value
    : undefined;
}

function normalizeDomainClass(value: unknown): DecisionDomainClass {
  return typeof value === "string" && (DECISION_DOMAIN_CLASSES as readonly string[]).includes(value)
    ? value as DecisionDomainClass
    : "plan-readiness";
}

function normalizeDirection(value: unknown): PerspectiveMaterial["direction"] {
  return value === "support" || value === "oppose" || value === "neutral"
    ? value
    : "neutral";
}

function normalizeEvidenceGrade(value: unknown): PerspectiveEvidenceGrade {
  return value === "A" || value === "B" || value === "C" || value === "D"
    ? value
    : "D";
}

function toPerspectiveMaterial(row: DbPerspectiveMaterial): PerspectiveMaterial {
  return {
    materialId: row.materialId,
    profileId: row.profileId,
    sourceType: row.sourceType,
    sourceRef: row.sourceRef,
    summary: row.summary ?? "",
    domainClass: normalizeDomainClass(row.domainClass),
    direction: normalizeDirection(row.direction ?? row.sourceRef?.principleDirection),
    domains: row.domains,
    freshness: row.freshness,
    evidenceGrade: normalizeEvidenceGrade(row.evidenceGrade),
    confidenceWeight: row.confidenceWeight,
    principleDirection: normalizePrincipleDirection(row.sourceRef?.principleDirection),
    reviewStatus: row.reviewStatus,
    promotionState: row.promotionState,
    lastValidatedAt: row.lastValidatedAt,
  };
}

function toDecisionPerspectiveProfile(row: DbDecisionPerspectiveProfile): DecisionPerspectiveProfile {
  const autonomyPolicy = (row.autonomyPolicy ?? {}) as Partial<DecisionAutonomyPolicy>;
  const defaultResolver = (row.defaultResolver ?? {}) as Partial<DecisionResolverRule>;
  return {
    profileId: row.profileId,
    name: row.name ?? row.profileId,
    kind: row.kind === "organization" || row.kind === "customer" || row.kind === "team"
      ? row.kind
      : "platform",
    scope: {
      domains: Array.isArray(row.scope?.domains) ? row.scope.domains as string[] : [],
      routes: Array.isArray(row.scope?.routes) ? row.scope.routes as string[] : undefined,
      products: Array.isArray(row.scope?.products) ? row.scope.products as string[] : undefined,
    },
    fallbackProfileId: row.fallbackProfileId,
    defaultResolver: {
      type: defaultResolver.type === "principal" || defaultResolver.type === "role" || defaultResolver.type === "manual"
        ? defaultResolver.type
        : "build-studio-owner",
      principalId: typeof defaultResolver.principalId === "string" ? defaultResolver.principalId : undefined,
      role: typeof defaultResolver.role === "string" ? defaultResolver.role : undefined,
    },
    autonomyPolicy: {
      allowRecommendation: autonomyPolicy.allowRecommendation ?? true,
      allowArbitration: autonomyPolicy.allowArbitration ?? false,
      maxRiskForArbitration: autonomyPolicy.maxRiskForArbitration ?? "low",
      minimumConfidenceForRecommendation: autonomyPolicy.minimumConfidenceForRecommendation ?? 0.55,
      minimumConfidenceForArbitration: autonomyPolicy.minimumConfidenceForArbitration ?? 0.9,
    },
    currentVersion: {
      versionId: row.currentVersion?.versionId ?? `${row.profileId}-unversioned`,
      versionNumber: row.currentVersion?.versionNumber ?? 0,
      materialFingerprint: "unavailable",
      changeSummary: "Runtime profile snapshot",
      createdAt: new Date(0),
    },
  };
}

export async function resolveProfileMaterial(input: {
  db: PerspectiveMaterialClient;
  profileId: string;
  domainClass: DecisionDomainClass;
  maxDepth?: number;
}): Promise<ResolvedProfileMaterial> {
  const resolvedProfileChain: string[] = [];
  const visited = new Set<string>();
  let nextProfileId: string | null = input.profileId;
  const maxDepth = input.maxDepth ?? 6;

  for (let depth = 0; nextProfileId && depth < maxDepth; depth++) {
    if (visited.has(nextProfileId)) break;
    visited.add(nextProfileId);
    resolvedProfileChain.push(nextProfileId);

    const profile = await input.db.decisionPerspectiveProfile.findUnique({
      where: { profileId: nextProfileId },
      select: {
        profileId: true,
        name: true,
        kind: true,
        scope: true,
        fallbackProfileId: true,
        defaultResolver: true,
        autonomyPolicy: true,
        currentVersion: { select: { versionId: true, versionNumber: true } },
      },
    }) as DbDecisionPerspectiveProfile | null;

    if (!profile) {
      break;
    }

    const rows = await input.db.perspectiveMaterial.findMany({
      where: {
        profileId: profile.profileId,
        domainClass: input.domainClass,
        reviewStatus: "approved",
        promotionState: "promoted",
      },
      orderBy: [{ sourceType: "asc" }, { materialId: "asc" }],
    }) as DbPerspectiveMaterial[];

    if (rows.length > 0) {
      if (!resolvedProfileChain.includes(DPF_ORGANIZATIONAL_PRINCIPLES_PROFILE_ID)) {
        resolvedProfileChain.push(DPF_ORGANIZATIONAL_PRINCIPLES_PROFILE_ID);
      }
      return {
        selectedProfileId: profile.profileId,
        selectedProfile: toDecisionPerspectiveProfile(profile),
        resolvedProfileChain,
        coverageGap: false,
        materials: rows.map(toPerspectiveMaterial),
      };
    }

    nextProfileId = profile.fallbackProfileId;
  }

  if (!visited.has(DPF_ORGANIZATIONAL_PRINCIPLES_PROFILE_ID)) {
    resolvedProfileChain.push(DPF_ORGANIZATIONAL_PRINCIPLES_PROFILE_ID);
  }

  return {
    selectedProfileId: null,
    selectedProfile: null,
    resolvedProfileChain,
    coverageGap: true,
    materials: [],
  };
}
