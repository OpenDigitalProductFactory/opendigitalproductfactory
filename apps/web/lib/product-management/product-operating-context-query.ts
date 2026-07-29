import { prisma } from "@dpf/db";
import {
  assembleProductOperatingContext,
  collectProductLineSubtreeIds,
  createContextSlice,
  type BusinessProductContextItem,
  type ConsumerEvidenceContextItem,
  type EnablingDigitalProductContextItem,
  type IntelligenceContextItem,
  type ProductOperatingContext,
  type ProductOperatingScope,
  type ProductSoldContextItem,
  type ScheduledPlaybookContextItem,
} from "./product-operating-context";
import {
  buildProductIntelligenceProjectionWhere,
  buildScheduledProductIntelligenceVisibilityWhere,
  normalizeProductIntelligenceScope,
} from "./product-intelligence-scope";
import { SCHEDULED_AGENT_TASK_KINDS } from "@/lib/operate/scheduled-jobs/agent-task-kind";
import { buildProductManagementProjectionWhere } from "./product-management-scope";
import { mapDemandRows } from "@/lib/demand/demand-data";
import {
  PRODUCT_OBJECTIVE_STATUSES,
  PRODUCT_OUTCOME_MEASURE_KINDS,
  projectProductObjective,
  type ProductObjectiveStatus,
  type ProductOutcomeMeasureKind,
} from "./outcomes";

type QueryDelegate<T> = {
  findMany(args: unknown): Promise<T[]>;
};

type OptionalQueryDelegate<T> = QueryDelegate<T> & {
  findFirst(args: unknown): Promise<T | null>;
};

type OrganizationRow = { id: string; name: string; updatedAt: Date };
type ProductLineRow = {
  id: string;
  name: string;
  parentId: string | null;
  updatedAt: Date;
};
type ProductRow = {
  id: string;
  productId: string;
  productLineId: string;
  name: string;
  updatedAt: Date;
};
type DigitalProductRow = {
  id: string;
  productId: string;
  name: string;
  updatedAt: Date;
};
type OfferingRow = {
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
type NumberLike = number | { toNumber(): number };
type ProductSoldRow = {
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
type ResearchProposalRow = {
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
type BattlecardRow = {
  battlecardId: string;
  digitalProductId: string | null;
  productLineId: string | null;
  businessProductId: string | null;
  competitorName: string;
  status: string;
  updatedAt: Date;
};
type ScheduledAgentTaskRow = {
  taskId: string;
  title: string;
  productLineId: string | null;
  businessProductId: string | null;
  schedule: string;
  isActive: boolean;
  nextRunAt: Date | null;
  lastRunAt: Date | null;
  lastStatus: string | null;
  updatedAt: Date;
};
type KnowledgeArticleRow = {
  articleId: string;
  title: string;
  status: string;
  updatedAt: Date;
  products: Array<{ digitalProductId: string }>;
};
type ReviewedResearchSourceRow = {
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
type BacklogRow = {
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
type ChangeRow = {
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
type EaElementRow = {
  id: string;
  name: string;
  lifecycleStatus: string | null;
  updatedAt: Date;
};
type DependencyRow = {
  id: string;
  relationType: string;
  createdAt: Date;
  fromProduct: { id?: string; name: string };
  toProduct: { id?: string; name: string };
};
type ProductObjectiveRow = {
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

function canonicalObjectiveStatus(value: string): ProductObjectiveStatus {
  return PRODUCT_OBJECTIVE_STATUSES.includes(
    value as ProductObjectiveStatus,
  )
    ? (value as ProductObjectiveStatus)
    : "draft";
}

function canonicalMeasureKind(value: string): ProductOutcomeMeasureKind {
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

function numberOf(value: NumberLike | null): number {
  if (value == null) return 0;
  return typeof value === "number" ? value : value.toNumber();
}

function optionalNumberOf(value: NumberLike | null): number | null {
  if (value == null) return null;
  return typeof value === "number" ? value : value.toNumber();
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringOf(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function dateOf(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function researchEvidenceOf(metadata: unknown): {
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

function researchLocatorEvidenceOf(locatorValue: unknown): {
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

function reviewedResearchScopeOf(
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

function scopeIsVisible(
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

function dedupeIntelligenceItems(
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

function intelligenceScopeOf(row: {
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

function productSoldConsumers(row: ProductSoldRow): ConsumerEvidenceContextItem[] {
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

async function resolveBusinessScope(input: {
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

function productScopeRows(rows: ProductRow[]): BusinessProductContextItem[] {
  return rows.map((product) => ({
    id: product.id,
    productId: product.productId,
    productLineId: product.productLineId,
    name: product.name,
    sourceKind: "product",
    asOf: product.updatedAt,
  }));
}

export async function loadProductOperatingContext(input: {
  db?: ProductOperatingContextQueryClient;
  organizationId: string;
  scope: ProductOperatingScope;
  authorize: (scope: { organizationId: string }) => Promise<void>;
  requestedAt?: Date;
  profile?: ProductOperatingContextQueryProfile;
}): Promise<ProductOperatingContext> {
  const db =
    input.db ??
    (prisma as unknown as ProductOperatingContextQueryClient);
  const requestedAt = input.requestedAt ?? new Date();
  const fullProfile = (input.profile ?? "full") === "full";

  // Authorization is deliberately resolved once at the boundary. Every query
  // still carries the organization predicate as defense in depth.
  await input.authorize({ organizationId: input.organizationId });
  const identity = await resolveBusinessScope({
    db,
    organizationId: input.organizationId,
    scope: input.scope,
  });
  const productIds = identity.products.map((product) => product.id);

  const [offerings, soldRows] = await Promise.all([
    fullProfile
      ? db.productOffering.findMany({
          where: {
            organizationId: input.organizationId,
            productId: { in: productIds },
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
    db.productSold.findMany({
      where: {
        organizationId: input.organizationId,
        productId: { in: productIds },
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

  const enablingById = new Map<string, DigitalProductRow>();
  for (const offering of offerings) {
    const digitalProduct =
      offering.operationalServiceOffering?.digitalProduct ?? null;
    if (digitalProduct) enablingById.set(digitalProduct.id, digitalProduct);
  }
  const enablingDigitalProducts = [...enablingById.values()];
  const digitalProductIds = enablingDigitalProducts.map((product) => product.id);
  const productLineIds =
    input.scope.kind === "organization"
      ? identity.productLines.map((line) => line.id)
      : input.scope.kind === "product-line"
        ? collectProductLineSubtreeIds(
            identity.productLines,
            identity.selectedProductLine?.id ?? input.scope.id,
          )
        : identity.selectedProductLine
          ? [identity.selectedProductLine.id]
          : [];
  const intelligenceWhere = buildProductIntelligenceProjectionWhere({
    organizationId: input.organizationId,
    productLineIds,
    businessProductIds: productIds,
    digitalProductIds,
  });
  const scheduledIntelligenceWhere =
    buildScheduledProductIntelligenceVisibilityWhere({
      organizationId: input.organizationId,
      productLineIds,
      businessProductIds: productIds,
    });
  const demandWhere = buildProductManagementProjectionWhere({
    organizationId: input.organizationId,
    productLineIds,
    businessProductIds: productIds,
    digitalProductIds,
  });

  const [
    research,
    battlecards,
    scheduledWatches,
    reviewedResearchSources,
    knowledge,
    demand,
    changes,
    elements,
    dependencies,
    objectives,
  ] = await Promise.all([
    fullProfile
      ? db.researchProposal.findMany({
          where: intelligenceWhere,
          orderBy: [{ updatedAt: "desc" }, { proposalId: "asc" }],
          take: 50,
          select: {
            proposalId: true,
            digitalProductId: true,
            productLineId: true,
            businessProductId: true,
            topic: true,
            query: true,
            status: true,
            resultSummary: true,
            metadata: true,
            updatedAt: true,
          },
        })
      : Promise.resolve([]),
    fullProfile
      ? db.marketingBattlecard.findMany({
          where: intelligenceWhere,
          orderBy: [{ updatedAt: "desc" }, { battlecardId: "asc" }],
          take: 50,
          select: {
            battlecardId: true,
            digitalProductId: true,
            productLineId: true,
            businessProductId: true,
            competitorName: true,
            status: true,
            updatedAt: true,
          },
        })
      : Promise.resolve([]),
    fullProfile
      ? db.scheduledAgentTask.findMany({
          where: {
            taskKind: SCHEDULED_AGENT_TASK_KINDS[0],
            ...scheduledIntelligenceWhere,
          },
          orderBy: [{ nextRunAt: "asc" }, { taskId: "asc" }],
          take: 50,
          select: {
            taskId: true,
            title: true,
            productLineId: true,
            businessProductId: true,
            schedule: true,
            isActive: true,
            nextRunAt: true,
            lastRunAt: true,
            lastStatus: true,
            updatedAt: true,
          },
        })
      : Promise.resolve([]),
    fullProfile
      ? db.rawSource.findMany({
          where: {
            organizationId: input.organizationId,
            sourceType: "research",
            pageSources: {
              some: {
                page: {
                  status: "published",
                  lastReviewedAt: { not: null },
                },
              },
            },
          },
          orderBy: [{ retrievedAt: "desc" }, { sourceKey: "asc" }],
          take: 100,
          select: {
            sourceKey: true,
            locator: true,
            retrievedAt: true,
            pageSources: {
              where: {
                page: {
                  status: "published",
                  lastReviewedAt: { not: null },
                },
              },
              select: {
                page: {
                  select: {
                    id: true,
                    title: true,
                    abstract: true,
                    status: true,
                    lastReviewedAt: true,
                    updatedAt: true,
                  },
                },
              },
            },
          },
        })
      : Promise.resolve([]),
    fullProfile && digitalProductIds.length > 0
      ? db.knowledgeArticle.findMany({
          where: {
            products: {
              some: { digitalProductId: { in: digitalProductIds } },
            },
          },
          orderBy: [{ updatedAt: "desc" }, { articleId: "asc" }],
          take: 50,
          select: {
            articleId: true,
            title: true,
            status: true,
            updatedAt: true,
            products: {
              where: { digitalProductId: { in: digitalProductIds } },
              select: { digitalProductId: true },
            },
          },
        })
      : Promise.resolve([]),
    fullProfile
      ? db.backlogItem.findMany({
          where: demandWhere,
          orderBy: [{ updatedAt: "desc" }, { itemId: "asc" }],
          take: 100,
          select: {
            itemId: true,
            title: true,
            body: true,
            status: true,
            workType: true,
            organizationId: true,
            productLineId: true,
            businessProductId: true,
            digitalProductId: true,
            demandStage: true,
            demandScore: true,
            demandScoreFramework: true,
            effortSize: true,
            jobSize: true,
            reach: true,
            occurrenceCount: true,
            impact: true,
            confidence: true,
            businessValue: true,
            timeCriticality: true,
            riskOpportunity: true,
            investmentBucket: true,
            estimateAiJobSize: true,
            estimateHumanJobSize: true,
            estimateSource: true,
            estimateAgreed: true,
            claimStatus: true,
            claimedByAgentId: true,
            activeBuild: {
              select: {
                buildId: true,
                phase: true,
                updatedAt: true,
                productVersions: {
                  orderBy: { shippedAt: "desc" },
                  take: 1,
                  select: {
                    id: true,
                    shippedAt: true,
                  },
                },
              },
            },
            demandEvidenceLinks: {
              where: { status: "active" },
              orderBy: { createdAt: "desc" },
              select: {
                evidenceLinkId: true,
                sourceKind: true,
                sourceRef: true,
                title: true,
                summary: true,
                confidence: true,
                reviewedAt: true,
              },
            },
            activities: {
              where: {
                kind: {
                  in: [
                    "demand_stage_transition",
                    "demand_scored",
                    "demand_funding_decision",
                    "demand_evidence_linked",
                    "demand_evidence_superseded",
                  ],
                },
              },
              orderBy: { recordedAt: "desc" },
              take: 20,
              select: {
                kind: true,
                summary: true,
                recordedAt: true,
                payload: true,
              },
            },
            updatedAt: true,
            epic: {
              select: {
                epicId: true,
                title: true,
                status: true,
                updatedAt: true,
              },
            },
          },
        })
      : Promise.resolve([]),
    fullProfile && digitalProductIds.length > 0
      ? db.changeItem.findMany({
          where: { digitalProductId: { in: digitalProductIds } },
          orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
          take: 50,
          select: {
            id: true,
            title: true,
            status: true,
            updatedAt: true,
            changeRequest: {
              select: {
                id: true,
                plannedStartAt: true,
                plannedEndAt: true,
              },
            },
          },
        })
      : Promise.resolve([]),
    fullProfile && digitalProductIds.length > 0
      ? db.eaElement.findMany({
          where: { digitalProductId: { in: digitalProductIds } },
          orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
          take: 100,
          select: {
            id: true,
            name: true,
            lifecycleStatus: true,
            updatedAt: true,
          },
        })
      : Promise.resolve([]),
    fullProfile && digitalProductIds.length > 0
      ? db.productDependency.findMany({
          where: {
            OR: [
              { fromProductId: { in: digitalProductIds } },
              { toProductId: { in: digitalProductIds } },
            ],
          },
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          take: 100,
          select: {
            id: true,
            relationType: true,
            createdAt: true,
            fromProduct: { select: { id: true, name: true } },
            toProduct: { select: { id: true, name: true } },
          },
        })
      : Promise.resolve([]),
    fullProfile && db.productObjective
      ? db.productObjective.findMany({
          where: {
            organizationId: input.organizationId,
            productId: { in: productIds },
          },
          orderBy: [
            { reviewAt: "asc" },
            { updatedAt: "desc" },
            { objectiveId: "asc" },
          ],
          take: 100,
          select: {
            objectiveId: true,
            productId: true,
            title: true,
            problemStatement: true,
            outcomeHypothesis: true,
            status: true,
            measureKind: true,
            measureDefinition: true,
            measureUnit: true,
            baselineValue: true,
            targetValue: true,
            baselineNarrative: true,
            targetNarrative: true,
            reviewCadence: true,
            reviewAt: true,
            reviewedAt: true,
            createdAt: true,
            updatedAt: true,
            ownerPrincipal: {
              select: {
                principalId: true,
                displayName: true,
              },
            },
            contributingWork: {
              orderBy: { createdAt: "asc" },
              select: {
                contributionKind: true,
                backlogItem: {
                  select: {
                    itemId: true,
                    title: true,
                    status: true,
                  },
                },
              },
            },
            observations: {
              orderBy: [
                { observedAt: "desc" },
                { createdAt: "desc" },
                { observationId: "asc" },
              ],
              select: {
                observationId: true,
                observedAt: true,
                numericValue: true,
                narrative: true,
                measureKind: true,
                measureUnit: true,
                sourceKind: true,
                sourceRef: true,
                confidence: true,
                createdAt: true,
                supersedes: { select: { observationId: true } },
                supersededBy: { select: { observationId: true } },
                recordedByPrincipal: {
                  select: {
                    principalId: true,
                    displayName: true,
                  },
                },
              },
            },
          },
        })
      : Promise.resolve([]),
  ]);

  const intelligenceItems: IntelligenceContextItem[] = [
    ...research.map((row) => {
      const evidence = researchEvidenceOf(row.metadata);
      return {
        id: row.proposalId,
        sourceKind: "research-proposal",
        asOf: row.updatedAt,
        title: row.topic,
        detail:
          row.status === "pending" ? row.query : row.resultSummary ?? row.query,
        scope: intelligenceScopeOf(row, input.organizationId),
        productLineId: row.productLineId,
        businessProductId: row.businessProductId,
        digitalProductId: row.digitalProductId,
        status: row.status,
        ...evidence,
      };
    }),
    ...battlecards.map((row) => ({
      id: row.battlecardId,
      sourceKind: "marketing-battlecard",
      asOf: row.updatedAt,
      title: row.competitorName,
      scope: intelligenceScopeOf(row, input.organizationId),
      productLineId: row.productLineId,
      businessProductId: row.businessProductId,
      digitalProductId: row.digitalProductId,
      status: row.status,
    })),
    ...reviewedResearchSources.flatMap((row) => {
      const scope = reviewedResearchScopeOf(row.locator, input.organizationId);
      if (
        !scope ||
        !scopeIsVisible(scope, {
          productLineIds,
          productIds,
          digitalProductIds,
        })
      ) {
        return [];
      }
      const evidence = researchLocatorEvidenceOf(row.locator);
      const relatedProposalId = stringOf(recordOf(row.locator)["proposalId"]);
      return row.pageSources.map(({ page }) => ({
        id: page.id,
        sourceKind: "wiki-page",
        asOf: page.lastReviewedAt ?? page.updatedAt,
        title: page.title,
        detail: page.abstract,
        relatedProposalId,
        scope: scope.kind,
        productLineId: scope.productLineId,
        businessProductId: scope.businessProductId,
        digitalProductId: scope.digitalProductId,
        status: page.status,
        retrievedAt: row.retrievedAt,
        ...evidence,
      }));
    }),
    ...knowledge.flatMap((row) =>
      row.products.map((link) => ({
        id: row.articleId,
        sourceKind: "knowledge-article",
        asOf: row.updatedAt,
        title: row.title,
        scope: "digital-product" as const,
        productLineId: null,
        businessProductId: null,
        digitalProductId: link.digitalProductId,
        status: row.status,
      })),
    ),
  ];

  const scheduledPlaybooks: ScheduledPlaybookContextItem[] =
    scheduledWatches.map((row) => ({
      id: row.taskId,
      taskId: row.taskId,
      sourceKind: "scheduled-agent-task",
      asOf: row.updatedAt,
      title: row.title,
      status: row.isActive ? "active" : "paused",
      scope: row.businessProductId
        ? ("business-product" as const)
        : row.productLineId
          ? ("product-line" as const)
          : ("organization" as const),
      productLineId: row.productLineId,
      businessProductId: row.businessProductId,
      schedule: row.schedule,
      isActive: row.isActive,
      nextRunAt: row.nextRunAt,
      lastRunAt: row.lastRunAt,
      lastStatus: row.lastStatus,
    }));

  const sold: ProductSoldContextItem[] = soldRows.map((row) => ({
    id: row.id,
    sourceKind: "product-sold",
    asOf: row.purchasedAt,
    productId: row.productId,
    status: row.status,
    quantity: numberOf(row.quantity),
    totalAmount: numberOf(row.totalAmount),
    currency: row.currency,
    consumerEvidence: productSoldConsumers(row),
    componentAllocations: row.componentAllocations.map((allocation) => ({
      catalogItemId: allocation.componentCatalogItemId,
      allocatedAmount:
        allocation.allocatedAmount === null
          ? null
          : numberOf(allocation.allocatedAmount),
      allocationMode: allocation.allocationMode,
    })),
  }));

  const roadmapById = new Map<
    string,
    { id: string; sourceKind: string; asOf: Date; title: string; status: string }
  >();
  for (const row of demand) {
    if (row.epic) {
      roadmapById.set(row.epic.epicId, {
        id: row.epic.epicId,
        sourceKind: "epic",
        asOf: row.epic.updatedAt,
        title: row.epic.title,
        status: row.epic.status,
      });
    }
  }
  const demandViews = new Map(
    mapDemandRows(demand).map((view) => [view.itemId, view]),
  );

  const architectureItems = [
    ...elements.map((row) => ({
      id: row.id,
      sourceKind: "ea-element",
      asOf: row.updatedAt,
      title: row.name,
      status: row.lifecycleStatus ?? "unknown",
      coordinationKind: "architecture" as const,
    })),
    ...dependencies.map((row) => ({
      id: row.id,
      sourceKind: "product-dependency",
      asOf: row.createdAt,
      title: `${row.fromProduct.name} ${row.relationType} ${row.toProduct.name}`,
      status: "active",
      coordinationKind: "architecture" as const,
      fromProductId: row.fromProduct.id ?? null,
      toProductId: row.toProduct.id ?? null,
      relationType: row.relationType,
    })),
  ];

  return assembleProductOperatingContext({
    requestedAt,
    scope: input.scope,
    organization: {
      id: identity.organization.id,
      sourceKind: "organization",
      asOf: identity.organization.updatedAt,
      name: identity.organization.name,
    },
    productLines: identity.productLines.map((line) => ({
      id: line.id,
      sourceKind: "product-line",
      asOf: line.updatedAt,
      name: line.name,
      parentId: line.parentId,
    })),
    productLine: identity.selectedProductLine
      ? {
          id: identity.selectedProductLine.id,
          sourceKind: "product-line",
          asOf: identity.selectedProductLine.updatedAt,
          name: identity.selectedProductLine.name,
          parentId: identity.selectedProductLine.parentId,
        }
      : null,
    products: productScopeRows(identity.products),
    enablingDigitalProducts: createContextSlice({
      requestedAt,
      sourceKind: "operational-service-offering",
      items: enablingDigitalProducts.map(
        (product): EnablingDigitalProductContextItem => ({
          id: product.id,
          sourceKind: "digital-product",
          asOf: product.updatedAt,
          productId: product.productId,
          name: product.name,
        }),
      ),
      unavailableReason:
        !fullProfile
          ? "Enabling digital products are outside the commercial-summary query profile."
          : productIds.length > 0 && enablingDigitalProducts.length === 0
          ? "No explicit operational offering links this business product scope to a DigitalProduct."
          : undefined,
    }),
    offerings: createContextSlice({
      requestedAt,
      sourceKind: "product-offering",
      items: offerings.map((offering) => ({
        id: offering.id,
        sourceKind: "product-offering",
        asOf: offering.updatedAt,
        productId: offering.productId,
        providerOrganizationId: offering.providerOrganizationId,
        name: offering.name,
        status: offering.status,
      })),
      unavailableReason: !fullProfile
        ? "Offerings are outside the commercial-summary query profile."
        : undefined,
    }),
    catalogItems: createContextSlice({
      requestedAt,
      sourceKind: "catalog-item",
      items: offerings.flatMap((offering) =>
        offering.catalogItems.map((catalogItem) => ({
          id: catalogItem.id,
          sourceKind: "catalog-item",
          asOf: catalogItem.updatedAt,
          productId: offering.productId,
          name: catalogItem.name,
          status: catalogItem.status,
        })),
      ),
      unavailableReason: !fullProfile
        ? "Catalog items are outside the commercial-summary query profile."
        : undefined,
    }),
    productSold: createContextSlice({
      requestedAt,
      sourceKind: "product-sold",
      items: sold,
      partialReason:
        sold.length >= 250
          ? "Product Sold evidence is bounded to the 250 newest records."
          : undefined,
    }),
    intelligence: createContextSlice({
      requestedAt,
      sourceKind: "research-battlecard-knowledge",
      items: dedupeIntelligenceItems(intelligenceItems),
      unavailableReason: !fullProfile
        ? "Intelligence is outside the commercial-summary query profile."
        : undefined,
    }),
    demand: createContextSlice({
      requestedAt,
      sourceKind: "backlog-item",
      items: demand.map((row) => ({
        ...(demandViews.get(row.itemId)?.activation
          ? {
              evidenceCount:
                demandViews.get(row.itemId)!.activation!.score.evidenceCount,
              readiness:
                demandViews.get(row.itemId)!.activation!.readiness,
              blockers:
                demandViews.get(row.itemId)!.activation!.blockers,
              latestDecision: demandViews.get(row.itemId)!.decisionHistory?.[0]
                ? {
                    summary:
                      demandViews.get(row.itemId)!.decisionHistory![0]!.summary,
                    recordedAt: new Date(
                      demandViews.get(row.itemId)!.decisionHistory![0]!.recordedAt,
                    ),
                    payload:
                      demandViews.get(row.itemId)!.decisionHistory![0]!.payload,
                  }
                : null,
            }
          : {}),
        id: row.itemId,
        sourceKind: "backlog-item",
        asOf: row.updatedAt,
        title: row.title,
        status: row.status,
        workType: row.workType,
        productLineId: row.productLineId,
        businessProductId: row.businessProductId,
        demandStage: row.demandStage,
        score: row.demandScore,
        effortSize: row.effortSize,
        investmentBucket: row.investmentBucket,
        lastEvidenceChange: row.activities[0]
          ? {
              kind: row.activities[0].kind,
              summary: row.activities[0].summary,
              recordedAt: row.activities[0].recordedAt,
            }
          : null,
        delivery: row.activeBuild
          ? {
              sourceId:
                row.activeBuild.productVersions?.[0]?.id ??
                row.activeBuild.buildId,
              phase: row.activeBuild.phase,
              asOf:
                row.activeBuild.productVersions?.[0]?.shippedAt ??
                row.activeBuild.updatedAt,
              shippedAt:
                row.activeBuild.productVersions?.[0]?.shippedAt ?? null,
            }
          : null,
      })),
      partialReason:
        demand.length >= 100
          ? "Demand evidence is bounded to the 100 newest records."
          : undefined,
      unavailableReason: !fullProfile
        ? "Demand is outside the commercial-summary query profile."
        : undefined,
    }),
    decisions: createContextSlice({
      requestedAt,
      sourceKind: "decision-interaction",
      items: [],
      unavailableReason:
        "No typed business-product decision association exists yet.",
    }),
    objectives: createContextSlice({
      requestedAt,
      sourceKind: "product-objective",
      items: objectives.map((objective) => {
        const measureKind = canonicalMeasureKind(objective.measureKind);
        const observations = objective.observations.map((observation) => ({
          observationId: observation.observationId,
          observedAt: observation.observedAt,
          numericValue: optionalNumberOf(observation.numericValue),
          narrative: observation.narrative,
          sourceKind: observation.sourceKind,
          sourceRef: observation.sourceRef,
          confidence: observation.confidence,
          recordedBy: observation.recordedByPrincipal,
          supersedesObservationId:
            observation.supersedes?.observationId ?? null,
          supersededByObservationId:
            observation.supersededBy?.observationId ?? null,
          createdAt: observation.createdAt,
        }));
        return {
          id: objective.objectiveId,
          sourceKind: "product-objective",
          asOf: objective.updatedAt,
          productId: objective.productId,
          ...projectProductObjective(
            {
              objectiveId: objective.objectiveId,
              title: objective.title,
              problemStatement: objective.problemStatement,
              outcomeHypothesis: objective.outcomeHypothesis,
              status: canonicalObjectiveStatus(objective.status),
              owner: objective.ownerPrincipal,
              measureKind,
              measureDefinition: objective.measureDefinition,
              measureUnit: objective.measureUnit,
              baselineValue: optionalNumberOf(objective.baselineValue),
              targetValue: optionalNumberOf(objective.targetValue),
              baselineNarrative: objective.baselineNarrative,
              targetNarrative: objective.targetNarrative,
              reviewCadence: objective.reviewCadence,
              reviewAt: objective.reviewAt,
              reviewedAt: objective.reviewedAt,
              createdAt: objective.createdAt,
              updatedAt: objective.updatedAt,
              observations,
              contributingWork: objective.contributingWork.map((work) => ({
                itemId: work.backlogItem.itemId,
                title: work.backlogItem.title,
                status: work.backlogItem.status,
                contributionKind: work.contributionKind,
              })),
              observationMeasures: objective.observations
                .filter((observation) => observation.supersededBy === null)
                .map((observation) => ({
                  numericValue: optionalNumberOf(observation.numericValue),
                  narrative: observation.narrative,
                  measureKind: canonicalMeasureKind(observation.measureKind),
                  measureUnit: observation.measureUnit,
                })),
            },
            requestedAt,
          ),
        };
      }),
      partialReason:
        objectives.length >= 100
          ? "Product objectives are bounded to the first 100 records in review order."
          : undefined,
      unavailableReason: !fullProfile
        ? "Objectives are outside the commercial-summary query profile."
        : db.productObjective
          ? undefined
          : "The product objective query delegate is unavailable.",
    }),
    roadmapInputs: createContextSlice({
      requestedAt,
      sourceKind: "epic",
      items: [...roadmapById.values()],
      unavailableReason: !fullProfile
        ? "Roadmap inputs are outside the commercial-summary query profile."
        : undefined,
    }),
    deliveryChanges: createContextSlice({
      requestedAt,
      sourceKind: "change-item",
      items: changes.map((row) => ({
        id: row.id,
        sourceKind: "change-item",
        asOf: row.updatedAt,
        title: row.title,
        status: row.status,
        coordinationKind: "delivery" as const,
        plannedStartAt: row.changeRequest?.plannedStartAt ?? null,
        plannedEndAt: row.changeRequest?.plannedEndAt ?? null,
      })),
      unavailableReason: !fullProfile
        ? "Delivery changes are outside the commercial-summary query profile."
        : undefined,
    }),
    architecture: createContextSlice({
      requestedAt,
      sourceKind: "ea-element-and-product-dependency",
      items: architectureItems,
      unavailableReason: !fullProfile
        ? "Architecture is outside the commercial-summary query profile."
        : undefined,
    }),
    scheduledPlaybooks: createContextSlice({
      requestedAt,
      sourceKind: "scheduled-agent-task",
      items: scheduledPlaybooks,
      unavailableReason: !fullProfile
        ? "Scheduled product intelligence is outside the commercial-summary query profile."
        : undefined,
    }),
  });
}
