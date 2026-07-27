import { prisma } from "@dpf/db";
import {
  regulationApplies,
  parseApplicability,
  type RegionProfile,
  type RegulationApplicability,
} from "@dpf/db/regulation-applicability";

export type ComplianceApplicabilityScope = "applies" | "review" | "reference";
export type ComplianceLibraryScopeFilter = ComplianceApplicabilityScope | "all";

export const DEFAULT_COMPLIANCE_LIBRARY_SCOPE: ComplianceLibraryScopeFilter = "applies";
export const COMPLIANCE_LIBRARY_SCOPE_FILTERS: ComplianceLibraryScopeFilter[] = [
  "applies",
  "review",
  "reference",
  "all",
];

export type ComplianceApplicability = {
  scope: ComplianceApplicabilityScope;
  label: string;
  reason: string;
};

export type ComplianceLibraryContext = {
  archetype: {
    archetypeId: string | null;
    name: string | null;
    category: string | null;
  } | null;
  businessContext: {
    industry: string | null;
    stateCode: string | null;
    handlesCardPayments: boolean;
  };
  regional: RegionProfile;
  processingActivities?: {
    confirmedAuthorityRefs: string[];
  };
};

export type ClassifiableRegulation = {
  regulationId: string;
  name: string;
  shortName: string;
  jurisdiction: string;
  industry: string | null;
  sourceType: string;
  sourceUrl: string | null;
  /** Data-driven applicability spec (Regulation.applicability JSON), when set. */
  applicability?: unknown;
};

// Omit the raw applicability spec before adding the computed classification, so
// the output's `applicability` is unambiguously the ComplianceApplicability
// verdict (not an intersection with the stored JSON spec).
export type RegulationWithApplicability<T extends ClassifiableRegulation> = Omit<T, "applicability"> & {
  applicability: ComplianceApplicability;
};

export type ClassifiableObligation = {
  regulation: ClassifiableRegulation;
};

export type ObligationWithApplicability<T extends ClassifiableObligation> = Omit<T, "regulation"> & {
  regulation: RegulationWithApplicability<T["regulation"]>;
};

export type ComplianceLibraryClient = {
  storefrontConfig: {
    findFirst(args: {
      orderBy: { createdAt: "asc" };
      select: {
        archetype: {
          select: { archetypeId: true; name: true; category: true };
        };
      };
    }): Promise<{
      archetype: {
        archetypeId: string;
        name: string;
        category: string;
      } | null;
    } | null>;
  };
  businessContext: {
    findFirst(args: {
      orderBy: { createdAt: "asc" };
      select: {
        industry: true;
        stateCode: true;
        operatesIn: true;
        sellsTo: true;
        employsIn: true;
        dataResidency: true;
        handlesCardPayments: true;
        listingStatus: true;
      };
    }): Promise<{
      industry: string | null;
      stateCode: string | null;
      operatesIn: string[];
      sellsTo: string[];
      employsIn: string[];
      dataResidency: string[];
      handlesCardPayments: boolean;
      listingStatus: string | null;
    } | null>;
  };
  dataProcessingActivity?: {
    findMany(args: {
      where: { status: "confirmed" };
      select: { authorityRefs: true };
    }): Promise<Array<{ authorityRefs: unknown }>>;
  };
};

const SCOPE_LABEL: Record<ComplianceApplicabilityScope, string> = {
  applies: "Applies",
  review: "Needs review",
  reference: "Reference",
};

const INDUSTRY_LABEL: Record<string, string> = {
  financial: "banking or financial services",
  "public-sector": "public-sector",
  "public-safety": "law enforcement or public safety",
  cooperative: "cooperative",
};

function normalize(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function applicability(scope: ComplianceApplicabilityScope, reason: string): ComplianceApplicability {
  return { scope, label: SCOPE_LABEL[scope], reason };
}

function installedArchetypeLabel(context: ComplianceLibraryContext): string {
  return (
    context.archetype?.name ||
    context.archetype?.category ||
    context.businessContext.industry ||
    "the installed business"
  );
}

function sourceIndustryLabel(industry: string | null): string {
  return INDUSTRY_LABEL[normalize(industry)] ?? industry ?? "cross-sector";
}

function matchesRegulationIndustry(
  regulationIndustry: string,
  context: ComplianceLibraryContext,
): boolean {
  const industry = normalize(regulationIndustry);
  const category = normalize(context.archetype?.category);
  const archetypeId = normalize(context.archetype?.archetypeId);
  const businessIndustry = normalize(context.businessContext.industry);

  if ([category, archetypeId, businessIndustry].includes(industry)) return true;

  if (industry === "financial") {
    return (
      category === "banking-financial-services" ||
      category.includes("financial") ||
      archetypeId.includes("bank") ||
      archetypeId.includes("credit-union") ||
      businessIndustry.includes("financial")
    );
  }

  if (industry === "public-sector") {
    return (
      category === "public-sector" ||
      category.includes("public-sector") ||
      archetypeId.includes("municipal") ||
      archetypeId.includes("town") ||
      businessIndustry.includes("public-sector")
    );
  }

  if (industry === "public-safety") {
    return (
      category === "public-safety" ||
      archetypeId.includes("law-enforcement") ||
      archetypeId.includes("public-safety") ||
      businessIndustry.includes("public-safety")
    );
  }

  if (industry === "cooperative") {
    return (
      category === "cooperative" ||
      archetypeId.includes("cooperative") ||
      businessIndustry.includes("cooperative")
    );
  }

  return false;
}

function isStateLaw(regulation: ClassifiableRegulation): boolean {
  return normalize(regulation.jurisdiction) === "us-state";
}

/**
 * Generic, data-driven classification for any regulation carrying a persisted
 * applicability spec (Regulation.applicability). One evaluator + one tri-state
 * mapping replaces every per-regulation code branch:
 *   applies    — in scope
 *   review     — may apply, but a required signal (jurisdiction footprint,
 *                listing status, archetype) hasn't been captured yet
 *   reference  — declared out of scope
 * Adding a governance requirement is now a data operation, not a code change.
 */
function classifyByApplicability(
  regulation: ClassifiableRegulation,
  spec: RegulationApplicability,
  context: ComplianceLibraryContext,
): ComplianceApplicability {
  const label = regulation.shortName || regulation.name;
  const result = regulationApplies(spec, context.regional);
  if (result.applies) {
    return applicability("applies", `${label} applies: ${result.reason}.`);
  }
  if (result.undeclared) {
    return applicability(
      "review",
      `${label} may apply, but a required detail hasn't been captured yet — ${result.reason}.`,
    );
  }
  return applicability("reference", `${label} is out of scope for this install: ${result.reason}.`);
}

export function classifyRegulationForInstall(
  regulation: ClassifiableRegulation,
  context: ComplianceLibraryContext,
): ComplianceApplicability {
  // Data-driven path: any regulation carrying an applicability spec is classified
  // generically, with no per-regulation code.
  const spec = parseApplicability(regulation.applicability);
  if (spec) {
    return classifyByApplicability(regulation, spec, context);
  }

  // Compatibility path for records that predate data-driven applicability.
  // Industry/archetype strings may identify a review candidate, but only a
  // confirmed processing activity may promote that candidate to "applies".
  const currentLabel = installedArchetypeLabel(context);
  const regIndustry = normalize(regulation.industry);
  if (!regIndustry) {
    return applicability(
      "review",
      "This record is not tied to an industry or archetype, so it needs operator review.",
    );
  }

  if (matchesRegulationIndustry(regIndustry, context)) {
    if (isStateLaw(regulation) && !context.businessContext.stateCode) {
      return applicability(
        "review",
        `Matches ${currentLabel}, but the applicable state has not been captured for state-specific validation.`,
      );
    }
    const confirmedAuthorityRefs =
      context.processingActivities?.confirmedAuthorityRefs ?? [];
    if (confirmedAuthorityRefs.includes(regulation.regulationId)) {
      return applicability(
        "applies",
        `A confirmed processing activity links ${regulation.shortName || regulation.name} to this organization.`,
      );
    }
    return applicability(
      "review",
      `The ${sourceIndustryLabel(regulation.industry)} compliance pack matches ${currentLabel}, but no confirmed processing activity links this authority yet.`,
    );
  }

  return applicability(
    "reference",
    `Seeded for ${sourceIndustryLabel(regulation.industry)}; installed archetype is ${currentLabel}.`,
  );
}

export function addRegulationApplicability<T extends ClassifiableRegulation>(
  regulation: T,
  context: ComplianceLibraryContext,
): RegulationWithApplicability<T> {
  return {
    ...regulation,
    applicability: classifyRegulationForInstall(regulation, context),
  };
}

export function addObligationApplicability<T extends ClassifiableObligation>(
  obligation: T,
  context: ComplianceLibraryContext,
): ObligationWithApplicability<T> {
  return {
    ...obligation,
    regulation: addRegulationApplicability(obligation.regulation, context),
  };
}

export function parseComplianceLibraryScope(
  value: string | null | undefined,
): ComplianceLibraryScopeFilter {
  return COMPLIANCE_LIBRARY_SCOPE_FILTERS.includes(value as ComplianceLibraryScopeFilter)
    ? (value as ComplianceLibraryScopeFilter)
    : DEFAULT_COMPLIANCE_LIBRARY_SCOPE;
}

export function filterByComplianceLibraryScope<T extends { applicability: ComplianceApplicability }>(
  rows: T[],
  scope: ComplianceLibraryScopeFilter,
): T[] {
  if (scope === "all") return rows;
  return rows.filter((row) => row.applicability.scope === scope);
}

export function countByComplianceLibraryScope<T extends { applicability: ComplianceApplicability }>(
  rows: T[],
): Record<ComplianceLibraryScopeFilter, number> {
  return {
    applies: rows.filter((row) => row.applicability.scope === "applies").length,
    review: rows.filter((row) => row.applicability.scope === "review").length,
    reference: rows.filter((row) => row.applicability.scope === "reference").length,
    all: rows.length,
  };
}

export function filterObligationsByComplianceLibraryScope<
  T extends { regulation: { applicability: ComplianceApplicability } },
>(rows: T[], scope: ComplianceLibraryScopeFilter): T[] {
  if (scope === "all") return rows;
  return rows.filter((row) => row.regulation.applicability.scope === scope);
}

export function countObligationsByComplianceLibraryScope<
  T extends { regulation: { applicability: ComplianceApplicability } },
>(rows: T[]): Record<ComplianceLibraryScopeFilter, number> {
  return {
    applies: rows.filter((row) => row.regulation.applicability.scope === "applies").length,
    review: rows.filter((row) => row.regulation.applicability.scope === "review").length,
    reference: rows.filter((row) => row.regulation.applicability.scope === "reference").length,
    all: rows.length,
  };
}

export function complianceLibraryContextLabel(context: ComplianceLibraryContext): string {
  const label = installedArchetypeLabel(context);
  const category = context.archetype?.category;
  return category && label !== category ? `${label} (${category})` : label;
}

export type ApplicableRegulationRow = ClassifiableRegulation & { id: string };

/** Pure core: the DB ids (Regulation.id) of regulations classified "applies" for this install. */
export function applicableRegulationDbIds(
  regulations: ApplicableRegulationRow[],
  context: ComplianceLibraryContext,
): string[] {
  return regulations
    .filter((reg) => classifyRegulationForInstall(reg, context).scope === "applies")
    .map((reg) => reg.id);
}

export type ApplicableRegulationClient = ComplianceLibraryClient & {
  regulation: {
    findMany(args: {
      where: { status: "active" };
      select: {
        id: true;
        regulationId: true;
        name: true;
        shortName: true;
        jurisdiction: true;
        industry: true;
        sourceType: true;
        sourceUrl: true;
        applicability: true;
      };
    }): Promise<(ApplicableRegulationRow & { applicability: unknown })[]>;
  };
};

/**
 * DB ids of the regulations that currently APPLY to this install — the same
 * classification the compliance library pages use (data-driven applicability
 * spec when present, legacy industry heuristics otherwise), resolved from the
 * setup-chosen archetype + business context. Non-library surfaces that
 * aggregate obligations (dashboard counts, workspace command center, workforce
 * calendar, gap assessment) filter on this so wholesale-seeded packs outside
 * the installed archetype don't surface as obligation noise.
 */
export async function resolveApplicableRegulationDbIds(
  db: ApplicableRegulationClient = prisma,
): Promise<string[]> {
  const [context, regulations] = await Promise.all([
    resolveComplianceLibraryContext(db),
    db.regulation.findMany({
      where: { status: "active" },
      select: {
        id: true,
        regulationId: true,
        name: true,
        shortName: true,
        jurisdiction: true,
        industry: true,
        sourceType: true,
        sourceUrl: true,
        applicability: true,
      },
    }),
  ]);
  return applicableRegulationDbIds(regulations, context);
}

export async function resolveComplianceLibraryContext(
  db: ComplianceLibraryClient = prisma,
): Promise<ComplianceLibraryContext> {
  const [storefront, businessContext, activities] = await Promise.all([
    db.storefrontConfig.findFirst({
      orderBy: { createdAt: "asc" },
      select: { archetype: { select: { archetypeId: true, name: true, category: true } } },
    }),
    db.businessContext.findFirst({
      orderBy: { createdAt: "asc" },
      select: {
        industry: true,
        stateCode: true,
        operatesIn: true,
        sellsTo: true,
        employsIn: true,
        dataResidency: true,
        handlesCardPayments: true,
        listingStatus: true,
      },
    }),
    db.dataProcessingActivity?.findMany({
      where: { status: "confirmed" },
      select: { authorityRefs: true },
    }) ?? Promise.resolve([]),
  ]);

  const confirmedAuthorityRefs = [
    ...new Set(
      activities.flatMap((activity) =>
        Array.isArray(activity.authorityRefs)
          ? activity.authorityRefs.filter((value): value is string => typeof value === "string")
          : [],
      ),
    ),
  ].sort();

  return {
    archetype: storefront?.archetype ?? null,
    businessContext: {
      industry: businessContext?.industry ?? null,
      stateCode: businessContext?.stateCode ?? null,
      handlesCardPayments: businessContext?.handlesCardPayments ?? false,
    },
    regional: {
      archetype: storefront?.archetype?.category ?? undefined,
      archetypeId: storefront?.archetype?.archetypeId ?? undefined,
      operatesIn: businessContext?.operatesIn ?? [],
      sellsTo: businessContext?.sellsTo ?? [],
      employsIn: businessContext?.employsIn ?? [],
      dataResidency: businessContext?.dataResidency ?? [],
      listingStatus: businessContext?.listingStatus ?? undefined,
    },
    processingActivities: { confirmedAuthorityRefs },
  };
}
