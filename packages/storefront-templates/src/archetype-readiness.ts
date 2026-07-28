import { ALL_ARCHETYPES } from "./archetypes";
import type { ArchetypeCategory } from "./types";

export const ARCHETYPE_READINESS_TIERS = [
  "template-ready",
  "ops-ready",
  "connector-ready",
  "regulated-ready",
  "sole-platform-ready",
] as const;

export type ArchetypeReadinessTier = (typeof ARCHETYPE_READINESS_TIERS)[number];

export type ArchetypeReadinessEvidenceKind =
  | "backlog-item"
  | "epic"
  | "spec"
  | "plan"
  | "code"
  | "verification";

export type ArchetypeReadinessEvidenceStatus =
  | "planned"
  | "open"
  | "in-progress"
  | "done"
  | "merged"
  | "required";

export interface ArchetypeReadinessEvidenceRef {
  kind: ArchetypeReadinessEvidenceKind;
  id: string;
  title: string;
  status: ArchetypeReadinessEvidenceStatus;
  path?: string;
}

export interface ArchetypeReadinessTierRequirement {
  tier: ArchetypeReadinessTier;
  summary: string;
  requiredEvidence: readonly string[];
}

export interface ArchetypeReadinessBlocker {
  tier: Exclude<ArchetypeReadinessTier, "template-ready">;
  reason: string;
  evidence: readonly ArchetypeReadinessEvidenceRef[];
}

export interface ArchetypeReadinessRecord {
  scopeKind: "archetype-category";
  archetypeCategory: ArchetypeCategory;
  highestClaimableTier: ArchetypeReadinessTier;
  evidenceByTier: Partial<Record<ArchetypeReadinessTier, readonly ArchetypeReadinessEvidenceRef[]>>;
  dependencies: readonly ArchetypeReadinessEvidenceRef[];
  blockersByTier: Partial<
    Record<Exclude<ArchetypeReadinessTier, "template-ready">, readonly ArchetypeReadinessBlocker[]>
  >;
}

export interface ArchetypeReadinessClaimRequest {
  requestedTier: ArchetypeReadinessTier;
  archetypeCategory?: ArchetypeCategory;
  archetypeId?: string;
  matrix?: readonly ArchetypeReadinessRecord[];
}

export interface ArchetypeReadinessClaimResult {
  allowed: boolean;
  requestedTier: ArchetypeReadinessTier;
  highestClaimableTier?: ArchetypeReadinessTier;
  archetypeCategory?: ArchetypeCategory;
  missingEvidence: readonly string[];
  blockers: readonly ArchetypeReadinessBlocker[];
}

export const ARCHETYPE_READINESS_TIER_REQUIREMENTS = [
  {
    tier: "template-ready",
    summary: "The archetype exists in the template taxonomy and passes structural completeness.",
    requiredEvidence: [
      "ArchetypeCategory and ALL_ARCHETYPES coverage",
      "Archetype Completeness Guard structural floor",
    ],
  },
  {
    tier: "ops-ready",
    summary: "The archetype has verified owner workflows, operational records, and acceptance tests.",
    requiredEvidence: [
      "Completed or explicitly verified vertical-readiness lane",
      "Typed archetype contribution registry through BI-PSC-010",
      "Acceptance evidence for owner cockpit, request lifecycle, finance, capacity, and master data",
    ],
  },
  {
    tier: "connector-ready",
    summary: "The archetype has its replacement boundary and connector posture proven.",
    requiredEvidence: [
      "Ops-ready evidence",
      "Integration/replacement-boundary map",
      "Tier-1 connector posture and adapter support evidence",
    ],
  },
  {
    tier: "regulated-ready",
    summary: "The archetype has policy, audit, authority, and compliance evidence for regulated use.",
    requiredEvidence: [
      "Connector-ready evidence",
      "Regulated policy pack or explicit non-regulated classification",
      "Audit, retention, approval, and jurisdictional evidence",
    ],
  },
  {
    tier: "sole-platform-ready",
    summary: "The archetype has enough resilience, portability, and action integrity for one-platform use.",
    requiredEvidence: [
      "Regulated-ready evidence where regulation applies, or connector-ready evidence for non-regulated categories",
      "Sole-platform operational readiness evidence gate",
      "Whole-account export and restore-grade data portability",
      "Universal AI action envelope and reversibility evidence",
    ],
  },
] as const satisfies readonly ArchetypeReadinessTierRequirement[];

const PLATFORM_CONTRIBUTION_CONTRACT: ArchetypeReadinessEvidenceRef = {
  kind: "backlog-item",
  id: "BI-PSC-010",
  title: "Typed archetype contribution registry across templates and seeds",
  status: "open",
};

const ARCHETYPE_PROVISIONING_PLAYBOOK: ArchetypeReadinessEvidenceRef = {
  kind: "spec",
  id: "2026-07-21-archetype-provisioning-playbook-design",
  title: "Archetype Provisioning Playbook",
  status: "merged",
  path: "docs/superpowers/specs/2026-07-21-archetype-provisioning-playbook-design.md",
};

const TEMPLATE_TAXONOMY: ArchetypeReadinessEvidenceRef = {
  kind: "code",
  id: "packages/storefront-templates/src/archetypes/index.ts",
  title: "ALL_ARCHETYPES category taxonomy",
  status: "merged",
  path: "packages/storefront-templates/src/archetypes/index.ts",
};

const ECOSYSTEM_ABSORPTION: ArchetypeReadinessEvidenceRef = {
  kind: "epic",
  id: "EP-ECOSYSTEM-ABSORPTION-ARCH",
  title: "Ecosystem Absorption Architecture",
  status: "open",
};

const SOLE_PLATFORM_OPERATIONS_GATE: ArchetypeReadinessEvidenceRef = {
  kind: "backlog-item",
  id: "BI-903F5A94",
  title: "Sole-platform operational readiness evidence gate",
  status: "open",
};

const WHOLE_ACCOUNT_PORTABILITY: ArchetypeReadinessEvidenceRef = {
  kind: "backlog-item",
  id: "BI-4C16947C",
  title: "Whole-account export and restore-grade data portability",
  status: "open",
};

const ACTION_ENVELOPE_REVERSIBILITY: ArchetypeReadinessEvidenceRef = {
  kind: "backlog-item",
  id: "BI-35E9EE62",
  title: "Universal AI business-record action envelope and reversibility matrix",
  status: "open",
};

const VERTICAL_READINESS_EPICS_BY_CATEGORY: Partial<
  Record<ArchetypeCategory, ArchetypeReadinessEvidenceRef>
> = {
  "asset-rental": {
    kind: "epic",
    id: "EP-VERTICAL-ASSET-RENTAL",
    title: "Industry Vertical Readiness - Asset rental",
    status: "open",
  },
  "automotive-services": {
    kind: "epic",
    id: "EP-VERTICAL-AUTOMOTIVE",
    title: "Industry Vertical Readiness - Automotive services",
    status: "open",
  },
  "banking-financial-services": {
    kind: "epic",
    id: "EP-VERTICAL-BANKING",
    title: "Industry Vertical Readiness - Banking and financial services",
    status: "open",
  },
  "beauty-personal-care": {
    kind: "epic",
    id: "EP-EB32313A",
    title: "Industry Vertical Readiness - Beauty and personal care",
    status: "open",
  },
  "education-training": {
    kind: "epic",
    id: "EP-VERTICAL-EDUCATION",
    title: "Industry Vertical Readiness - Education and training",
    status: "open",
  },
  "fabric-care-services": {
    kind: "epic",
    id: "EP-FABRIC-CARE-OPS",
    title: "Fabric Care Operations Readiness",
    status: "open",
  },
  "fitness-recreation": {
    kind: "epic",
    id: "EP-VERTICAL-FITNESS",
    title: "Industry Vertical Readiness - Fitness and recreation",
    status: "open",
  },
  "food-hospitality": {
    kind: "epic",
    id: "EP-VERTICAL-FOOD-HOSPITALITY",
    title: "Industry Vertical Readiness - Food and hospitality",
    status: "open",
  },
  "healthcare-wellness": {
    kind: "epic",
    id: "EP-525F29E5",
    title: "Industry Vertical Readiness - Healthcare and wellness",
    status: "open",
  },
  "hoa-property-management": {
    kind: "epic",
    id: "EP-VERTICAL-HOA-PROPERTY",
    title: "Industry Vertical Readiness - HOA and property management",
    status: "open",
  },
  "live-events-venues": {
    kind: "epic",
    id: "EP-VERTICAL-EVENTS",
    title: "Industry Vertical Readiness - Live events and venues",
    status: "open",
  },
  "media-production": {
    kind: "epic",
    id: "EP-VERTICAL-MEDIA",
    title: "Industry Vertical Readiness - Media production",
    status: "open",
  },
  "moving-and-logistics": {
    kind: "epic",
    id: "EP-VERTICAL-MOVING-LOGISTICS",
    title: "Industry Vertical Readiness - Moving and logistics",
    status: "open",
  },
  "nonprofit-community": {
    kind: "epic",
    id: "EP-VERTICAL-NONPROFIT",
    title: "Industry Vertical Readiness - Nonprofit and community",
    status: "open",
  },
  "pet-services": {
    kind: "epic",
    id: "EP-VERTICAL-PET-SERVICES",
    title: "Industry Vertical Readiness - Pet services",
    status: "open",
  },
  "professional-services": {
    kind: "epic",
    id: "EP-VERTICAL-PROFESSIONAL",
    title: "Industry Vertical Readiness - Professional services",
    status: "open",
  },
  "public-sector": {
    kind: "epic",
    id: "EP-VERTICAL-PUBLIC-SECTOR",
    title: "Industry Vertical Readiness - Public sector and civic",
    status: "open",
  },
  "real-estate-construction": {
    kind: "epic",
    id: "EP-VERTICAL-CONSTRUCTION",
    title: "Industry Vertical Readiness - Real estate and construction",
    status: "open",
  },
  "retail-goods": {
    kind: "epic",
    id: "EP-VERTICAL-RETAIL-GOODS",
    title: "Industry Vertical Readiness - Retail and goods",
    status: "open",
  },
  "security-services": {
    kind: "epic",
    id: "EP-VERTICAL-SECURITY",
    title: "Industry Vertical Readiness - Security services",
    status: "open",
  },
  "software-platform": {
    kind: "epic",
    id: "EP-VERTICAL-SOFTWARE",
    title: "Industry Vertical Readiness - Software platform",
    status: "open",
  },
  "warehousing-fulfilment": {
    kind: "epic",
    id: "EP-VERTICAL-WAREHOUSING",
    title: "Industry Vertical Readiness - Warehousing and fulfilment",
    status: "open",
  },
};

const TIER_RANK = ARCHETYPE_READINESS_TIERS.reduce(
  (rank, tier, index) => ({ ...rank, [tier]: index }),
  {} as Record<ArchetypeReadinessTier, number>,
);

const ALL_ARCHETYPE_CATEGORIES = Array.from(
  new Set(ALL_ARCHETYPES.map((archetype) => archetype.category)),
).sort() as ArchetypeCategory[];

function blockedByOpenEvidence(
  tier: Exclude<ArchetypeReadinessTier, "template-ready">,
  reason: string,
  evidence: readonly ArchetypeReadinessEvidenceRef[],
): ArchetypeReadinessBlocker {
  return { tier, reason, evidence };
}

function buildCategoryRecord(category: ArchetypeCategory): ArchetypeReadinessRecord {
  const verticalReadinessEpic = VERTICAL_READINESS_EPICS_BY_CATEGORY[category];
  const dependencies = [
    PLATFORM_CONTRIBUTION_CONTRACT,
    ...(verticalReadinessEpic ? [verticalReadinessEpic] : []),
    ECOSYSTEM_ABSORPTION,
    SOLE_PLATFORM_OPERATIONS_GATE,
    WHOLE_ACCOUNT_PORTABILITY,
    ACTION_ENVELOPE_REVERSIBILITY,
  ];

  const opsEvidence = [
    PLATFORM_CONTRIBUTION_CONTRACT,
    ...(verticalReadinessEpic ? [verticalReadinessEpic] : []),
  ];

  const opsBlockers = [
    blockedByOpenEvidence(
      "ops-ready",
      verticalReadinessEpic
        ? `${verticalReadinessEpic.id} is open; close or attach accepted verification evidence before claiming ops readiness.`
        : "No category-level vertical-readiness epic is mapped for this archetype category.",
      opsEvidence,
    ),
    blockedByOpenEvidence(
      "ops-ready",
      "BI-PSC-010 is still open; typed archetype contributions are not yet the single enforced door.",
      [PLATFORM_CONTRIBUTION_CONTRACT],
    ),
  ];

  return {
    scopeKind: "archetype-category",
    archetypeCategory: category,
    highestClaimableTier: "template-ready",
    evidenceByTier: {
      "template-ready": [TEMPLATE_TAXONOMY, ARCHETYPE_PROVISIONING_PLAYBOOK],
      "ops-ready": opsEvidence,
      "connector-ready": [ECOSYSTEM_ABSORPTION],
      "sole-platform-ready": [
        SOLE_PLATFORM_OPERATIONS_GATE,
        WHOLE_ACCOUNT_PORTABILITY,
        ACTION_ENVELOPE_REVERSIBILITY,
      ],
    },
    dependencies,
    blockersByTier: {
      "ops-ready": opsBlockers,
      "connector-ready": [
        blockedByOpenEvidence(
          "connector-ready",
          "Connector readiness requires the ops-ready tier plus a completed replacement-boundary and connector-posture lane.",
          [ECOSYSTEM_ABSORPTION],
        ),
      ],
      "regulated-ready": [
        blockedByOpenEvidence(
          "regulated-ready",
          "Regulated readiness requires connector readiness plus policy, audit, approval, and jurisdictional evidence.",
          [verticalReadinessEpic ?? PLATFORM_CONTRIBUTION_CONTRACT],
        ),
      ],
      "sole-platform-ready": [
        blockedByOpenEvidence(
          "sole-platform-ready",
          "Sole-platform readiness requires operations, portability, and AI action integrity gates to be completed.",
          [
            SOLE_PLATFORM_OPERATIONS_GATE,
            WHOLE_ACCOUNT_PORTABILITY,
            ACTION_ENVELOPE_REVERSIBILITY,
          ],
        ),
      ],
    },
  };
}

export const ARCHETYPE_READINESS_MATRIX =
  ALL_ARCHETYPE_CATEGORIES.map(buildCategoryRecord) as readonly ArchetypeReadinessRecord[];

export function compareArchetypeReadinessTiers(
  left: ArchetypeReadinessTier,
  right: ArchetypeReadinessTier,
): number {
  return TIER_RANK[left] - TIER_RANK[right];
}

export function resolveArchetypeReadinessRecord({
  archetypeCategory,
  archetypeId,
  matrix = ARCHETYPE_READINESS_MATRIX,
}: Omit<ArchetypeReadinessClaimRequest, "requestedTier">):
  | ArchetypeReadinessRecord
  | null {
  const category =
    archetypeCategory ??
    ALL_ARCHETYPES.find((archetype) => archetype.archetypeId === archetypeId)?.category;

  if (!category) return null;

  return matrix.find((record) => record.archetypeCategory === category) ?? null;
}

export function evaluateArchetypeReadinessClaim(
  request: ArchetypeReadinessClaimRequest,
): ArchetypeReadinessClaimResult {
  const record = resolveArchetypeReadinessRecord(request);

  if (!record) {
    return {
      allowed: false,
      requestedTier: request.requestedTier,
      missingEvidence: ["Known archetype category or archetype id."],
      blockers: [],
    };
  }

  const allowed =
    compareArchetypeReadinessTiers(record.highestClaimableTier, request.requestedTier) >= 0;

  if (allowed) {
    return {
      allowed: true,
      requestedTier: request.requestedTier,
      highestClaimableTier: record.highestClaimableTier,
      archetypeCategory: record.archetypeCategory,
      missingEvidence: [],
      blockers: [],
    };
  }

  const missingTiers = ARCHETYPE_READINESS_TIERS.filter(
    (tier) =>
      compareArchetypeReadinessTiers(tier, record.highestClaimableTier) > 0 &&
      compareArchetypeReadinessTiers(tier, request.requestedTier) <= 0,
  ) as Exclude<ArchetypeReadinessTier, "template-ready">[];
  const blockers = missingTiers.flatMap((tier) => [...(record.blockersByTier[tier] ?? [])]);

  return {
    allowed: false,
    requestedTier: request.requestedTier,
    highestClaimableTier: record.highestClaimableTier,
    archetypeCategory: record.archetypeCategory,
    missingEvidence: blockers.map((blocker) => blocker.reason),
    blockers,
  };
}

export function assertArchetypeReadinessClaimAllowed(
  request: ArchetypeReadinessClaimRequest,
): ArchetypeReadinessClaimResult {
  const result = evaluateArchetypeReadinessClaim(request);
  if (!result.allowed) {
    const scope = request.archetypeId ?? request.archetypeCategory ?? "unknown archetype";
    throw new Error(
      `Cannot claim ${request.requestedTier} for ${scope}: ${result.missingEvidence.join(" ")}`,
    );
  }
  return result;
}
