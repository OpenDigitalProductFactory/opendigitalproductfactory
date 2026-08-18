import { CROSS_DOMAIN_MATERIAL_TAG, DECISION_DOMAIN_CLASSES, type DecisionDomainClass } from "./types";
import { MARK_DPF_PLATFORM_PROFILE } from "./default-profile";
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

/**
 * Minimal client for selecting a per-org DecisionPerspectiveProfile by the
 * organization it belongs to. Satisfied by the real PrismaClient and by test
 * fakes. Kept separate from {@link PerspectiveMaterialClient} so callers that
 * only resolve material do not have to provide `findFirst`.
 */
type OrgProfileClient = {
  decisionPerspectiveProfile: {
    findFirst(args: {
      where: Record<string, unknown>;
      select: Record<string, unknown>;
      orderBy?: Record<string, string> | Array<Record<string, string>>;
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

/**
 * Is this material eligible to inform a decision in `domain`? (BI-F5F2869D)
 *
 * This used to be exact equality on `domainClass`, which made a caller-supplied
 * bucket the hard gate on which doctrine a decision could ever see. Relevance
 * ranking runs AFTER this filter, so anything excluded here is invisible to the
 * content-aware path no matter how on-point it is.
 *
 * That silently broke the "remember this" loop. `captureOrgDecisionOutcome`
 * files a `ruled` material under the domainClass of the interaction being
 * answered, and `evaluate_org_business_decision` takes domainClass as a
 * caller-supplied argument — so the same business question asked twice, bucketed
 * differently, cannot retrieve its own prior ruling. Live: the owner's ruling on
 * "offer a self-hosted support subscription through MSP partners" sits in
 * `plan-readiness`; the MSP question arrived as `risk-assessment`; the decision
 * escalated with the answer already in the corpus.
 *
 * Matching is now ADDITIVE over the previously-dormant `domains[]` field, the
 * direction the 2026-07-11 stance-onboarding design named at §a3 and the option
 * the kernel scored highest (margin 3.08, no commandment conflict). Domain stays
 * a real constraint — this widens eligibility, it does not remove it, and the
 * relevance layer still decides what actually carries weight.
 */
export function isMaterialApplicable(material: PerspectiveMaterial, domain: DecisionDomainClass): boolean {
  if (material.domainClass === domain) return true;
  const tags = material.domains ?? [];
  return tags.includes(domain) || tags.includes(CROSS_DOMAIN_MATERIAL_TAG);
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
        // BI-F5F2869D: must mirror isMaterialApplicable. Narrowing here to an
        // exact domainClass would re-impose the hard gate before the in-memory
        // predicate ever runs, and the additive tag would be dead code.
        OR: [
          { domainClass: input.domainClass },
          { domains: { has: input.domainClass } },
          { domains: { has: CROSS_DOMAIN_MATERIAL_TAG } },
        ],
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

/**
 * Org DecisionPerspectiveProfile resolution entry-point (BI-230C9EF7).
 *
 * Maps an organization to its active, org-owned WWWD profile. Until this
 * existed, the decision gate could only enter the resolution chain at a known
 * `profileId` (e.g. the platform WWMD profile) — `ownerOrganizationId` was
 * written by `seedOrgWwwdCorpus` but never read, so business decisions silently
 * fell back to founder/platform doctrine. This is the missing primitive that
 * lets a business-decision surface select the customer's own profile.
 *
 * Returns the profileId of the org's active `kind="organization"` profile, or
 * `null` when the org has none (caller then uses its platform/default fallback).
 * Deterministic: when more than one matches, the oldest (stable) wins.
 */
export async function resolveOrgProfileId(input: {
  db: OrgProfileClient;
  organizationId: string | null | undefined;
}): Promise<string | null> {
  if (!input.organizationId) return null;

  const row = (await input.db.decisionPerspectiveProfile.findFirst({
    where: {
      ownerOrganizationId: input.organizationId,
      kind: "organization",
      status: "active",
    },
    select: { profileId: true },
    orderBy: { createdAt: "asc" },
  })) as { profileId: string } | null;

  return row?.profileId ?? null;
}

/**
 * Resolve decision material for a profession (BI-9900B365, EP-8DC217EB BET-0c).
 *
 * The WSID sibling of {@link resolveProfileMaterialForOrg}: the entry point is
 * the coworker's profession profile (`wsid-<professionKey>`, bound
 * registry-driven via docs/professions/registry.json), and the resolution
 * enters the same chain-walk. `professionProfileSelected` records whether the
 * coworker's OWN craft profile decided (vs a platform fallback) — the same
 * non-inherit boundary the org gate enforces for WWWD.
 */
export async function resolveProfileMaterialForProfession(input: {
  db: PerspectiveMaterialClient;
  agentIdentity: {
    agentId?: string | null;
    agentName?: string | null;
    roleSlug?: string | null;
    slugId?: string | null;
  };
  /**
   * Declared borrow (BI-52839DEA). When set, the profession is named by the
   * caller instead of derived from an agent identity — the path an external
   * development surface (Claude Code / Codex / Grok) takes, since it holds no
   * coworker identity to resolve from.
   *
   * FAIL-CLOSED BY CONTRACT: an unrecognised key THROWS rather than falling
   * through to identity resolution or to platform doctrine. A borrow that
   * silently degraded to generic doctrine would return platform defaults
   * wearing a profession's name, which is exactly the silent-success failure
   * mode the UX-quality program exists to outlaw.
   *
   * The caller decides whether a borrow is permitted; this function only
   * honours it. The gate is what refuses a borrow from a caller that already
   * carries an agent identity.
   */
  declaredProfessionKey?: string | null;
  domainClass: DecisionDomainClass;
  fallbackProfileId?: string;
  maxDepth?: number;
}): Promise<
  ResolvedProfileMaterial & { professionProfileSelected: boolean; professionKey: string | null }
> {
  const { findProfessionFamilyForAgentIdentity, findProfessionFamilyByKey, professionProfileId } =
    await import("./resolve-profession-profile");

  const declaredKey = input.declaredProfessionKey?.trim() || null;
  let family: ReturnType<typeof findProfessionFamilyForAgentIdentity>;
  if (declaredKey) {
    family = findProfessionFamilyByKey(declaredKey);
    if (!family) {
      throw new Error(
        `Unknown professionKey "${declaredKey}". A declared borrow must name a profession family ` +
          `registered in docs/professions/registry.json; it does not fall back to platform doctrine.`,
      );
    }
  } else {
    family = findProfessionFamilyForAgentIdentity({
      agentId: input.agentIdentity.agentId ?? null,
      name: input.agentIdentity.agentName ?? null,
      roleSlug: input.agentIdentity.roleSlug ?? null,
      slugId: input.agentIdentity.slugId ?? null,
    });
  }

  const professionKey = family?.professionKey ?? null;
  const entryProfileId = professionKey
    ? professionProfileId(professionKey)
    : (input.fallbackProfileId ?? MARK_DPF_PLATFORM_PROFILE.profileId);

  const resolved = await resolveProfileMaterial({
    db: input.db,
    profileId: entryProfileId,
    domainClass: input.domainClass,
    maxDepth: input.maxDepth,
  });

  // The profession profile "decided" only when the coworker maps to a family
  // AND the material that resolved came from that profile itself (not a
  // fallback further down the chain, and not the coverage-gap path).
  const professionProfileSelected =
    professionKey !== null &&
    !resolved.coverageGap &&
    resolved.selectedProfileId === entryProfileId;

  return { ...resolved, professionProfileSelected, professionKey };
}

/**
 * Resolve decision material for an organization (BI-230C9EF7).
 *
 * Convenience composition of {@link resolveOrgProfileId} +
 * {@link resolveProfileMaterial}: selects the org's WWWD profile when one
 * exists and enters the resolution/fallback chain there; otherwise enters at
 * `fallbackProfileId` (defaulting to the platform WWMD profile). The returned
 * `orgProfileSelected` flag lets callers and audit records record *which*
 * doctrine governed the decision (WWWD org vs WWMD platform) — the non-inherit
 * boundary the gate exists to enforce.
 */
export async function resolveProfileMaterialForOrg(input: {
  db: PerspectiveMaterialClient & OrgProfileClient;
  organizationId: string | null | undefined;
  domainClass: DecisionDomainClass;
  fallbackProfileId?: string;
  maxDepth?: number;
}): Promise<ResolvedProfileMaterial & { orgProfileSelected: boolean }> {
  const orgProfileId = await resolveOrgProfileId({
    db: input.db,
    organizationId: input.organizationId,
  });

  const entryProfileId =
    orgProfileId ?? input.fallbackProfileId ?? MARK_DPF_PLATFORM_PROFILE.profileId;

  const resolved = await resolveProfileMaterial({
    db: input.db,
    profileId: entryProfileId,
    domainClass: input.domainClass,
    maxDepth: input.maxDepth,
  });

  return { ...resolved, orgProfileSelected: orgProfileId !== null };
}
