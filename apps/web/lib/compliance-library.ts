import { prisma } from "@dpf/db";
import {
  CADA_APPLICABILITY,
  UK_CORP_GOV_CODE_APPLICABILITY,
  regulationApplies,
  type RegionProfile,
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
};

export type ClassifiableRegulation = {
  regulationId: string;
  name: string;
  shortName: string;
  jurisdiction: string;
  industry: string | null;
  sourceType: string;
  sourceUrl: string | null;
};

export type RegulationWithApplicability<T extends ClassifiableRegulation> = T & {
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

function hasAnyRegionalDeclaration(profile: RegionProfile): boolean {
  return (
    profile.operatesIn.length > 0 ||
    profile.sellsTo.length > 0 ||
    profile.employsIn.length > 0 ||
    profile.dataResidency.length > 0
  );
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

function classifyCada(
  regulation: ClassifiableRegulation,
  context: ComplianceLibraryContext,
): ComplianceApplicability {
  const result = regulationApplies(CADA_APPLICABILITY, context.regional);
  if (result.applies) {
    return applicability("applies", `CADA is in scope because ${result.reason}.`);
  }
  if (!hasAnyRegionalDeclaration(context.regional)) {
    return applicability(
      "review",
      "CADA is regional, but no operating/selling/employment/data-residency footprint has been captured yet.",
    );
  }
  return applicability("reference", `CADA is out of scope for this install: ${result.reason}.`);
}

const LISTING_STATUS_LABEL: Record<string, string> = {
  "premium-listed": "premium-listed",
  "standard-listed": "standard-listed",
  "aim-listed": "AIM-listed",
  private: "private",
  other: "another",
};

/**
 * The UK Corporate Governance Code / Provision 29 is listing-gated, not
 * industry-gated: it binds UK premium-listed companies regardless of archetype.
 * So it needs a bespoke classifier (like CADA) rather than the industry-match
 * fallback. Applies only when there is a UK OPERATING nexus AND the org has
 * declared a premium listing; the intermediate "review" states cover the two
 * undeclared-signal cases so an operator is prompted rather than silently
 * excluded.
 */
function classifyUkCorpGov(context: ComplianceLibraryContext): ComplianceApplicability {
  const result = regulationApplies(UK_CORP_GOV_CODE_APPLICABILITY, context.regional);
  if (result.applies) {
    return applicability(
      "applies",
      "The UK Corporate Governance Code Provision 29 applies: a UK-operating premium-listed company.",
    );
  }
  const operatesInUk = context.regional.operatesIn.some((j) => j.toLowerCase() === "uk");
  if (context.regional.operatesIn.length === 0) {
    return applicability(
      "review",
      "Provision 29 binds UK premium-listed companies, but no operating footprint has been captured yet.",
    );
  }
  if (!operatesInUk) {
    return applicability(
      "reference",
      "Provision 29 is out of scope: the business does not operate in the UK.",
    );
  }
  // UK operating nexus present — the remaining gate is listing status.
  const listing = context.regional.listingStatus;
  if (!listing) {
    return applicability(
      "review",
      "The business operates in the UK, but its market-listing status hasn't been captured — Provision 29 applies only to premium-listed companies.",
    );
  }
  return applicability(
    "reference",
    `Provision 29 is out of scope: it binds UK premium-listed companies, and this is ${LISTING_STATUS_LABEL[listing] ?? "a non-premium-listed"} company.`,
  );
}

export function classifyRegulationForInstall(
  regulation: ClassifiableRegulation,
  context: ComplianceLibraryContext,
): ComplianceApplicability {
  if (regulation.regulationId === "REG-CADA-2026") {
    return classifyCada(regulation, context);
  }
  if (regulation.regulationId === "REG-UK-CORP-GOV-CODE") {
    return classifyUkCorpGov(context);
  }

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
    return applicability(
      "applies",
      `Matches the installed ${currentLabel} archetype through the ${sourceIndustryLabel(regulation.industry)} compliance pack.`,
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

export async function resolveComplianceLibraryContext(
  db: ComplianceLibraryClient = prisma,
): Promise<ComplianceLibraryContext> {
  const [storefront, businessContext] = await Promise.all([
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
  ]);

  return {
    archetype: storefront?.archetype ?? null,
    businessContext: {
      industry: businessContext?.industry ?? null,
      stateCode: businessContext?.stateCode ?? null,
      handlesCardPayments: businessContext?.handlesCardPayments ?? false,
    },
    regional: {
      archetype: storefront?.archetype?.category ?? undefined,
      operatesIn: businessContext?.operatesIn ?? [],
      sellsTo: businessContext?.sellsTo ?? [],
      employsIn: businessContext?.employsIn ?? [],
      dataResidency: businessContext?.dataResidency ?? [],
      listingStatus: businessContext?.listingStatus ?? undefined,
    },
  };
}
