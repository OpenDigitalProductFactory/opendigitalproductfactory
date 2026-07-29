import {
  collectProductLineSubtreeIds,
  type BusinessProductContextItem,
  type ConsumerEvidenceContextItem,
  type IntelligenceContextItem,
  type ProductOperatingScope,
} from "./product-operating-context";
import { normalizeProductIntelligenceScope } from "./product-intelligence-scope";
import {
  PRODUCT_OBJECTIVE_STATUSES,
  PRODUCT_OUTCOME_MEASURE_KINDS,
  type ProductObjectiveStatus,
  type ProductOutcomeMeasureKind,
} from "./outcomes";

export type QueryDelegate<T> = {
  findMany(args: unknown): Promise<T[]>;
};

export type OptionalQueryDelegate<T> = QueryDelegate<T> & {
  findFirst(args: unknown): Promise<T | null>;
};

export type OrganizationRow = { id: string; name: string; updatedAt: Date };
export type ProductLineRow = {
  id: string;
  name: string;
  parentId: string | null;
  updatedAt: Date;
};
export type ProductRow = {
  id: string;
  productId: string;
  productLineId: string;
  name: string;
  updatedAt: Date;
};
export type DigitalProductRow = {
  id: string;
  productId: string;
  name: string;
  updatedAt: Date;
};
export type OfferingRow = {
  id: string;
  productId: string;
  providerOrganizationId: string;
  name: string;
  status: string;
  updatedAt: Date;
  catalogItems: Array<{
    id: string;
    name: string;
    status: string;
    updatedAt: Date;
  }>;
  operationalServiceOffering: {
    digitalProduct: DigitalProductRow;
  } | null;
};
export type NumberLike = number | { toNumber(): number };
export type ProductSoldRow = {
  id: string;
  productId: string;
  status: string;
  quantity: NumberLike;
  totalAmount: NumberLike;
  currency: string;
  purchasedAt: Date;
  parties: Array<{
    id: string;
    role: string;
    observedAt: Date;
    displaySnapshot: unknown;
  }>;
  evidence: Array<{
    id: string;
    evidenceKind: string;
    observedAt: Date;
    evidenceSnapshot: unknown;
  }>;
  componentAllocations: Array<{
    componentCatalogItemId: string;
    allocatedAmount: NumberLike | null;
    allocationMode: string;
  }>;
};
export type ResearchProposalRow = {
  proposalId: string;
  digitalProductId: string | null;
  productLineId: string | null;
  businessProductId: string | null;
  topic: string;
  query: string;
  status: string;
  resultSummary: string | null;
  metadata: unknown;
  updatedAt: Date;
};
export type BattlecardRow = {
  battlecardId: string;
  digitalProductId: string | null;
  productLineId: string | null;
  businessProductId: string | null;
  competitorName: string;
  status: string;
  updatedAt: Date;
};
export type ScheduledAgentTaskRow = {
  taskId: string;
  title: string;
  productLineId: string | null;
  businessProductId: string | null;
  schedule: string;
  isActive: boolean;
  nextRunAt: Date | null;
  lastRunAt: Date | null;
  taskRunId: string | null;
  lastStatus: string | null;
  lastError: string | null;
  taskKind: string | null;
  taskConfig: unknown;
  updatedAt: Date;
};
export type KnowledgeArticleRow = {
  articleId: string;
  title: string;
  status: string;
  updatedAt: Date;
  products: Array<{ digitalProductId: string }>;
};
export type ReviewedResearchSourceRow = {
  sourceKey: string;
  locator: unknown;
  retrievedAt: Date | null;
  pageSources: Array<{
    page: {
      id: string;
      title: string;
      abstract: string | null;
      status: string;
      lastReviewedAt: Date | null;
      updatedAt: Date;
    };
  }>;
};
export type BacklogRow = {
  itemId: string;
  title: string;
  body: string | null;
  status: string;
  workType: string | null;
  organizationId: string | null;
  productLineId: string | null;
  businessProductId: string | null;
  digitalProductId: string | null;
  demandStage: string | null;
  demandScore: number | null;
  demandScoreFramework: string | null;
  effortSize: string | null;
  jobSize: number | null;
  reach: number | null;
  occurrenceCount: number | null;
  impact: number | null;
  confidence: number | null;
  businessValue: number | null;
  timeCriticality: number | null;
  riskOpportunity: number | null;
  investmentBucket: string | null;
  estimateAiJobSize: number | null;
  estimateHumanJobSize: number | null;
  estimateSource: string | null;
  estimateAgreed: boolean | null;
  claimStatus: string | null;
  claimedByAgentId: string | null;
  activeBuild?: {
    buildId: string;
    phase: string;
    updatedAt: Date;
    productVersions?: Array<{
      id: string;
      shippedAt: Date;
    }>;
  } | null;
  demandEvidenceLinks: Array<{
    evidenceLinkId: string;
    sourceKind: string;
    sourceRef: string;
    title: string;
    summary: string | null;
    confidence: number | null;
    reviewedAt: Date | null;
  }>;
  activities: Array<{
    kind: string;
    summary: string;
    recordedAt: Date;
    payload: unknown;
  }>;
  updatedAt: Date;
  epic: { epicId: string; title: string; status: string; updatedAt: Date } | null;
};
export type ChangeRow = {
  id: string;
  title: string;
  status: string;
  updatedAt: Date;
  changeRequest?: {
    id: string;
    plannedStartAt: Date | null;
    plannedEndAt: Date | null;
  };
};
export type EaElementRow = {
  id: string;
  name: string;
  lifecycleStatus: string | null;
  updatedAt: Date;
};
export type DependencyRow = {
  id: string;
  relationType: string;
  createdAt: Date;
  fromProduct: { id?: string; name: string };
  toProduct: { id?: string; name: string };
};
export type ProductObjectiveRow = {
  objectiveId: string;
  productId: string;
  title: string;
  problemStatement: string | null;
  outcomeHypothesis: string;
  status: string;
  measureKind: string;
  measureDefinition: string;
  measureUnit: string | null;
  baselineValue: NumberLike | null;
  targetValue: NumberLike | null;
  baselineNarrative: string | null;
  targetNarrative: string | null;
  reviewCadence: string | null;
  reviewAt: Date | null;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  ownerPrincipal: {
    principalId: string;
    displayName: string;
  } | null;
  contributingWork: Array<{
    contributionKind: string;
    backlogItem: {
      itemId: string;
      title: string;
      status: string;
    };
  }>;
  observations: Array<{
    observationId: string;
    observedAt: Date;
    numericValue: NumberLike | null;
    narrative: string | null;
    measureKind: string;
    measureUnit: string | null;
    sourceKind: string;
    sourceRef: string | null;
    confidence: number | null;
    supersedes: { observationId: string } | null;
    supersededBy: { observationId: string } | null;
    createdAt: Date;
    recordedByPrincipal: {
      principalId: string;
      displayName: string;
    } | null;
  }>;
};

export type ProductOperatingContextQueryClient = {
  organization: {
    findFirst(args: unknown): Promise<OrganizationRow | null>;
  };
  productLine: OptionalQueryDelegate<ProductLineRow>;
  product: OptionalQueryDelegate<ProductRow>;
  productOffering: QueryDelegate<OfferingRow>;
  productSold: QueryDelegate<ProductSoldRow>;
  researchProposal: QueryDelegate<ResearchProposalRow>;
  marketingBattlecard: QueryDelegate<BattlecardRow>;
  knowledgeArticle: QueryDelegate<KnowledgeArticleRow>;
  rawSource: QueryDelegate<ReviewedResearchSourceRow>;
  backlogItem: QueryDelegate<BacklogRow>;
  changeItem: QueryDelegate<ChangeRow>;
  eaElement: QueryDelegate<EaElementRow>;
  productDependency: QueryDelegate<DependencyRow>;
  scheduledAgentTask: QueryDelegate<ScheduledAgentTaskRow>;
  productObjective?: QueryDelegate<ProductObjectiveRow>;
};

export function canonicalObjectiveStatus(value: string): ProductObjectiveStatus {
  return PRODUCT_OBJECTIVE_STATUSES.includes(
    value as ProductObjectiveStatus,
  )
    ? (value as ProductObjectiveStatus)
    : "draft";
}

export function canonicalMeasureKind(value: string): ProductOutcomeMeasureKind {
  return PRODUCT_OUTCOME_MEASURE_KINDS.includes(
    value as ProductOutcomeMeasureKind,
  )
    ? (value as ProductOutcomeMeasureKind)
    : "qualitative";
}

export class ProductOperatingContextNotFoundError extends Error {
  constructor(scope: ProductOperatingScope) {
    super(`No ${scope.kind} ${scope.id} exists in the authorized organization`);
    this.name = "ProductOperatingContextNotFoundError";
  }
}

export type ProductOperatingContextQueryProfile =
  | "full"
  | "commercial-summary";

export function numberOf(value: NumberLike | null): number {
  if (value == null) return 0;
  return typeof value === "number" ? value : value.toNumber();
}

export function optionalNumberOf(value: NumberLike | null): number | null {
  if (value == null) return null;
  return typeof value === "number" ? value : value.toNumber();
}

export function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function stringOf(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function dateOf(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function researchEvidenceOf(metadata: unknown): {
  confidence: "low" | "medium" | "high" | null;
  comparisonKind: "first-run" | "changed-since" | null;
  emptyReason:
    | "no-results"
    | "provider-unavailable"
    | "synthesis-empty"
    | null;
  retrievedAt: Date | null;
  sourceUrls: string[];
} {
  const evidence = recordOf(recordOf(metadata)["evidence"]);
  const confidence =
    evidence["confidence"] === "low" ||
    evidence["confidence"] === "medium" ||
    evidence["confidence"] === "high"
      ? evidence["confidence"]
      : null;
  const comparisonKind =
    evidence["comparisonKind"] === "first-run" ||
    evidence["comparisonKind"] === "changed-since"
      ? evidence["comparisonKind"]
      : null;
  const emptyReason =
    evidence["emptyReason"] === "no-results" ||
    evidence["emptyReason"] === "provider-unavailable" ||
    evidence["emptyReason"] === "synthesis-empty"
      ? evidence["emptyReason"]
      : null;
  const sourceUrls = Array.isArray(evidence["sourceUrls"])
    ? evidence["sourceUrls"].filter(
        (url): url is string => typeof url === "string" && url.length > 0,
      )
    : [];
  return {
    confidence,
    comparisonKind,
    emptyReason,
    retrievedAt: dateOf(evidence["retrievedAt"]),
    sourceUrls,
  };
}

export function researchLocatorEvidenceOf(locatorValue: unknown): {
  confidence: "low" | "medium" | "high" | null;
  comparisonKind: "first-run" | "changed-since" | null;
  sourceUrls: string[];
} {
  const locator = recordOf(locatorValue);
  const confidence =
    locator["confidence"] === "low" ||
    locator["confidence"] === "medium" ||
    locator["confidence"] === "high"
      ? locator["confidence"]
      : null;
  const comparisonKind =
    locator["comparisonKind"] === "first-run" ||
    locator["comparisonKind"] === "changed-since"
      ? locator["comparisonKind"]
      : null;
  const sourceUrls = Array.isArray(locator["urls"])
    ? locator["urls"].filter(
        (url): url is string => typeof url === "string" && url.trim().length > 0,
      )
    : [];
  return { confidence, comparisonKind, sourceUrls };
}

export function reviewedResearchScopeOf(
  locatorValue: unknown,
  organizationId: string,
) {
  const locator = recordOf(locatorValue);
  if (stringOf(locator["sourceType"]) !== "research") return null;
  try {
    return normalizeProductIntelligenceScope({
      organizationId,
      productLineId: stringOf(locator["productLineId"]),
      businessProductId: stringOf(locator["businessProductId"]),
      digitalProductId: stringOf(locator["digitalProductId"]),
    });
  } catch {
    return null;
  }
}

export function scopeIsVisible(
  scope: ReturnType<typeof normalizeProductIntelligenceScope>,
  visible: {
    productLineIds: string[];
    productIds: string[];
    digitalProductIds: string[];
  },
): boolean {
  if (scope.kind === "organization") return true;
  if (scope.kind === "product-line") {
    return visible.productLineIds.includes(scope.productLineId!);
  }
  if (scope.kind === "business-product") {
    return visible.productIds.includes(scope.businessProductId!);
  }
  return visible.digitalProductIds.includes(scope.digitalProductId!);
}

export function dedupeIntelligenceItems(
  items: IntelligenceContextItem[],
): IntelligenceContextItem[] {
  const byCanonicalSource = new Map<string, IntelligenceContextItem>();
  for (const item of items) {
    const key = `${item.sourceKind}:${item.id}`;
    const existing = byCanonicalSource.get(key);
    if (!existing) {
      byCanonicalSource.set(key, item);
      continue;
    }
    byCanonicalSource.set(key, {
      ...existing,
      asOf:
        existing.asOf.getTime() >= item.asOf.getTime()
          ? existing.asOf
          : item.asOf,
      retrievedAt:
        !existing.retrievedAt ||
        (item.retrievedAt &&
          item.retrievedAt.getTime() > existing.retrievedAt.getTime())
          ? item.retrievedAt
          : existing.retrievedAt,
      sourceUrls: Array.from(
        new Set([...(existing.sourceUrls ?? []), ...(item.sourceUrls ?? [])]),
      ).sort(),
    });
  }
  return [...byCanonicalSource.values()];
}

export function intelligenceScopeOf(row: {
  productLineId: string | null;
  businessProductId: string | null;
  digitalProductId: string | null;
}, organizationId: string) {
  return normalizeProductIntelligenceScope({
    organizationId,
    productLineId: row.productLineId,
    businessProductId: row.businessProductId,
    digitalProductId: row.digitalProductId,
  }).kind;
}

export function productSoldConsumers(row: ProductSoldRow): ConsumerEvidenceContextItem[] {
  const fromParties = row.parties.flatMap((party) => {
    if (
      party.role !== "account" &&
      party.role !== "consumer" &&
      party.role !== "subscriber"
    ) {
      return [];
    }
    const snapshot = recordOf(party.displaySnapshot);
    const label =
      stringOf(snapshot["name"]) ??
      stringOf(snapshot["email"]) ??
      stringOf(snapshot["accountId"]);
    if (!label) return [];
    return [
      {
        id: party.id,
        sourceKind: "product-sold-party",
        asOf: party.observedAt,
        role: party.role,
        label,
        canonicalLinkEstablished: true,
      } satisfies ConsumerEvidenceContextItem,
    ];
  });
  if (fromParties.length > 0) return fromParties;

  return row.evidence.flatMap((evidence) => {
    const snapshot = recordOf(evidence.evidenceSnapshot);
    const label =
      stringOf(snapshot["customerName"]) ??
      stringOf(snapshot["customerEmail"]);
    if (!label) return [];
    return [
      {
        id: evidence.id,
        sourceKind: evidence.evidenceKind,
        asOf: evidence.observedAt,
        role: "consumer",
        label,
        canonicalLinkEstablished: false,
      } satisfies ConsumerEvidenceContextItem,
    ];
  });
}

export async function resolveBusinessScope(input: {
  db: ProductOperatingContextQueryClient;
  organizationId: string;
  scope: ProductOperatingScope;
}) {
  const [organization, productLines] = await Promise.all([
    input.db.organization.findFirst({
      where: { id: input.organizationId },
      select: { id: true, name: true, updatedAt: true },
    }),
    input.db.productLine.findMany({
      where: { organizationId: input.organizationId, effectiveTo: null },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      take: 100,
      select: {
        id: true,
        name: true,
        parentId: true,
        updatedAt: true,
      },
    }),
  ]);
  if (!organization) throw new ProductOperatingContextNotFoundError(input.scope);

  let products: ProductRow[];
  let selectedProductLine: ProductLineRow | null = null;
  if (input.scope.kind === "product") {
    const product = await input.db.product.findFirst({
      where: { id: input.scope.id, organizationId: input.organizationId },
      select: {
        id: true,
        productId: true,
        productLineId: true,
        name: true,
        updatedAt: true,
      },
    });
    if (!product) throw new ProductOperatingContextNotFoundError(input.scope);
    products = [product];
    selectedProductLine =
      productLines.find((line) => line.id === product.productLineId) ?? null;
    if (!selectedProductLine) {
      selectedProductLine = await input.db.productLine.findFirst({
        where: {
          id: product.productLineId,
          organizationId: input.organizationId,
        },
        select: {
          id: true,
          name: true,
          parentId: true,
          updatedAt: true,
        },
      });
    }
  } else if (input.scope.kind === "product-line") {
    selectedProductLine = await input.db.productLine.findFirst({
      where: { id: input.scope.id, organizationId: input.organizationId },
      select: {
        id: true,
        name: true,
        parentId: true,
        updatedAt: true,
      },
    });
    if (!selectedProductLine) {
      throw new ProductOperatingContextNotFoundError(input.scope);
    }
    products = await input.db.product.findMany({
      where: {
        organizationId: input.organizationId,
        productLineId: {
          in: collectProductLineSubtreeIds(productLines, input.scope.id),
        },
        effectiveTo: null,
      },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      take: 100,
      select: {
        id: true,
        productId: true,
        productLineId: true,
        name: true,
        updatedAt: true,
      },
    });
  } else {
    products = await input.db.product.findMany({
      where: { organizationId: input.organizationId, effectiveTo: null },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      take: 250,
      select: {
        id: true,
        productId: true,
        productLineId: true,
        name: true,
        updatedAt: true,
      },
    });
  }
  return { organization, productLines, selectedProductLine, products };
}

export function productScopeRows(rows: ProductRow[]): BusinessProductContextItem[] {
  return rows.map((product) => ({
    id: product.id,
    productId: product.productId,
    productLineId: product.productLineId,
    name: product.name,
    sourceKind: "product",
    asOf: product.updatedAt,
  }));
}

export function collectEnablingDigitalProducts(
  offerings: OfferingRow[],
): DigitalProductRow[] {
  const products = new Map<string, DigitalProductRow>();
  for (const offering of offerings) {
    const product = offering.operationalServiceOffering?.digitalProduct ?? null;
    if (product) products.set(product.id, product);
  }
  return [...products.values()];
}

export async function loadCommercialOperatingRows(input: {
  db: ProductOperatingContextQueryClient;
  organizationId: string;
  productIds: string[];
  fullProfile: boolean;
}): Promise<{ offerings: OfferingRow[]; soldRows: ProductSoldRow[] }> {
  const [offerings, soldRows] = await Promise.all([
    input.fullProfile
      ? input.db.productOffering.findMany({
          where: {
            organizationId: input.organizationId,
            productId: { in: input.productIds },
          },
          orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
          take: 100,
          select: {
            id: true,
            productId: true,
            providerOrganizationId: true,
            name: true,
            status: true,
            updatedAt: true,
            catalogItems: {
              orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
              take: 100,
              select: {
                id: true,
                name: true,
                status: true,
                updatedAt: true,
              },
            },
            operationalServiceOffering: {
              select: {
                digitalProduct: {
                  select: {
                    id: true,
                    productId: true,
                    name: true,
                    updatedAt: true,
                  },
                },
              },
            },
          },
        })
      : Promise.resolve([]),
    input.db.productSold.findMany({
      where: {
        organizationId: input.organizationId,
        productId: { in: input.productIds },
      },
      orderBy: [{ purchasedAt: "desc" }, { id: "asc" }],
      take: 250,
      select: {
        id: true,
        productId: true,
        status: true,
        quantity: true,
        totalAmount: true,
        currency: true,
        purchasedAt: true,
        parties: {
          orderBy: [{ observedAt: "desc" }, { id: "asc" }],
          select: {
            id: true,
            role: true,
            observedAt: true,
            displaySnapshot: true,
          },
        },
        evidence: {
          orderBy: [{ observedAt: "desc" }, { id: "asc" }],
          select: {
            id: true,
            evidenceKind: true,
            observedAt: true,
            evidenceSnapshot: true,
          },
        },
        componentAllocations: {
          orderBy: { componentCatalogItemId: "asc" },
          select: {
            componentCatalogItemId: true,
            allocatedAmount: true,
            allocationMode: true,
          },
        },
      },
    }),
  ]);
  return { offerings, soldRows };
}
